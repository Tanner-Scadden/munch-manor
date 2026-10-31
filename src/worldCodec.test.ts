import { Array, Match, Option, Order, Schema, type SchemaAST } from 'effect'
import { describe, expect, test } from 'vitest'

import { type Writer, makeReader, makeWriter } from '@munch/netcode'

import { freshFight } from './boss'
import { TWO_SEAT_ROOM, playRoom } from './roomTesting'
import { DEFAULT_ROOM_SETTINGS, startRoomWorld } from './roomWorld'
import { beginPreparation } from './waves'
import { type WireHint, wireHintOf } from './wireNumber'
import {
  WIRE_FIELDS,
  readEvent,
  readWorld,
  valueCodecOf,
  writeEvent,
  writeWorld,
  writeWorldDiff,
} from './worldCodec'
import { BossMove, GameEvent, Vector, World } from './worldSchema'

// NOTE: every number the World and its events hold, by its path, with how
// the wire packs it. It follows the codec: Options, lists, unions, and
// suspended Schemas down to each number.
const numbersOf = (
  ast: SchemaAST.AST,
  path: string,
  seen: ReadonlySet<SchemaAST.AST> = new Set(),
): ReadonlyArray<readonly [string, WireHint]> =>
  Match.value(ast).pipe(
    Match.tag('Number', number => [[path, wireHintOf(number)] as const]),
    Match.tag('Declaration', ({ typeParameters }) =>
      Array.flatMap(typeParameters, inner => numbersOf(inner, path, seen)),
    ),
    Match.tag('Arrays', ({ rest }) =>
      Array.flatMap(rest, inner => numbersOf(inner, path, seen)),
    ),
    Match.tag('Union', ({ types }) =>
      Array.flatMap(types, inner => numbersOf(inner, path, seen)),
    ),
    Match.tag('Objects', ({ propertySignatures }) =>
      Array.flatMap(propertySignatures, property =>
        numbersOf(property.type, `${path}.${String(property.name)}`, seen),
      ),
    ),
    Match.tag('Suspend', suspend =>
      seen.has(suspend)
        ? []
        : numbersOf(suspend.thunk(), path, new Set([...seen, suspend])),
    ),
    Match.orElse(() => []),
  )

const lastName = (path: string): string =>
  Option.getOrElse(Array.last(path.split('.')), () => path)

const hintTable = (
  numbers: ReadonlyArray<readonly [string, WireHint]>,
): Readonly<Record<string, { count: number; names: ReadonlyArray<string> }>> =>
  Object.fromEntries(
    Array.map(['Position', 'Velocity', 'Unit', 'Millis'] as const, hint => {
      const paths = Array.map(
        Array.filter(numbers, ([, at]) => at === hint),
        ([path]) => path,
      )
      return [
        hint,
        {
          count: paths.length,
          names: Array.sort(
            Array.dedupe(Array.map(paths, lastName)),
            Order.String,
          ),
        },
      ]
    }),
  )

describe('the wire packs numbers by their Schema', () => {
  test('a number with no wire annotation goes exactly, whatever its field is named', () => {
    // NOTE: the old codec packed these by name and rounded them.
    const Named = Schema.Struct({
      x: Schema.Number,
      y: Schema.Number,
      offset: Schema.Number,
      velocityX: Schema.Number,
      knockback: Schema.Number,
      intensity: Schema.Number,
      sizeScale: Schema.Number,
      waitMs: Schema.Number,
      facing: Vector,
    })
    const value = {
      x: 100.123456789,
      y: -0.1,
      offset: 1e300,
      velocityX: Number.MAX_SAFE_INTEGER,
      knockback: -123456.789,
      intensity: 1 / 3,
      sizeScale: Number.POSITIVE_INFINITY,
      waitMs: 16.666666666666668,
      facing: { x: Math.SQRT1_2, y: Number.NaN },
    }
    const codec = valueCodecOf(Named.ast)
    const writer = makeWriter()
    codec.write(writer, value)
    expect(codec.read(makeReader(writer.finish()))).toEqual(value)
  })

  test('the World packs each lossy number where its Schema says', () => {
    const numbers = [
      ...Array.flatMap(WIRE_FIELDS, name =>
        numbersOf(World.fields[name].ast, `World.${name}`),
      ),
      ...numbersOf(GameEvent.ast, 'Event'),
    ]
    // NOTE: a new lossy field shows up here. Name it on purpose.
    expect(hintTable(numbers)).toEqual({
      Position: { count: 171, names: ['offset', 'remainingPx', 'x', 'y'] },
      Velocity: {
        count: 9,
        names: ['knockback', 'velocityX', 'velocityY', 'x', 'y'],
      },
      Unit: {
        count: 65,
        names: ['hpScale', 'intensity', 'speedScale', 'x', 'y'],
      },
      Millis: {
        count: 120,
        names: [
          'ageMs',
          'apartMs',
          'atMs',
          'belchMs',
          'bleedMs',
          'cooldownMs',
          'durationMs',
          'elapsedMs',
          'extendedMs',
          'fireCooldownMs',
          'graceMs',
          'heldMs',
          'hitRemainingMs',
          'knifeCooldownMs',
          'quietMs',
          'recoilRemainingMs',
          'relaxMs',
          'remainingMs',
          'reviveMs',
          'sinceMs',
          'standingMs',
          'touchedMs',
          'triggerRestMs',
          'waitedMs',
        ],
      },
    })
  })

  test('an event with an exact number reads back exactly', () => {
    const killed = GameEvent.ZombieKilled({
      x: 12.5,
      y: 40,
      direction: { x: 1, y: 0 },
      bounty: 2 ** 50 + 0.5,
      kind: 'Shambler',
    })
    const writer = makeWriter()
    writeEvent(writer, killed)
    expect(readEvent(makeReader(writer.finish()))).toMatchObject({
      bounty: 2 ** 50 + 0.5,
    })
  })
})

