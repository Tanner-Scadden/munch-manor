// The gameplay hash's core: one 32 bit number for any value, equal in two
// runs exactly when the values are equal bit for bit, in any engine. The
// determinism tools (tools/determinism/hash.ts) hash a Model's gameplay
// fields with it, and a recorded run (src/platform/recording.ts) its last
// World.
//
// The canonical form, walked depth first:
// - A number hashes its float64 bits, so 0.1 + 0.2 and 0.3 differ, as do
//   0 and -0. Every NaN hashes the same, since engines may differ in the
//   payload of a NaN and no game rule can tell them apart.
// - A string hashes its length and UTF-16 code units.
// - An array hashes its length and its items in order: the order of
//   zombies and bullets is part of the state.
// - An object hashes its `_tag` (Option keeps it on the prototype), then its
//   own keys sorted by code unit with their values. A key whose value is
//   undefined counts as absent, as in JSON. So two objects with the same
//   fields built in a different order hash the same.
// - A Map or Set hashes its entries in iteration order, which the language
//   fixes as insertion order, so a change in that order is a divergence.
//
// Each value is mixed in as tagged 32 bit words with the MurmurHash3 block
// step, using Math.imul, so every engine computes the same bits.
//
// Cheap per tick: state shares structure, so an object that did not change
// since the last hash is the same reference. A cached hasher keeps a hash
// for every object it has seen in a WeakMap and skips unchanged subtrees, so
// a tick rehashes only what it touched. That cache trusts the state to be
// immutable; `cached: false` walks everything.

import { Array, Option, Record, String } from 'effect'

const C1 = 0xcc9e2d51
const C2 = 0x1b873593
const SEED = 0x9747b28c

const TAG_UNDEFINED = 1
const TAG_NULL = 2
const TAG_FALSE = 3
const TAG_TRUE = 4
const TAG_NUMBER = 5
const TAG_NAN = 6
const TAG_STRING = 7
const TAG_ARRAY = 8
const TAG_OBJECT = 9
const TAG_MAP = 10
const TAG_SET = 11
const TAG_BIGINT = 12
const TAG_OTHER = 13

const rotl = (value: number, bits: number): number =>
  (value << bits) | (value >>> (32 - bits))

const mix = (hash: number, word: number): number => {
  const scrambled = Math.imul(rotl(Math.imul(word | 0, C1), 15), C2)
  return (Math.imul(rotl(hash ^ scrambled, 13), 5) + 0xe6546b64) | 0
}

const finish = (hash: number, length: number): number => {
  const a = hash ^ length
  const b = Math.imul(a ^ (a >>> 16), 0x85ebca6b)
  const c = Math.imul(b ^ (b >>> 13), 0xc2b2ae35)
  return (c ^ (c >>> 16)) >>> 0
}

const isRecord = (value: object): value is Record<string, unknown> =>
  !Array.isArray(value)

export type ValueHasher = Readonly<{
  // The hash of any value in the canonical form.
  hashValue: (value: unknown) => number
  // One hash of named hashes, in the order given: a state's fields, sorted
  // by name, each hashed with hashValue.
  hashNamed: (named: ReadonlyArray<readonly [string, number]>) => number
}>

export const makeValueHasher = (
  options: Readonly<{ cached: boolean }> = { cached: true },
): ValueHasher => {
  const cache = new WeakMap<object, number>()
  const bits = new DataView(new ArrayBuffer(8))

  // NOTE: each string's UTF-16 code units, read once: the keys and tags of
  // a state repeat on every hashed tick.
  const codeUnits = new Map<string, ReadonlyArray<number>>()
  const codeUnitsOf = (text: string): ReadonlyArray<number> => {
    const known = codeUnits.get(text)
    if (known !== undefined) {
      return known
    }
    const units = globalThis.Array.from({ length: text.length }, (_, index) =>
      Option.getOrElse(String.charCodeAt(text, index), () => 0),
    )
    codeUnits.set(text, units)
    return units
  }

  const hashString = (hash: number, text: string): number => {
    // NOTE: a plain loop, since this runs for every key of every changed
    // object on every hashed tick.
    const units = codeUnitsOf(text)
    let next = mix(mix(hash, TAG_STRING), text.length)
    for (let index = 0; index < units.length; index++) {
      next = mix(next, units[index] ?? 0)
    }
    return next
  }

  const hashNumber = (hash: number, value: number): number => {
    if (Number.isNaN(value)) {
      return mix(hash, TAG_NAN)
    }
    bits.setFloat64(0, value)
    return mix(mix(mix(hash, TAG_NUMBER), bits.getUint32(0)), bits.getUint32(4))
  }

  const hashObject = (value: object): number => {
    if (options.cached) {
      const known = cache.get(value)
      if (known !== undefined) {
        return known
      }
    }
    const hashed = finish(walkObject(value), 0)
    if (options.cached) {
      cache.set(value, hashed)
    }
    return hashed
  }

  const walkObject = (value: object): number => {
    if (Array.isArray(value)) {
      return Array.reduce(
        value,
        mix(mix(SEED, TAG_ARRAY), value.length),
        (hash, item) => step(hash, item),
      )
    }
    if (value instanceof Map) {
      return Array.reduce(
        [...value.entries()],
        mix(mix(SEED, TAG_MAP), value.size),
        (hash, [key, item]) => step(step(hash, key), item),
      )
    }
    if (value instanceof Set) {
      return Array.reduce(
        [...value.values()],
        mix(mix(SEED, TAG_SET), value.size),
        (hash, item) => step(hash, item),
      )
    }
    if (!isRecord(value)) {
      return mix(SEED, TAG_OTHER)
    }
    const tag = '_tag' in value ? value['_tag'] : undefined
    const tagged = step(mix(SEED, TAG_OBJECT), tag)
    return Array.reduce(
      Array.filter(
        Record.keys(value),
        key => key !== '_tag' && value[key] !== undefined,
      ).sort(),
      tagged,
      (hash, key) => step(hashString(hash, key), value[key]),
    )
  }

  const step = (hash: number, value: unknown): number => {
    if (value === undefined) {
      return mix(hash, TAG_UNDEFINED)
    }
    if (value === null) {
      return mix(hash, TAG_NULL)
    }
    if (typeof value === 'boolean') {
      return mix(hash, value ? TAG_TRUE : TAG_FALSE)
    }
    if (typeof value === 'number') {
      return hashNumber(hash, value)
    }
    if (typeof value === 'string') {
      return hashString(hash, value)
    }
    if (typeof value === 'bigint') {
      return hashString(mix(hash, TAG_BIGINT), value.toString())
    }
    if (typeof value === 'object') {
      return mix(hash, hashObject(value))
    }
    return mix(hash, TAG_OTHER)
  }

  const hashValue = (value: unknown): number => finish(step(SEED, value), 0)

  const hashNamed = (named: ReadonlyArray<readonly [string, number]>): number =>
    finish(
      Array.reduce(named, SEED, (hash, [field, fieldHash]) =>
        mix(hashString(hash, field), fieldHash),
      ),
      0,
    )

  return { hashValue, hashNamed }
}
