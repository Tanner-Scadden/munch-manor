import type { SchemaAST } from 'effect'
import { Array, Function, Match, Option, Record, Result, Struct } from 'effect'

import type { Reader, Writer } from '@munch/netcode'

import { settledLessons } from '../run/lessons'
import { type WireHint, wireHintOf } from '../schema/wireNumber'
import type { World } from '../schema/world'
import {
  DebutCard,
  GameEvent,
  World as WorldSchema,
  freshLoot,
  freshStats,
  initialHitStop,
  noPractice,
} from '../schema/worldSchema'

// The World on the wire, in binary (MULTIPLAYER.md, "The binary codec"):
// what a co-op room sends its players. The codec is read off the World's
// own Schemas, so a new field travels without a line here:
//
// - Numbers by the `wire` annotation on their Schema (src/world/schema/wireNumber.ts):
//   positions as int16 in eighths of a pixel, velocities in eighths of a
//   pixel a second, directions and scales in 4096ths, timers as whole
//   milliseconds. A number with no annotation goes exactly: a small
//   integer as a varint, anything else as a float64.
// - Literals and union tags as their index, options as a flag, strings and
//   lists with their length.
// - The entity lists (zombies, bullets, lids, pickups, traps, and the
//   seats, by slot) are keyed by id, so a diff names only what came, went, or
//   changed.
// - A diff is a mask of the fields that changed, nested: a zombie that
//   only walked writes its id, a mask byte, and its new x and y.
//
// What a client never needs stays home: the seeded state, the id counter,
// the flow fields (a client interpolates zombies, it never steers them),
// the tick's events (they ride beside the diff, by tick), hit-stop, run
// stats, and single player's gates. A client's copy holds fixed values
// there. Values are compared as a client reads them back, so a client that
// applies every diff holds exactly what a snapshot gives.
//
// The Writer and Reader are the netcode package's, named by type only, so
// a room's bundle carries nothing more of the package than the room does.

// NOTE: the entity lists, by the field that holds them, and what keys
// each item.
type KeyOf = (item: unknown) => number

const numberOrMissing = (value: unknown): number =>
  typeof value === 'number' ? value : -1

const idOf: KeyOf = item => (isRecord(item) ? numberOrMissing(item['id']) : -1)

const seatSlotOf: KeyOf = item =>
  isRecord(item) && isRecord(item['seat'])
    ? numberOrMissing(item['seat']['slot'])
    : -1

const KEYED_LISTS: ReadonlyMap<string, KeyOf> = new Map([
  ['zombies', idOf],
  ['bullets', idOf],
  ['lobs', idOf],
  ['pickups', idOf],
  ['traps', idOf],
  ['seats', seatSlotOf],
])

// NOTE: World fields that never go on the wire.
const HOME_FIELDS: ReadonlySet<string> = new Set([
  'rngState',
  'loot',
  'nextEntityId',
  'frameEvents',
  'hitStop',
  'lessons',
  'practice',
  'debutCard',
  'stats',
])

// VALUES

type Fields = Readonly<Record<string, unknown>>

const isRecord = (value: unknown): value is Fields =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const fail = (reason: string): never => {
  throw new Error(reason)
}

const recordOf = (value: unknown): Fields =>
  isRecord(value) ? value : fail('The World codec expected a record')

const listOf = (value: unknown): ReadonlyArray<unknown> =>
  Array.isArray(value) ? value : fail('The World codec expected a list')

// NOTE: a list read off the wire is never longer than this, so a bad
// message cannot ask for a huge allocation.
const MAX_LIST = 8192
const MAX_TEXT = 1024

const lengthOf = (reader: Reader): number => {
  const length = reader.varint()
  return length > MAX_LIST ? fail(`A list of ${length}`) : length
}

export const readMany: {
  <A>(read: () => A): (count: number) => ReadonlyArray<A>
  <A>(count: number, read: () => A): ReadonlyArray<A>
} = Function.dual(2, <A>(count: number, read: () => A): ReadonlyArray<A> => {
  const items: Array<A> = []
  for (let index = 0; index < count; index++) {
    items.push(read())
  }
  return items
})

// CODECS