const BOSS_ID = 9000

// NOTE: a charge aimed across the room: the target and the rush both go
// far past the 8 px a unit value holds.
const BRACING = BossMove.Bracing({
  target: { x: 213.37, y: 101.9 },
  remainingMs: 400,
  durationMs: 800,
})
const RUSHING = BossMove.Rushing({
  direction: { x: 0.6, y: -0.8 },
  remainingPx: 140.25,
})

const withBossMove = (move: BossMove): World => ({
  ...TWO_SEAT_ROOM.world,
  boss: freshFight(BOSS_ID, move),
})

const readBackMove = (move: BossMove): BossMove => {
  const writer = makeWriter()
  writeWorld(writer, withBossMove(move))
  const boss = readWorld(makeReader(writer.finish())).boss
  return boss._tag === 'Fighting' ? boss.move : expect.fail('No fight')
}

// NOTE: a position goes in eighths of a pixel, so it reads back within
// half of one.
const POSITION_PRECISION = 1 / 16

// NOTE: how far each read-back number is from the one sent, or Infinity
// when the move came back as another case.
const braceMiss = (move: BossMove): ReadonlyArray<number> =>
  move._tag === 'Bracing'
    ? [
        Math.abs(move.target.x - BRACING.target.x),
        Math.abs(move.target.y - BRACING.target.y),
      ]
    : [Infinity]

const rushMiss = (move: BossMove): number =>
  move._tag === 'Rushing'
    ? Math.abs(move.remainingPx - RUSHING.remainingPx)
    : Infinity

describe("the boss's charge on the wire", () => {
  test('a far brace target reads back where the room aimed it', () => {
    expect(Math.max(...braceMiss(readBackMove(BRACING)))).toBeLessThanOrEqual(
      POSITION_PRECISION,
    )
  })

  test('a long rush reads back its whole length', () => {
    expect(rushMiss(readBackMove(RUSHING))).toBeLessThanOrEqual(
      POSITION_PRECISION,
    )
  })
})

// NOTE: the bytes of a scripted room of three in wave 4, its snapshots,
// diffs, and events, then a boss bracing and rushing. Protocol 8 changed
// the boss's bytes (its brace target and rush length went from unit
// values to positions); protocol 11 added each player's `wield`, the knife
// or a gun in hand; protocol 12 added each player's `melee`, the knife or
// the Clang Pan in the melee slot; protocol 13 added each player's
// `triggerRestMs`, the idle reload's clock. The wire must not change
// without a protocol bump. A change to how the room plays moves the bytes
// with no change to the wire, as zombies coming in promptly after their
// warning did.
const GOLDEN_DIGEST = '65173:bd99e16d8cf9b2b7'
const WIRE_TICKS = 360

const bytesOf = (write: (writer: Writer) => void): Uint8Array => {
  const writer = makeWriter()
  write(writer)
  return writer.finish()
}

// NOTE: two 32-bit FNV-1a hashes from different starts, as hex. Enough to
// see a byte change, which is all the test asks.
const makeDigest = () => {
  const state = { a: 0x811c9dc5, b: 0x01000193, length: 0 }
  return {
    update: (bytes: Uint8Array): void => {
      Array.forEach(globalThis.Array.from(bytes), byte => {
        state.a = Math.imul(state.a ^ byte, 0x01000193) >>> 0
        state.b = Math.imul(state.b ^ byte, 0x01000193) >>> 0
      })
      state.length += bytes.length
    },
    digest: (): string =>
      `${state.length}:${state.a.toString(16).padStart(8, '0')}${state.b.toString(16).padStart(8, '0')}`,
  }
}

const wireDigest = (): Readonly<{ digest: string; zombies: number }> => {
  const hash = makeDigest()
  const fresh = startRoomWorld([0, 1, 2], 3, DEFAULT_ROOM_SETTINGS)
  const start = { ...fresh, world: beginPreparation(fresh.world, 4, 500) }
  const sent = { at: start, zombies: 0 }
  playRoom(start, WIRE_TICKS, room => {
    if (room.tick % 60 === 0) {
      hash.update(bytesOf(writer => writeWorld(writer, room.world)))
    }
    hash.update(
      bytesOf(writer => writeWorldDiff(writer, sent.at.world, room.world)),
    )
    Array.forEach(
      Array.filter(room.events, entry => entry.tick === room.tick),
      entry =>
        Array.forEach(entry.events, event =>
          hash.update(bytesOf(writer => writeEvent(writer, event))),
        ),
    )
    sent.at = room
    sent.zombies = Math.max(sent.zombies, room.world.zombies.length)
  })
  const stalking = withBossMove(BossMove.Stalking({ cooldownMs: 1000 }))
  Array.forEach([BRACING, RUSHING], move => {
    const world = withBossMove(move)
    hash.update(bytesOf(writer => writeWorld(writer, world)))
    hash.update(bytesOf(writer => writeWorldDiff(writer, stalking, world)))
  })
  return { digest: hash.digest(), zombies: sent.zombies }
}

describe('the bytes on the wire', () => {
  test('a scripted room writes the bytes it always has', () => {
    const { digest, zombies } = wireDigest()
    expect(zombies).toBeGreaterThan(3)
    expect(digest).toBe(GOLDEN_DIGEST)
  })
})
