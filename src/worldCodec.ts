import type { SchemaAST } from 'effect'
import { Array, Match, Option, Result, Struct } from 'effect'

import type { Reader, Writer } from '@munch/netcode'

import { settledLessons } from './lessons'
import { type WireHint, wireHintOf } from './wireNumber'
import type { World } from './world'
import {
  DebutCard,
  GameEvent,
  World as WorldSchema,
  freshLoot,
  freshStats,
  initialHitStop,
  noPractice,
} from './worldSchema'

// The World on the wire, in binary (MULTIPLAYER.md, "The binary codec"):
// what a co-op room sends its players. The codec is read off the World's
// own Schemas, so a new field travels without a line here:
//
// - Numbers by the `wire` annotation on their Schema (src/wireNumber.ts):
//   positions as int16 in eighths of a pixel, velocities in eighths of a
//   pixel a second, directions and scales in 4096ths, timers as whole
//   milliseconds. A number with no annotation goes exactly: a small
//   integer as a varint, anything else as a float64.
// - Literals and union tags as their index, options as a flag, strings and
//   lists with their length.
// - The entity lists (zombies, bullets, lids, pickups, traps, and the
//   teammates) are keyed by id, so a diff names only what came, went, or
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

const fieldNumber =
  (...path: ReadonlyArray<string>): KeyOf =>
  item => {
    const value = Array.reduce(path, item, (at, name) =>
      isRecord(at) ? at[name] : undefined,
    )
    return typeof value === 'number' ? value : -1
  }