// NOTE: a struct's diff also hands out its mask of changed fields, so a
// keyed list that has found which items changed need not find it again.
type Diff = Readonly<{
  write: (writer: Writer, prev: unknown, next: unknown, mask?: number) => void
  read: (reader: Reader, prev: unknown) => unknown
  maskOf?: (prev: unknown, next: unknown) => number
}>

type Codec = Readonly<{
  write: (writer: Writer, value: unknown) => void
  read: (reader: Reader) => unknown
  same: (a: unknown, b: unknown) => boolean
  diff: Diff | undefined
}>

const plain = (
  write: Codec['write'],
  read: Codec['read'],
  same: Codec['same'],
): Codec => ({ write, read, same, diff: undefined })

const writeChange = (
  codec: Codec,
  writer: Writer,
  prev: unknown,
  next: unknown,
): void =>
  codec.diff === undefined
    ? codec.write(writer, next)
    : codec.diff.write(writer, prev, next)

const readChange = (codec: Codec, reader: Reader, prev: unknown): unknown =>
  codec.diff === undefined ? codec.read(reader) : codec.diff.read(reader, prev)

// NUMBERS

const SMALL_INTEGER = 2 ** 46
const FLOAT_MARK = 1

const zigzagOf = (value: number): number =>
  value < 0 ? -2 * value - 1 : 2 * value

const unzigzag = (value: number): number =>
  value % 2 === 0 ? value / 2 : -(value + 1) / 2

const isSmallInteger = (value: number): boolean =>
  Number.isInteger(value) && Math.abs(value) < SMALL_INTEGER

const numberOf = (value: unknown): number =>
  typeof value === 'number' ? value : fail('The World codec expected a number')

const exactNumber = plain(
  (writer, value) => {
    const number = numberOf(value)
    if (isSmallInteger(number)) {
      writer.varint(2 * zigzagOf(number))
    } else {
      writer.varint(FLOAT_MARK)
      writer.f64(number)
    }
  },
  reader => {
    const mark = reader.varint()
    return mark === FLOAT_MARK ? reader.f64() : unzigzag(mark / 2)
  },
  (a, b) => a === b || (Number.isNaN(a) && Number.isNaN(b)),
)

const INT16_LIMIT = 32767

const fixedOf = (value: number, scale: number): number =>
  Math.max(-INT16_LIMIT - 1, Math.min(INT16_LIMIT, Math.round(value * scale)))

const fixedNumber = (scale: number): Codec =>
  plain(
    (writer, value) => writer.i16(fixedOf(numberOf(value), scale)),
    reader => reader.i16() / scale,
    (a, b) =>
      a === b || fixedOf(numberOf(a), scale) === fixedOf(numberOf(b), scale),
  )

const millisNumber = plain(
  (writer, value) => writer.zigzag(Math.round(numberOf(value))),
  reader => reader.zigzag(),
  (a, b) => a === b || Math.round(numberOf(a)) === Math.round(numberOf(b)),
)

const POSITION_SCALE = 8
const VELOCITY_SCALE = 8
const UNIT_SCALE = 4096

const NUMBER_CODECS: Readonly<Record<WireHint, Codec>> = {
  Exact: exactNumber,
  Position: fixedNumber(POSITION_SCALE),
  Velocity: fixedNumber(VELOCITY_SCALE),
  Unit: fixedNumber(UNIT_SCALE),
  Millis: millisNumber,
}

// TEXT AND FLAGS

const textCodec = plain(
  (writer, value) =>
    writer.text(typeof value === 'string' ? value : fail('Expected a string')),
  reader => reader.text(MAX_TEXT),
  (a, b) => a === b,
)

const booleanCodec = plain(
  (writer, value) => writer.bool(value === true),
  reader => reader.bool(),
  (a, b) => a === b,
)

const constantCodec = (value: unknown): Codec =>
  plain(
    () => {},
    () => value,
    () => true,
  )

// OPTIONS AND LISTS

const optionOf = (value: unknown): Option.Option<unknown> =>
  Option.isOption(value) ? value : fail('Expected an Option')

