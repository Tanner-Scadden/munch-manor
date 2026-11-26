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
  hashValue: (value: unknown) => number
  hashNamed: (named: ReadonlyArray<readonly [string, number]>) => number
}>

export const makeValueHasher = (
  options: Readonly<{ cached: boolean }> = { cached: true },
): ValueHasher => {
  const cache = new WeakMap<object, number>()
  const bits = new DataView(new ArrayBuffer(8))

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
