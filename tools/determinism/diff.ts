// Comparing runs: the first checkpoint two runs disagree on, the first path
// where two gameplay states differ, and JSON that keeps every number exact.
// No game imports, so the orchestrator can load it without the game.

import {
  Array,
  Function,
  Option,
  Predicate,
  Record,
  Result,
  Schema,
  SchemaTransformation,
  String,
} from 'effect'

import { encodeJson } from '../json'

export type Checkpoint = readonly [frame: number, hash: number]

// The first checkpoint two runs disagree on, by frame.
export const firstDivergentCheckpoint: {
  (
    b: ReadonlyArray<Checkpoint>,
  ): (
    a: ReadonlyArray<Checkpoint>,
  ) => Readonly<{ index: number; frame: number }> | undefined
  (
    a: ReadonlyArray<Checkpoint>,
    b: ReadonlyArray<Checkpoint>,
  ): Readonly<{ index: number; frame: number }> | undefined
} = Function.dual(
  2,
  (
    a: ReadonlyArray<Checkpoint>,
    b: ReadonlyArray<Checkpoint>,
  ): Readonly<{ index: number; frame: number }> | undefined => {
    const maybeIndex = Array.findFirst(
      globalThis.Array.from(
        { length: Math.max(a.length, b.length) },
        (_, at) => at,
      ),
      at => {
        const left = a[at]
        const right = b[at]
        return (
          left === undefined ||
          right === undefined ||
          left[0] !== right[0] ||
          left[1] !== right[1]
        )
      },
    )
    return Option.match(maybeIndex, {
      onNone: () => undefined,
      onSome: index => ({ index, frame: a[index]?.[0] ?? b[index]?.[0] ?? -1 }),
    })
  },
)

// DIFF

export type Difference = Readonly<{ path: string; a: unknown; b: unknown }>

const sameNumber = (a: number, b: number): boolean =>
  Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))

// NOTE: an object that is not an array, read by its keys.
const isRecordLike = (
  value: object,
): value is Readonly<Record<string, unknown>> => !Array.isArray(value)

const entriesOf = (
  value: Readonly<Record<string, unknown>>,
): ReadonlyArray<readonly [string, unknown]> =>
  Array.filter(Record.toEntries(value), ([, inner]) => inner !== undefined)

const differenceAt = (
  a: unknown,
  b: unknown,
  path: string,
): Difference | undefined => {
  if (typeof a === 'number' && typeof b === 'number') {
    return sameNumber(a, b) ? undefined : { path, a, b }
  }
  if (!Predicate.isObjectKeyword(a) || !Predicate.isObjectKeyword(b)) {
    return Object.is(a, b) ? undefined : { path, a, b }
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return { path, a, b }
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { path: `${path}.length`, a: a.length, b: b.length }
    }
    return Array.reduce<unknown, Difference | undefined>(
      a,
      undefined,
      (found, item, index) =>
        found ?? differenceAt(item, b[index], `${path}[${index}]`),
    )
  }
  if (!isRecordLike(a) || !isRecordLike(b)) {
    return { path, a, b }
  }
  const tagA = '_tag' in a ? a['_tag'] : undefined
  const tagB = '_tag' in b ? b['_tag'] : undefined
  if (tagA !== tagB) {
    return { path: `${path}._tag`, a: tagA, b: tagB }
  }
  const left = new Map(entriesOf(a))
  const right = new Map(entriesOf(b))
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort()
  return Array.reduce<string, Difference | undefined>(
    keys,
    undefined,
    (found, key) =>
      found ?? differenceAt(left.get(key), right.get(key), `${path}.${key}`),
  )
}

// The first path, depth first in canonical key order, where two states
// differ. Numbers compare by bits (0 and -0 differ).
export const firstDifference: {
  (b: unknown): (a: unknown) => Difference | undefined
  (a: unknown, b: unknown): Difference | undefined
} = Function.dual(2, (a: unknown, b: unknown): Difference | undefined =>
  differenceAt(a, b, ''),
)

// JSON that keeps every float64 exactly: -0, NaN, and the infinities become
// tagged strings, which `revive` turns back.
// NOTE: a Schema cannot replace numbers anywhere in a state of any shape, so
// the replacer and reviver ride on the JSON transformation itself, and the
// engines print these exact bytes.
const ExactJson = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Unknown,
    SchemaTransformation.fromJsonString({
      replacer: (_: string, inner: unknown) =>
        typeof inner === 'number' &&
        (!Number.isFinite(inner) || Object.is(inner, -0))
          ? `#num:${Object.is(inner, -0) ? '-0' : globalThis.String(inner)}`
          : inner,
      reviver: (_: string, inner: unknown) =>
        typeof inner === 'string' && String.startsWith('#num:')(inner)
          ? Number(String.slice(5)(inner))
          : inner,
    }),
  ),
)

const throwIssue = (error: Schema.SchemaError): Error =>
  new Error(error.message)

const encodeExact = Schema.encodeResult(ExactJson)
const decodeExact = Schema.decodeResult(ExactJson)

export const exactJson = (value: unknown): string =>
  Result.getOrThrowWith(encodeExact(value), throwIssue)

// NOTE: the other way from exactJson, for a state of any shape.
export const revive = (text: string): unknown =>
  Result.getOrThrowWith(decodeExact(text), throwIssue)

const encodeAnyJson = encodeJson(Schema.Unknown)

// NOTE: a value from a state as JSON text for a report: `undefined` when
// it is missing, which JSON has no text for.
export const jsonTextOf = (value: unknown): string =>
  value === undefined ? 'undefined' : encodeAnyJson(value)