const optionCodec = (inner: Codec): Codec =>
  plain(
    (writer, value) =>
      Option.match(optionOf(value), {
        onNone: () => writer.bool(false),
        onSome: some => {
          writer.bool(true)
          inner.write(writer, some)
        },
      }),
    reader => (reader.bool() ? Option.some(inner.read(reader)) : Option.none()),
    (a, b) =>
      Option.match(optionOf(a), {
        onNone: () => Option.isNone(optionOf(b)),
        onSome: someA =>
          Option.match(optionOf(b), {
            onNone: () => false,
            onSome: someB => inner.same(someA, someB),
          }),
      }),
  )

const sameLists = (
  item: Codec,
  a: ReadonlyArray<unknown>,
  b: ReadonlyArray<unknown>,
): boolean => {
  if (a === b) {
    return true
  }
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index++) {
    if (!item.same(a[index], b[index])) {
      return false
    }
  }
  return true
}

// NOTE: the indexes of `prev` to drop to get `next`, when `next` is `prev`
// with some items taken out and nothing else changed.
const removedIndexes = (
  item: Codec,
  prev: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): ReadonlyArray<number> | undefined => {
  let at = 0
  const removed: Array<number> = []
  for (let index = 0; index < prev.length; index++) {
    if (at < next.length && item.same(prev[index], next[at])) {
      at++
    } else {
      removed.push(index)
    }
  }
  return at === next.length ? removed : undefined
}

const SPLICED = 0
const THINNED = 1
const RETOUCHED = 2

// NOTE: index gaps, so a run of nearby indexes is a byte each.
const writeIndexes = (writer: Writer, indexes: ReadonlyArray<number>) => {
  writer.varint(indexes.length)
  let previous = -1
  for (const index of indexes) {
    writer.varint(index - previous - 1)
    previous = index
  }
}

const readIndexes = (reader: Reader): ReadonlyArray<number> => {
  const count = lengthOf(reader)
  const indexes: Array<number> = []
  let previous = -1
  for (let at = 0; at < count; at++) {
    previous = previous + 1 + reader.varint()
    indexes.push(previous)
  }
  return indexes
}

// NOTE: a list's diff is one of three shapes. When items only left it, such
// as a wave's planned spawns as they come in, it names the indexes that
// left. When it kept its length, it names the items that changed, each with
// its own diff, as the spawns held back by the alive cap move their times.
// Otherwise it keeps the items it starts and ends with that did not change
// and writes the run between them, so a hold added at the end is a few
// bytes.
const listCodec = (item: Codec): Codec => {
  const write = (writer: Writer, value: unknown) => {
    const list = listOf(value)
    writer.varint(list.length)
    for (const entry of list) {
      item.write(writer, entry)
    }
  }
  const read = (reader: Reader) =>
    readMany(lengthOf(reader), () => item.read(reader))

  const writeSplice = (
    writer: Writer,
    prev: ReadonlyArray<unknown>,
    next: ReadonlyArray<unknown>,
  ) => {
    const shorter = Math.min(prev.length, next.length)
    let head = 0
    while (head < shorter && item.same(prev[head], next[head])) {
      head++
    }
    let tail = 0
    while (
      tail < shorter - head &&
      item.same(prev[prev.length - 1 - tail], next[next.length - 1 - tail])
    ) {
      tail++
    }
    const middle = next.slice(head, next.length - tail)
    writer.u8(SPLICED)
    writer.varint(head)
    writer.varint(tail)
    writer.varint(middle.length)
    for (const entry of middle) {
      item.write(writer, entry)
    }
  }

  const writeDiff = (
    writer: Writer,
    prevValue: unknown,
    nextValue: unknown,
  ) => {
    const prev = listOf(prevValue)
    const next = listOf(nextValue)
    if (next.length === prev.length && item.diff !== undefined) {
      const changed: Array<number> = []
      for (let index = 0; index < next.length; index++) {
        if (!item.same(prev[index], next[index])) {
          changed.push(index)
        }
      }
      writer.u8(RETOUCHED)
      writeIndexes(writer, changed)
      for (const index of changed) {
        writeChange(item, writer, prev[index], next[index])
      }
      return
    }
    const removed =
      next.length < prev.length ? removedIndexes(item, prev, next) : undefined
    if (removed === undefined) {
      writeSplice(writer, prev, next)
    } else {
      writer.u8(THINNED)
      writeIndexes(writer, removed)
    }
  }

  const readSplice = (reader: Reader, prev: ReadonlyArray<unknown>) => {
    const head = reader.varint()
    const tail = reader.varint()
    if (head + tail > prev.length) {
      return fail('A list diff kept more than the list held')
    }
    const middle = readMany(lengthOf(reader), () => item.read(reader))
    return [
      ...prev.slice(0, head),
      ...middle,
      ...prev.slice(prev.length - tail),
    ]
  }

  const readThinned = (reader: Reader, prev: ReadonlyArray<unknown>) => {
    const removed = new Set(readIndexes(reader))
    return Array.filter(prev, (_, index) => !removed.has(index))
  }

  const readRetouched = (reader: Reader, prev: ReadonlyArray<unknown>) => {
    const next = prev.slice()
    for (const index of readIndexes(reader)) {
      if (index >= prev.length) {
        return fail('A list diff ran past it')
      }
      next[index] = readChange(item, reader, prev[index])
    }
    return next
  }

  const readDiff = (reader: Reader, prevValue: unknown): unknown => {
    const prev = listOf(prevValue)
    const shape = reader.u8()
    if (shape === THINNED) {
      return readThinned(reader, prev)
    } else if (shape === RETOUCHED) {
      return readRetouched(reader, prev)
    } else {
      return readSplice(reader, prev)
    }
  }
  return {
    write,
    read,
    same: (a, b) => sameLists(item, listOf(a), listOf(b)),
    diff: { write: writeDiff, read: readDiff },
  }
}

