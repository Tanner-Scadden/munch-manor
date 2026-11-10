import {
  Array,
  Match,
  Option,
  Order,
  Record,
  Schema,
  type SchemaAST,
  String,
} from 'effect'
import { describe, expect, test } from 'vitest'

import {
  MAX_MODIFIER_MASK,
  type Writer,
  makeReader,
  makeWriter,
} from '@munch/netcode'

import { TWO_SEAT_ROOM, playRoom } from '../../../test/roomTesting'
import { maskOfModifiers, noModifiers } from '../../run/modifiers'
import { type WireHint, wireHintOf } from '../../schema/wireNumber'
import { BossMove, GameEvent, Vector, World } from '../../schema/worldSchema'
import { beginPreparation } from '../../waves/waves'
import { freshFight } from '../../zombies/boss'
import { DEFAULT_ROOM_SETTINGS, startRoomWorld } from '../roomWorld'
import {
  WIRE_FIELDS,
  readEvent,
  readWorld,
  readWorldDiff,
  valueCodecOf,
  writeEvent,
  writeWorld,
  writeWorldDiff,
} from '../worldCodec'

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
        numbersOf(
          property.type,
          `${path}.${globalThis.String(property.name)}`,
          seen,
        ),
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
  Option.getOrElse(Array.last(String.split('.')(path)), () => path)

const hintTable = (
  numbers: ReadonlyArray<readonly [string, WireHint]>,
): Readonly<Record<string, { count: number; names: ReadonlyArray<string> }>> =>
  Record.fromEntries(
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
      x: Schema.Finite,
      y: Schema.Finite,
      offset: Schema.Finite,
      velocityX: Schema.Finite,
      knockback: Schema.Finite,
      intensity: Schema.Finite,
      sizeScale: Schema.Finite,
      waitMs: Schema.Finite,
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
      Position: { count: 173, names: ['offset', 'remainingPx', 'x', 'y'] },
      Velocity: {
        count: 7,
        names: ['knockback', 'velocityX', 'velocityY', 'x', 'y'],
      },
      Unit: {
        count: 59,
        names: ['hpScale', 'intensity', 'speedScale', 'x', 'y'],
      },
      Millis: {
        count: 100,
        names: [
          'ageMs',
          'apartMs',
          'atMs',
          'belchMs',
          'bleedMs',
          'callMs',
          'cooldownMs',
          'durationMs',
          'elapsedMs',
          'extendedMs',
          'fireCooldownMs',
          'graceMs',
          'heldMs',
          'hitRemainingMs',
          'knifeCooldownMs',
          'nextBurnMs',
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

describe("the run's modifiers on the wire", () => {
  const every = {
    friendlyFire: true,
    bigCrowd: true,
    broke: true,
    glass: true,
  }
  const some = { ...every, friendlyFire: false, broke: false }

  test('a snapshot carries them to the client, whichever are on', () => {
    Array.forEach([noModifiers, every, some], modifiers => {
      const writer = makeWriter()
      writeWorld(writer, { ...TWO_SEAT_ROOM.world, modifiers })
      expect(readWorld(makeReader(writer.finish())).modifiers).toEqual(
        modifiers,
      )
    })
  })

  test('a diff names them only when they changed', () => {
    const before = TWO_SEAT_ROOM.world
    const same = makeWriter()
    writeWorldDiff(same, before, { ...before })
    const changed = makeWriter()
    writeWorldDiff(changed, before, { ...before, modifiers: some })
    expect(changed.finish().length).toBeGreaterThan(same.finish().length)
    const writer = makeWriter()
    writeWorldDiff(writer, before, { ...before, modifiers: some })
    expect(
      readWorldDiff(makeReader(writer.finish()), before).modifiers,
    ).toEqual(some)
  })

  test('the lobby mask is as wide as the set', () => {
    expect(MAX_MODIFIER_MASK).toBe(maskOfModifiers(every))
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
// `triggerRestMs`, the idle reload's clock; protocol 14 added the ammo window's
// tap; protocol 15 added each seat's revives, downs, and shots for the crew
// board; protocol 16 added each player's `calling`; protocol 18 added the
// run's `modifiers`; protocol 19 added the fridge's cheap first pulls,
// the pantry's stash, the kitchen's `stove` and `gasValve`, and each
// seat's `cooking`; protocol 20 added the Arriving phase, the intro's
// clock and cut, before the first break (the room's first wave is now rolled
// on the slam, so the scripted wave 4 rolls from another seed state too).
// The wire must not change
// without a protocol bump. A change to how the room plays moves the bytes
// with no change to the wire, as zombies coming in promptly after their
// warning did, and Normal's eased health and speed (2026-10-31) did.
const GOLDEN_DIGEST = '70735:2cff855052206632'
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
      `${state.length}:${String.padStart(8, '0')(state.a.toString(16))}${String.padStart(8, '0')(state.b.toString(16))}`,
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

// NOTE: a small seeded generator, so the pairs a test draws are the same on
// every run.
const lcg = (seed: number) => {
  const state = { value: seed }
  return (below: number): number => {
    state.value = (Math.imul(state.value, 1664525) + 1013904223) >>> 0
    return state.value % below
  }
}

const readBack = (world: World): World =>
  readWorld(makeReader(bytesOf(writer => writeWorld(writer, world))))

describe('random diffs of a scripted room', () => {
  const worlds = (() => {
    const fresh = startRoomWorld([0, 1, 2], 5, DEFAULT_ROOM_SETTINGS)
    const start = { ...fresh, world: beginPreparation(fresh.world, 4, 500) }
    const seen: Array<World> = []
    playRoom(start, WIRE_TICKS, room => {
      if (room.tick % 5 === 0) {
        seen.push(room.world)
      }
    })
    return seen
  })()

  const pickWorld = (pick: (below: number) => number): World =>
    worlds[pick(worlds.length)] ?? expect.fail('No World')

  const reordered = (world: World, pick: (below: number) => number): World => ({
    ...world,
    zombies: Array.map(
      Array.sort(
        Array.map(world.zombies, zombie => ({ zombie, rank: pick(1000) })),
        Order.mapInput(Order.Number, ({ rank }: { rank: number }) => rank),
      ),
      ({ zombie }) => zombie,
    ),
  })

  test('a diff between any two Worlds reads back as a snapshot of the later', () => {
    const pick = lcg(11)
    Array.forEach(
      Array.makeBy(200, () => 0),
      () => {
        const held = readBack(pickWorld(pick))
        const to = pickWorld(pick)
        const diff = bytesOf(writer => writeWorldDiff(writer, held, to))
        expect(readWorldDiff(makeReader(diff), held)).toEqual(readBack(to))
      },
    )
  })

  test('a diff to a reordered, thinned list reads back the same', () => {
    const pick = lcg(29)
    Array.forEach(
      Array.makeBy(60, () => 0),
      () => {
        const held = readBack(pickWorld(pick))
        const shuffled = reordered(pickWorld(pick), pick)
        const to = {
          ...shuffled,
          zombies: Array.filter(shuffled.zombies, () => pick(4) !== 0),
          bullets: shuffled.bullets.slice(pick(2)),
        }
        const diff = bytesOf(writer => writeWorldDiff(writer, held, to))
        expect(readWorldDiff(makeReader(diff), held)).toEqual(readBack(to))
      },
    )
  })
})