const KEYED_LISTS: ReadonlyMap<string, KeyOf> = new Map([
  ['zombies', fieldNumber('id')],
  ['bullets', fieldNumber('id')],
  ['lobs', fieldNumber('id')],
  ['pickups', fieldNumber('id')],
  ['traps', fieldNumber('id')],
  ['mates', fieldNumber('seat', 'slot')],
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
  typeof value === 'object' &&
  value !== null &&
  !globalThis.Array.isArray(value)

const isList = (value: unknown): value is ReadonlyArray<unknown> =>
  globalThis.Array.isArray(value)

const fail = (reason: string): never => {
  throw new Error(reason)
}

const recordOf = (value: unknown): Fields =>
  isRecord(value) ? value : fail('The World codec expected a record')

const listOf = (value: unknown): ReadonlyArray<unknown> =>
  isList(value) ? value : fail('The World codec expected a list')

// NOTE: a list read off the wire is never longer than this, so a bad
// message cannot ask for a huge allocation.
const MAX_LIST = 8192
const MAX_TEXT = 1024

const lengthOf = (reader: Reader): number => {
  const length = reader.varint()
  return length > MAX_LIST ? fail(`A list of ${length}`) : length
}

export const readMany = <A>(count: number, read: () => A): ReadonlyArray<A> =>
  globalThis.Array.from({ length: count }, read)

// CODECS

type Diff = Readonly<{
  write: (writer: Writer, prev: unknown, next: unknown) => void
  read: (reader: Reader, prev: unknown) => unknown
}>

type Codec = Readonly<{
  write: (writer: Writer, value: unknown) => void
  read: (reader: Reader) => unknown
  same: (a: unknown, b: unknown) => boolean
  maybeDiff: Option.Option<Diff>
}>

const plain = (
  write: Codec['write'],
  read: Codec['read'],
  same: Codec['same'],
): Codec => ({ write, read, same, maybeDiff: Option.none() })

const writeChange = (
  codec: Codec,
  writer: Writer,
  prev: unknown,
  next: unknown,
): void =>
  Option.match(codec.maybeDiff, {
    onNone: () => codec.write(writer, next),
    onSome: diff => diff.write(writer, prev, next),
  })

const readChange = (codec: Codec, reader: Reader, prev: unknown): unknown =>
  Option.match(codec.maybeDiff, {
    onNone: () => codec.read(reader),
    onSome: diff => diff.read(reader, prev),
  })

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
    (a, b) => fixedOf(numberOf(a), scale) === fixedOf(numberOf(b), scale),
  )

const millisNumber = plain(
  (writer, value) => writer.zigzag(Math.round(numberOf(value))),
  reader => reader.zigzag(),
  (a, b) => Math.round(numberOf(a)) === Math.round(numberOf(b)),
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
): boolean =>
  a === b ||
  (a.length === b.length &&
    Array.every(a, (value, index) => item.same(value, b[index])))

// NOTE: how many of the first `limit` indexes hold, counting from the start.
const countWhile = (limit: number, holds: (index: number) => boolean): number =>
  Option.getOrElse(
    Array.findFirstIndex(
      readMany(Math.max(0, limit), () => 0),
      (_, index) => !holds(index),
    ),
    () => Math.max(0, limit),
  )

// NOTE: the indexes of `prev` to drop to get `next`, when `next` is `prev`
// with some items taken out and nothing else changed.
const removedIndexes = (
  item: Codec,
  prev: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): Option.Option<ReadonlyArray<number>> => {
  const walked = Array.reduce(
    prev,
    { at: 0, removed: Array.empty<number>() },
    (state, entry, index) =>
      state.at < next.length && item.same(entry, next[state.at])
        ? { at: state.at + 1, removed: state.removed }
        : { at: state.at, removed: Array.append(state.removed, index) },
  )
  return walked.at === next.length ? Option.some(walked.removed) : Option.none()
}

const SPLICED = 0
const THINNED = 1
const RETOUCHED = 2

// NOTE: index gaps, so a run of nearby indexes is a byte each.
const writeIndexes = (writer: Writer, indexes: ReadonlyArray<number>) => {
  writer.varint(indexes.length)
  Array.forEach(indexes, (index, at) =>
    writer.varint(index - (at === 0 ? 0 : (indexes[at - 1] ?? 0) + 1)),
  )
}

const readIndexes = (reader: Reader): ReadonlyArray<number> =>
  Array.reduce(
    readMany(lengthOf(reader), () => reader.varint()),
    Array.empty<number>(),
    (indexes, gap) =>
      Array.append(
        indexes,
        Option.match(Array.last(indexes), {
          onNone: () => gap,
          onSome: last => last + 1 + gap,
        }),
      ),
  )

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
    Array.forEach(list, entry => item.write(writer, entry))
  }
  const read = (reader: Reader) =>
    readMany(lengthOf(reader), () => item.read(reader))

  const writeSplice = (
    writer: Writer,
    prev: ReadonlyArray<unknown>,
    next: ReadonlyArray<unknown>,
  ) => {
    const shorter = Math.min(prev.length, next.length)
    const head = countWhile(shorter, index =>
      item.same(prev[index], next[index]),
    )
    const tail = countWhile(shorter - head, index =>
      item.same(prev[prev.length - 1 - index], next[next.length - 1 - index]),
    )
    const middle = next.slice(head, next.length - tail)
    writer.u8(SPLICED)
    writer.varint(head)
    writer.varint(tail)
    writer.varint(middle.length)
    Array.forEach(middle, entry => item.write(writer, entry))
  }

  const writeDiff = (
    writer: Writer,
    prevValue: unknown,
    nextValue: unknown,
  ) => {
    const prev = listOf(prevValue)
    const next = listOf(nextValue)
    if (next.length === prev.length && Option.isSome(item.maybeDiff)) {
      const changed = Array.filter(
        Array.map(next, (_, index) => index),
        index => !item.same(prev[index], next[index]),
      )
      writer.u8(RETOUCHED)
      writeIndexes(writer, changed)
      Array.forEach(changed, index =>
        writeChange(item, writer, prev[index], next[index]),
      )
      return
    }
    Option.match(
      next.length < prev.length
        ? removedIndexes(item, prev, next)
        : Option.none(),
      {
        onNone: () => writeSplice(writer, prev, next),
        onSome: removed => {
          writer.u8(THINNED)
          writeIndexes(writer, removed)
        },
      },
    )
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
    const changes = new Map(
      Array.map(readIndexes(reader), index => {
        const before =
          index < prev.length ? prev[index] : fail('A list diff ran past it')
        return [index, readChange(item, reader, before)] as const
      }),
    )
    return Array.map(prev, (entry, index) =>
      changes.has(index) ? changes.get(index) : entry,
    )
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
    maybeDiff: Option.some({ write: writeDiff, read: readDiff }),
  }
}