// NOTE: a keyed list's diff: the ids gone, each kept item that changed with
// its own diff, the new items whole, and a flag for the order. The order is
// almost always the kept items as they were and the new ones after them;
// when it is not, the ids go in their new order. Each list is indexed by id
// once, so a diff costs time in the list's length, not its square.
const keyedListCodec = (item: Codec, keyOf: KeyOf): Codec => {
  const whole = listCodec(item)

  const write = (writer: Writer, prevValue: unknown, nextValue: unknown) => {
    const prev = listOf(prevValue)
    const next = listOf(nextValue)
    const prevByKey = new Map<number, unknown>()
    for (const entry of prev) {
      prevByKey.set(keyOf(entry), entry)
    }
    const nextKeys = new Set<number>()
    const added: Array<unknown> = []
    const changed: Array<unknown> = []
    const masks: Array<number> = []
    const maskOf = item.diff?.maskOf
    for (const entry of next) {
      const key = keyOf(entry)
      nextKeys.add(key)
      const before = prevByKey.get(key)
      if (before === undefined) {
        added.push(entry)
      } else if (maskOf === undefined) {
        if (!item.same(before, entry)) {
          changed.push(entry)
        }
      } else {
        const mask = maskOf(before, entry)
        if (mask !== 0) {
          changed.push(entry)
          masks.push(mask)
        }
      }
    }
    const gone: Array<number> = []
    const keptKeys: Array<number> = []
    for (const entry of prev) {
      const key = keyOf(entry)
      if (nextKeys.has(key)) {
        keptKeys.push(key)
      } else {
        gone.push(key)
      }
    }
    let isNatural = true
    for (let index = 0; index < next.length && isNatural; index++) {
      const expected =
        index < keptKeys.length
          ? keptKeys[index]
          : keyOf(added[index - keptKeys.length])
      isNatural = keyOf(next[index]) === expected
    }
    writer.varint(gone.length)
    for (const key of gone) {
      writer.varint(key)
    }
    writer.varint(changed.length)
    Array.forEach(changed, (entry, index) => {
      const key = keyOf(entry)
      writer.varint(key)
      if (item.diff === undefined) {
        item.write(writer, entry)
      } else {
        item.diff.write(writer, prevByKey.get(key), entry, masks[index])
      }
    })
    writer.varint(added.length)
    for (const entry of added) {
      item.write(writer, entry)
    }
    writer.bool(isNatural)
    if (!isNatural) {
      writer.varint(next.length)
      for (const entry of next) {
        writer.varint(keyOf(entry))
      }
    }
  }

  const read = (reader: Reader, prevValue: unknown): unknown => {
    const prev = listOf(prevValue)
    const gone = new Set(readMany(lengthOf(reader), () => reader.varint()))
    const changeCount = lengthOf(reader)
    const changes = new Map<number, unknown>()
    if (changeCount > 0) {
      const prevByKey = new Map<number, unknown>()
      for (const entry of prev) {
        prevByKey.set(keyOf(entry), entry)
      }
      for (let at = 0; at < changeCount; at++) {
        const key = reader.varint()
        const before = prevByKey.get(key)
        if (before === undefined) {
          return fail(`A diff changed an unknown item ${key}`)
        }
        changes.set(key, readChange(item, reader, before))
      }
    }
    const added = readMany(lengthOf(reader), () => item.read(reader))
    const natural: Array<unknown> = []
    for (const entry of prev) {
      const key = keyOf(entry)
      if (!gone.has(key)) {
        natural.push(changes.get(key) ?? entry)
      }
    }
    for (const entry of added) {
      natural.push(entry)
    }
    if (reader.bool()) {
      return natural
    }
    const naturalByKey = new Map<number, unknown>()
    for (const entry of natural) {
      naturalByKey.set(keyOf(entry), entry)
    }
    return readMany(lengthOf(reader), () => {
      const key = reader.varint()
      return naturalByKey.get(key) ?? fail(`No item ${key} to order`)
    })
  }

  return { ...whole, diff: { write, read } }
}

// STRUCTS

type Property = Readonly<{
  name: string
  codec: Codec
  isOptional: boolean
}>

// NOTE: a mask of up to 48 fields, as a varint built with arithmetic, since
// JavaScript's bitwise operators stop at 32 bits.
const MAX_MASK_FIELDS = 48

const BIT_VALUES: ReadonlyArray<number> = globalThis.Array.from(
  { length: MAX_MASK_FIELDS },
  (_, index) => 2 ** index,
)

const bitValue = (index: number): number => BIT_VALUES[index] ?? 2 ** index

const hasBit = (mask: number, index: number): boolean =>
  Math.floor(mask / bitValue(index)) % 2 === 1

const sameProperty = (property: Property, a: Fields, b: Fields): boolean => {
  const valueA = a[property.name]
  const valueB = b[property.name]
  if (valueA !== undefined && valueB !== undefined) {
    return property.codec.same(valueA, valueB)
  }
  const hasA = property.name in a
  const hasB = property.name in b
  return hasA && hasB ? property.codec.same(valueA, valueB) : hasA === hasB
}

const structCodec = (
  properties: ReadonlyArray<Property>,
  constants: Fields,
  fills: Fields,
): Codec => {
  if (properties.length > MAX_MASK_FIELDS) {
    return fail(`A struct of ${properties.length} fields`)
  }
  const optional = Array.filter(properties, property => property.isOptional)
  const hasOptional = optional.length > 0
  // NOTE: where each property sits among the optional ones, or -1.
  const optionalIndexes = Array.map(properties, property =>
    property.isOptional ? optional.indexOf(property) : -1,
  )
  const starting: Fields = { ...fills, ...constants }

  const write = (writer: Writer, value: unknown) => {
    const fields = recordOf(value)
    if (hasOptional) {
      let mask = 0
      Array.forEach(optional, ({ name }, index) => {
        if (name in fields) {
          mask += bitValue(index)
        }
      })
      writer.varint(mask)
    }
    for (const property of properties) {
      if (property.name in fields) {
        property.codec.write(writer, fields[property.name])
      }
    }
  }

  const read = (reader: Reader): unknown => {
    const presence = hasOptional ? reader.varint() : 0
    const fields: Record<string, unknown> = { ...starting }
    Array.forEach(properties, (property, index) => {
      if (
        property.isOptional &&
        !hasBit(presence, optionalIndexes[index] ?? 0)
      ) {
        return
      }
      fields[property.name] = property.codec.read(reader)
    })
    return fields
  }

  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    const fieldsA = recordOf(a)
    const fieldsB = recordOf(b)
    for (const property of properties) {
      if (!sameProperty(property, fieldsA, fieldsB)) {
        return false
      }
    }
    return true
  }

  const maskOf = (prev: unknown, next: unknown): number => {
    const before = recordOf(prev)
    const after = recordOf(next)
    let mask = 0
    if (before !== after) {
      for (let index = 0; index < properties.length; index++) {
        const property = properties[index]
        if (property !== undefined && !sameProperty(property, before, after)) {
          mask += bitValue(index)
        }
      }
    }
    return mask
  }

  const writeDiff = (
    writer: Writer,
    prev: unknown,
    next: unknown,
    known?: number,
  ) => {
    const before = recordOf(prev)
    const after = recordOf(next)
    const mask = known ?? maskOf(before, after)
    writer.varint(mask)
    if (mask === 0) {
      return
    }
    for (let index = 0; index < properties.length; index++) {
      const property = properties[index]
      if (property === undefined || !hasBit(mask, index)) {
        continue
      }
      const has = property.name in after
      if (property.isOptional) {
        writer.bool(has)
      }
      if (has) {
        if (property.name in before) {
          writeChange(
            property.codec,
            writer,
            before[property.name],
            after[property.name],
          )
        } else {
          property.codec.write(writer, after[property.name])
        }
      }
    }
  }

  const readDiff = (reader: Reader, prev: unknown): unknown => {
    const before = recordOf(prev)
    const mask = reader.varint()
    if (mask === 0) {
      return before
    }
    const fields: Record<string, unknown> = { ...before }
    Array.forEach(properties, (property, index) => {
      if (!hasBit(mask, index)) {
        return
      }
      const has = property.isOptional ? reader.bool() : true
      if (!has) {
        // NOTE: a removed optional field, which is rare.
        delete fields[property.name]
      } else {
        fields[property.name] =
          property.name in before
            ? readChange(property.codec, reader, before[property.name])
            : property.codec.read(reader)
      }
    })
    return fields
  }

  return {
    write,
    read,
    same,
    diff: { write: writeDiff, read: readDiff, maskOf },
  }
}