// NOTE: a keyed list's diff: the ids gone, each kept item that changed with
// its own diff, the new items whole, and a flag for the order. The order is
// almost always the kept items as they were and the new ones after them;
// when it is not, the ids go in their new order.
const keyedListCodec = (item: Codec, keyOf: KeyOf): Codec => {
  const whole = listCodec(item)
  const byKey = (list: ReadonlyArray<unknown>): ReadonlyMap<number, unknown> =>
    new Map(Array.map(list, entry => [keyOf(entry), entry] as const))

  const write = (writer: Writer, prevValue: unknown, nextValue: unknown) => {
    const prev = listOf(prevValue)
    const next = listOf(nextValue)
    const prevByKey = byKey(prev)
    const nextByKey = byKey(next)
    const gone = Array.filter(prev, entry => !nextByKey.has(keyOf(entry)))
    const added = Array.filter(next, entry => !prevByKey.has(keyOf(entry)))
    const changed = Array.filter(next, entry => {
      const before = prevByKey.get(keyOf(entry))
      return before !== undefined && !item.same(before, entry)
    })
    const naturalOrder = [
      ...Array.filter(prev, entry => nextByKey.has(keyOf(entry))),
      ...added,
    ]
    const isNatural = Array.every(
      next,
      (entry, index) => keyOf(entry) === keyOf(naturalOrder[index]),
    )
    writer.varint(gone.length)
    Array.forEach(gone, entry => writer.varint(keyOf(entry)))
    writer.varint(changed.length)
    Array.forEach(changed, entry => {
      writer.varint(keyOf(entry))
      writeChange(item, writer, prevByKey.get(keyOf(entry)), entry)
    })
    writer.varint(added.length)
    Array.forEach(added, entry => item.write(writer, entry))
    writer.bool(isNatural)
    if (!isNatural) {
      writer.varint(next.length)
      Array.forEach(next, entry => writer.varint(keyOf(entry)))
    }
  }

  const read = (reader: Reader, prevValue: unknown): unknown => {
    const prev = listOf(prevValue)
    const gone = new Set(readMany(lengthOf(reader), () => reader.varint()))
    const changes = new Map(
      readMany(lengthOf(reader), () => {
        const key = reader.varint()
        const before = Option.getOrElse(
          Array.findFirst(prev, entry => keyOf(entry) === key),
          () => fail(`A diff changed an unknown item ${key}`),
        )
        return [key, readChange(item, reader, before)] as const
      }),
    )
    const added = readMany(lengthOf(reader), () => item.read(reader))
    const kept = Array.filterMap(prev, entry => {
      const key = keyOf(entry)
      return gone.has(key)
        ? Result.failVoid
        : Result.succeed(changes.get(key) ?? entry)
    })
    const natural = [...kept, ...added]
    if (reader.bool()) {
      return natural
    }
    const naturalByKey = byKey(natural)
    return readMany(lengthOf(reader), () => {
      const key = reader.varint()
      return naturalByKey.get(key) ?? fail(`No item ${key} to order`)
    })
  }

  return { ...whole, maybeDiff: Option.some({ write, read }) }
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

const maskOf = (flags: ReadonlyArray<boolean>): number =>
  Array.reduce(flags, 0, (mask, flag, index) =>
    flag ? mask + 2 ** index : mask,
  )

const hasBit = (mask: number, index: number): boolean =>
  Math.floor(mask / 2 ** index) % 2 === 1

const sameProperty = (property: Property, a: Fields, b: Fields): boolean => {
  const hasA = property.name in a
  const hasB = property.name in b
  return hasA && hasB
    ? property.codec.same(a[property.name], b[property.name])
    : hasA === hasB
}

const withField = (fields: Fields, name: string, value: unknown): Fields => ({
  ...fields,
  [name]: value,
})

const withoutField = (fields: Fields, name: string): Fields =>
  Object.fromEntries(
    Array.filter(Object.entries(fields), ([key]) => key !== name),
  )

const structCodec = (
  properties: ReadonlyArray<Property>,
  constants: Fields,
  fills: Fields,
): Codec => {
  if (properties.length > MAX_MASK_FIELDS) {
    return fail(`A struct of ${properties.length} fields`)
  }
  const optional = Array.filter(properties, property => property.isOptional)

  const write = (writer: Writer, value: unknown) => {
    const fields = recordOf(value)
    if (Array.isReadonlyArrayNonEmpty(optional)) {
      writer.varint(maskOf(Array.map(optional, ({ name }) => name in fields)))
    }
    Array.forEach(properties, property => {
      if (property.name in fields) {
        property.codec.write(writer, fields[property.name])
      }
    })
  }

  const read = (reader: Reader): unknown => {
    const presence = Array.isReadonlyArrayNonEmpty(optional)
      ? reader.varint()
      : 0
    const present = new Set(
      Array.filterMap(optional, ({ name }, index) =>
        hasBit(presence, index) ? Result.succeed(name) : Result.failVoid,
      ),
    )
    return Array.reduce(
      properties,
      { ...fills, ...constants },
      (fields: Fields, property) =>
        property.isOptional && !present.has(property.name)
          ? fields
          : withField(fields, property.name, property.codec.read(reader)),
    )
  }

  const same = (a: unknown, b: unknown): boolean => {
    if (a === b) {
      return true
    }
    const fieldsA = recordOf(a)
    const fieldsB = recordOf(b)
    return Array.every(properties, property =>
      sameProperty(property, fieldsA, fieldsB),
    )
  }

  const writeDiff = (writer: Writer, prev: unknown, next: unknown) => {
    const before = recordOf(prev)
    const after = recordOf(next)
    const changed = Array.map(
      properties,
      property => before !== after && !sameProperty(property, before, after),
    )
    writer.varint(maskOf(changed))
    Array.forEach(properties, (property, index) => {
      if (changed[index] !== true) {
        return
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
    })
  }

  const readDiff = (reader: Reader, prev: unknown): unknown => {
    const before = recordOf(prev)
    const mask = reader.varint()
    return Array.reduce(
      properties,
      before,
      (fields: Fields, property, index) => {
        if (!hasBit(mask, index)) {
          return fields
        }
        const has = property.isOptional ? reader.bool() : true
        if (!has) {
          return withoutField(fields, property.name)
        }
        return withField(
          fields,
          property.name,
          property.name in before
            ? readChange(property.codec, reader, before[property.name])
            : property.codec.read(reader),
        )
      },
    )
  }

  return {
    write,
    read,
    same,
    maybeDiff: Option.some({ write: writeDiff, read: readDiff }),
  }
}

// UNIONS

type Member = Readonly<{
  isMember: (value: unknown) => boolean
  codec: Codec
}>

const memberIndexOf = (members: ReadonlyArray<Member>, value: unknown) =>
  Option.getOrElse(
    Array.findFirstIndex(members, member => member.isMember(value)),
    () => fail('A value no member of its union holds'),
  )

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
  const isDiffable = Array.some(members, member =>
    Option.isSome(member.codec.maybeDiff),
  )
  return {
    write,
    read,
    same,
    maybeDiff: isDiffable
      ? Option.some({ write: writeDiff, read: readDiff })
      : Option.none(),
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
    Match.tag('Arrays', () => isList),
    Match.tag('Declaration', () => Option.isOption),
    Match.orElse(() => () => false),
  )

const propertyName = (property: SchemaAST.PropertySignature): string =>
  typeof property.name === 'string'
    ? property.name
    : fail('A Schema field named by a symbol')

const isOptionalProperty = (property: SchemaAST.PropertySignature): boolean =>
  property.type.context?.isOptional === true

const fieldCodec = (name: string, ast: SchemaAST.AST): Codec => {
  const inner = codecOf(ast)
  return Option.match(Option.fromNullishOr(KEYED_LISTS.get(name)), {
    onNone: () => inner,
    onSome: keyOf =>
      ast._tag === 'Arrays' && Array.isReadonlyArrayNonEmpty(ast.rest)
        ? keyedListCodec(codecOf(ast.rest[0]), keyOf)
        : inner,
  })
}

const objectsCodec = (
  ast: SchemaAST.Objects,
  skipped: ReadonlySet<string>,
  fills: Fields,
): Codec => {
  const constants = Object.fromEntries(
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
  'player' in value

const worldOf = (value: unknown): World =>
  isWorld(value) ? value : fail('The wire gave back no World')

const isGameEvent = (value: unknown): value is GameEvent =>
  isRecord(value) && typeof value['_tag'] === 'string'

const eventOf = (value: unknown): GameEvent =>
  isGameEvent(value) ? value : fail('The wire gave back no event')

export const writeWorld = (writer: Writer, world: World): void =>
  worldCodec.write(writer, world)

export const readWorld = (reader: Reader): World =>
  worldOf(worldCodec.read(reader))

export const writeWorldDiff = (
  writer: Writer,
  prev: World,
  next: World,
): void => writeChange(worldCodec, writer, prev, next)

export const readWorldDiff = (reader: Reader, prev: World): World =>
  worldOf(readChange(worldCodec, reader, prev))

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
export const isSameOnWire = (a: World, b: World): boolean =>
  worldCodec.same(a, b)

export const writeEvent = (writer: Writer, event: GameEvent): void =>
  eventsCodec.write(writer, event)

export const readEvent = (reader: Reader): GameEvent =>
  eventOf(eventsCodec.read(reader))