// UNIONS

type Member = Readonly<{
  isMember: (value: unknown) => boolean
  codec: Codec
}>

const memberIndexOf = (
  members: ReadonlyArray<Member>,
  value: unknown,
): number => {
  for (let index = 0; index < members.length; index++) {
    if (members[index]?.isMember(value) === true) {
      return index
    }
  }
  return fail('A value no member of its union holds')
}

const memberAt = (members: ReadonlyArray<Member>, index: number): Member =>
  members[index] ?? fail(`No union member ${index}`)

const SAME_MEMBER = 0

const unionCodec = (members: ReadonlyArray<Member>): Codec => {
  const write = (writer: Writer, value: unknown) => {
    const index = memberIndexOf(members, value)
    writer.u8(index)
    memberAt(members, index).codec.write(writer, value)
  }
  const read = (reader: Reader) =>
    memberAt(members, reader.u8()).codec.read(reader)
  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    const index = memberIndexOf(members, a)
    return (
      index === memberIndexOf(members, b) &&
      memberAt(members, index).codec.same(a, b)
    )
  }
  const writeDiff = (writer: Writer, prev: unknown, next: unknown) => {
    const index = memberIndexOf(members, next)
    if (index === memberIndexOf(members, prev)) {
      writer.u8(SAME_MEMBER)
      writeChange(memberAt(members, index).codec, writer, prev, next)
    } else {
      writer.u8(index + 1)
      memberAt(members, index).codec.write(writer, next)
    }
  }
  const readDiff = (reader: Reader, prev: unknown): unknown => {
    const mark = reader.u8()
    return mark === SAME_MEMBER
      ? readChange(
          memberAt(members, memberIndexOf(members, prev)).codec,
          reader,
          prev,
        )
      : memberAt(members, mark - 1).codec.read(reader)
  }
  const isDiffable = Array.some(
    members,
    member => member.codec.diff !== undefined,
  )
  return {
    write,
    read,
    same,
    diff: isDiffable ? { write: writeDiff, read: readDiff } : undefined,
  }
}

const literalCodec = (literals: ReadonlyArray<SchemaAST.LiteralValue>): Codec =>
  plain(
    (writer, value) =>
      writer.u8(
        Option.getOrElse(
          Array.findFirstIndex(literals, literal => literal === value),
          () => fail(`Not one of its literals: ${String(value)}`),
        ),
      ),
    reader => literals[reader.u8()] ?? fail('An unknown literal'),
    (a, b) => a === b,
  )

// FROM THE SCHEMA

const flattenUnion = (ast: SchemaAST.AST): ReadonlyArray<SchemaAST.AST> =>
  ast._tag === 'Union' ? Array.flatMap(ast.types, flattenUnion) : [ast]

const tagOf = (ast: SchemaAST.AST): Option.Option<SchemaAST.LiteralValue> =>
  ast._tag === 'Objects'
    ? Option.flatMap(
        Array.findFirst(
          ast.propertySignatures,
          property => property.name === '_tag',
        ),
        property =>
          property.type._tag === 'Literal'
            ? Option.some(property.type.literal)
            : Option.none(),
      )
    : Option.none()

// NOTE: the member test is chosen once per Schema node, not per value: the
// codec runs on every tick the room sends.
const isMemberOf = (ast: SchemaAST.AST): ((value: unknown) => boolean) =>
  Match.value(ast).pipe(
    Match.tag(
      'Literal',
      ({ literal }) =>
        (value: unknown) =>
          value === literal,
    ),
    Match.tag('Objects', objects =>
      Option.match(tagOf(objects), {
        onNone: () => isRecord,
        onSome:
          tag =>
          (value: unknown): boolean =>
            isRecord(value) && value['_tag'] === tag,
      }),
    ),
    Match.tag(
      'String',
      'TemplateLiteral',
      () => (value: unknown) => typeof value === 'string',
    ),
    Match.tag('Number', () => (value: unknown) => typeof value === 'number'),
    Match.tag('Boolean', () => (value: unknown) => typeof value === 'boolean'),
    Match.tag('Arrays', () => Array.isArray),
    Match.tag('Declaration', () => Option.isOption),
    Match.orElse(() => () => false),
  )

const propertyName = (property: SchemaAST.PropertySignature): string =>
  typeof property.name === 'string'
    ? property.name
    : fail('A Schema field named by a symbol')

const isOptionalProperty = (property: SchemaAST.PropertySignature): boolean =>
  property.type.context?.isOptional === true

const fieldCodec = (name: string, ast: SchemaAST.AST): Codec =>
  Option.match(Option.fromNullishOr(KEYED_LISTS.get(name)), {
    onNone: () => codecOf(ast),
    onSome: keyOf =>
      ast._tag === 'Arrays' && Array.isReadonlyArrayNonEmpty(ast.rest)
        ? keyedListCodec(codecOf(ast.rest[0]), keyOf)
        : codecOf(ast),
  })

const objectsCodec = (
  ast: SchemaAST.Objects,
  skipped: ReadonlySet<string>,
  fills: Fields,
): Codec => {
  const constants = Record.fromEntries(
    Array.filterMap(ast.propertySignatures, property =>
      property.type._tag === 'Literal'
        ? Result.succeed([
            propertyName(property),
            property.type.literal,
          ] as const)
        : Result.failVoid,
    ),
  )
  const properties = Array.filterMap(
    ast.propertySignatures,
    (property): Result.Result<Property, void> => {
      const name = propertyName(property)
      return property.type._tag === 'Literal' || skipped.has(name)
        ? Result.failVoid
        : Result.succeed({
            name,
            codec: fieldCodec(name, property.type),
            isOptional: isOptionalProperty(property),
          })
    },
  )
  return structCodec(properties, constants, fills)
}

const NO_FIELDS: ReadonlySet<string> = new Set()

const codecOf = (ast: SchemaAST.AST): Codec =>
  Match.value(ast).pipe(
    Match.tag('Number', number => NUMBER_CODECS[wireHintOf(number)]),
    Match.tag('String', 'TemplateLiteral', () => textCodec),
    Match.tag('Boolean', () => booleanCodec),
    Match.tag('Literal', ({ literal }) => constantCodec(literal)),
    Match.tag('Declaration', ({ typeParameters }) =>
      typeParameters.length === 1 && typeParameters[0] !== undefined
        ? optionCodec(codecOf(typeParameters[0]))
        : fail('A Schema declaration other than Option'),
    ),
    Match.tag('Arrays', ({ elements, rest }) =>
      Array.isReadonlyArrayEmpty(elements) &&
      rest.length === 1 &&
      rest[0] !== undefined
        ? listCodec(codecOf(rest[0]))
        : fail('A tuple in the World'),
    ),
    Match.tag('Objects', objects => objectsCodec(objects, NO_FIELDS, {})),
    Match.tag('Union', union => {
      const members = flattenUnion(union)
      return Array.every(members, member => member._tag === 'Literal')
        ? literalCodec(Array.map(members, member => member.literal))
        : unionCodec(
            Array.map(members, member => ({
              isMember: isMemberOf(member),
              codec: codecOf(member),
            })),
          )
    }),
    Match.tag('Suspend', suspend => codecOf(suspend.thunk())),
    Match.orElse(({ _tag }) => fail(`No wire form for a ${_tag}`)),
  )

// THE WORLD

// NOTE: what a client's World holds in the fields that stay home. The
// lessons are settled, as a room plays them.
const HOME_VALUES: Fields = {
  rngState: 0,
  loot: freshLoot(0),
  nextEntityId: 0,
  frameEvents: [],
  hitStop: initialHitStop,
  lessons: settledLessons,
  practice: noPractice,
  debutCard: DebutCard.Hidden(),
  stats: freshStats,
}

export const WIRE_FIELDS: ReadonlyArray<keyof typeof WorldSchema.fields> =
  Array.filter(Struct.keys(WorldSchema.fields), key => !HOME_FIELDS.has(key))

const worldAst = WorldSchema.ast

const worldCodec = objectsCodec(worldAst, HOME_FIELDS, HOME_VALUES)

const eventsCodec = codecOf(GameEvent.ast)

const isWorld = (value: unknown): value is World =>
  isRecord(value) &&
  'phase' in value &&
  'zombies' in value &&
  'party' in value &&
  Array.isArray(value['seats']) &&
  value['seats'].length > 0

const worldOf = (value: unknown): World =>
  isWorld(value) ? value : fail('The wire gave back no World')

const isGameEvent = (value: unknown): value is GameEvent =>
  isRecord(value) && typeof value['_tag'] === 'string'

const eventOf = (value: unknown): GameEvent =>
  isGameEvent(value) ? value : fail('The wire gave back no event')

export const writeWorld: {
  (world: World): (writer: Writer) => void
  (writer: Writer, world: World): void
} = Function.dual(2, (writer: Writer, world: World): void =>
  worldCodec.write(writer, world),
)

export const readWorld = (reader: Reader): World =>
  worldOf(worldCodec.read(reader))

export const writeWorldDiff: {
  (prev: World, next: World): (writer: Writer) => void
  (writer: Writer, prev: World, next: World): void
} = Function.dual(3, (writer: Writer, prev: World, next: World): void =>
  writeChange(worldCodec, writer, prev, next),
)

export const readWorldDiff: {
  (prev: World): (reader: Reader) => World
  (reader: Reader, prev: World): World
} = Function.dual(2, (reader: Reader, prev: World): World =>
  worldOf(readChange(worldCodec, reader, prev)),
)

// NOTE: the codec for any Schema, as the World's fields get theirs, for
// tests.
export const valueCodecOf = (
  ast: SchemaAST.AST,
): Readonly<{
  write: (writer: Writer, value: unknown) => void
  read: (reader: Reader) => unknown
}> => {
  const codec = codecOf(ast)
  return { write: codec.write, read: codec.read }
}

// NOTE: whether two Worlds read back the same on a client.
export const isSameOnWire: {
  (b: World): (a: World) => boolean
  (a: World, b: World): boolean
} = Function.dual(2, (a: World, b: World): boolean => worldCodec.same(a, b))

export const writeEvent: {
  (event: GameEvent): (writer: Writer) => void
  (writer: Writer, event: GameEvent): void
} = Function.dual(2, (writer: Writer, event: GameEvent): void =>
  eventsCodec.write(writer, event),
)

export const readEvent = (reader: Reader): GameEvent =>
  eventOf(eventsCodec.read(reader))
