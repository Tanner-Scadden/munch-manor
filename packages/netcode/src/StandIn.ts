import { Array, Function, Option, pipe } from 'effect'

import { type PlayerInput, moveOf } from './Protocol'
import {
  type Reader,
  WireError,
  type Writer,
  quantizePosition,
  repeat,
} from './Wire'
import type { PlayerTick, Score, World } from './World'

// NOTE: a small world that stands in for the game until the World/Model
// split lands: a dot per player, moved by its input, and a few walkers
// that bounce around the arena. A dot that touches a walker tags it for a
// point, and the walker comes back somewhere else as a new one. It is
// enough to exercise everything the room does with a world: steps by
// input, presence, randomness in state, removals and spawns in diffs, and
// own-player prediction.

export const ARENA_WIDTH = 640
export const ARENA_HEIGHT = 360
export const DOT_RADIUS = 8
export const DOT_SPEED = 150
export const WALKER_RADIUS = 7
export const WALKER_COUNT = 6
export const WALKER_MIN_SPEED = 40
export const WALKER_MAX_SPEED = 80
export const TAG_DISTANCE = DOT_RADIUS + WALKER_RADIUS
export const ROUND_TICKS = 60 * 60 * 3
const STEP_SECONDS = 1 / 60

// NOTE: a walker moved further than this between two messages respawned,
// so the client shows it where it is instead of sliding it there.
const TELEPORT_DISTANCE = 60

export interface Dot {
  readonly slot: number
  readonly x: number
  readonly y: number
  readonly away: boolean
  readonly score: number
}

export interface Walker {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly vx: number
  readonly vy: number
}

// NOTE: `rng` and `nextId` only mean something in the room. A client's
// copy, read from the wire, has zeros there and walkers without velocity:
// it never steps them, it interpolates.
export interface StandInWorld {
  readonly tick: number
  readonly dots: ReadonlyArray<Dot>
  readonly walkers: ReadonlyArray<Walker>
  readonly rng: number
  readonly nextId: number
}

// RANDOM

// NOTE: mulberry32, as in src/shared/prng.ts: integer math only, so exact in
// every engine.
const nextRandom = (state: number): readonly [number, number] => {
  const t = (state + 0x6d2b79f5) | 0
  const a = Math.imul(t ^ (t >>> 15), t | 1)
  const b = (a + Math.imul(a ^ (a >>> 7), a | 61)) ^ a
  return [((b ^ (b >>> 14)) >>> 0) / 4294967296, t]
}

type Drawn<A> = readonly [ReadonlyArray<A>, number]

const randoms = (state: number, count: number): Drawn<number> => {
  const none: Drawn<number> = [[], state]
  return Array.reduce(
    repeat(count, () => 0),
    none,
    ([values, current]) => {
      const [value, next] = nextRandom(current)
      const drawn: Drawn<number> = [Array.append(values, value), next]
      return drawn
    },
  )
}

const spawnWalker = (id: number, rng: number): readonly [Walker, number] => {
  const [[rx, ry, angle, speed], next] = randoms(rng, 4)
  const turn = (angle ?? 0) * Math.PI * 2
  const pace =
    WALKER_MIN_SPEED + (speed ?? 0) * (WALKER_MAX_SPEED - WALKER_MIN_SPEED)
  return [
    {
      id,
      x: WALKER_RADIUS + (rx ?? 0) * (ARENA_WIDTH - 2 * WALKER_RADIUS),
      y: WALKER_RADIUS + (ry ?? 0) * (ARENA_HEIGHT - 2 * WALKER_RADIUS),
      vx: Math.cos(turn) * pace,
      vy: Math.sin(turn) * pace,
    },
    next,
  ]
}

const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

// START

export const startDot = (slot: number): Dot => ({
  slot,
  x: ARENA_WIDTH / 2 + (slot - 1.5) * 120,
  y: ARENA_HEIGHT / 2,
  away: false,
  score: 0,
})

const start = (slots: ReadonlyArray<number>, seed: number): StandInWorld => {
  const none: Drawn<Walker> = [[], seed | 0]
  const [walkers, rng] = Array.reduce(
    repeat(WALKER_COUNT, () => 0),
    none,
    ([made, state], _, index) => {
      const [walker, next] = spawnWalker(index + 1, state)
      const drawn: Drawn<Walker> = [Array.append(made, walker), next]
      return drawn
    },
  )
  return {
    tick: 0,
    dots: pipe(
      slots,
      Array.dedupe,
      Array.sort(numberOrder),
      Array.map(startDot),
    ),
    walkers,
    rng,
    nextId: WALKER_COUNT + 1,
  }
}

const numberOrder = (a: number, b: number): -1 | 0 | 1 =>
  a < b ? -1 : a > b ? 1 : 0

// STEP

export const moveDot: {
  (input: PlayerInput): (dot: Dot) => Dot
  (dot: Dot, input: PlayerInput): Dot
} = Function.dual(2, (dot: Dot, input: PlayerInput): Dot => {
  const move = moveOf(input)
  return {
    ...dot,
    x: clamp(
      dot.x + move.x * DOT_SPEED * STEP_SECONDS,
      DOT_RADIUS,
      ARENA_WIDTH - DOT_RADIUS,
    ),
    y: clamp(
      dot.y + move.y * DOT_SPEED * STEP_SECONDS,
      DOT_RADIUS,
      ARENA_HEIGHT - DOT_RADIUS,
    ),
  }
})

const moveWalker = (walker: Walker): Walker => {
  const x = walker.x + walker.vx * STEP_SECONDS
  const y = walker.y + walker.vy * STEP_SECONDS
  const bounceX = x < WALKER_RADIUS || x > ARENA_WIDTH - WALKER_RADIUS
  const bounceY = y < WALKER_RADIUS || y > ARENA_HEIGHT - WALKER_RADIUS
  return {
    id: walker.id,
    x: clamp(x, WALKER_RADIUS, ARENA_WIDTH - WALKER_RADIUS),
    y: clamp(y, WALKER_RADIUS, ARENA_HEIGHT - WALKER_RADIUS),
    vx: bounceX ? -walker.vx : walker.vx,
    vy: bounceY ? -walker.vy : walker.vy,
  }
}

const stepDot = (dot: Dot, players: ReadonlyArray<PlayerTick>): Dot =>
  Option.match(
    Array.findFirst(players, player => player.slot === dot.slot),
    {
      onNone: () => dot,
      onSome: player =>
        player.presence === 'Away'
          ? { ...dot, away: true }
          : moveDot({ ...dot, away: false }, player.input),
    },
  )

const touches = (dot: Dot, walker: Walker): boolean => {
  const dx = dot.x - walker.x
  const dy = dot.y - walker.y
  return dx * dx + dy * dy < TAG_DISTANCE * TAG_DISTANCE
}

// NOTE: each walker is tagged by the first present dot touching it, in
// slot order. Tagged walkers leave and new ones join at the end, so a
// client's list keeps the same order as the room's.
const tagWalkers = (world: StandInWorld): StandInWorld => {
  const tagged = Array.getSomes(
    Array.map(world.walkers, walker =>
      Option.map(
        Array.findFirst(world.dots, dot => !dot.away && touches(dot, walker)),
        dot => ({ walker: walker.id, slot: dot.slot }),
      ),
    ),
  )
  if (Array.isReadonlyArrayEmpty(tagged)) {
    return world
  }
  type Spawned = readonly [ReadonlyArray<Walker>, number, number]
  const none: Spawned = [[], world.rng, world.nextId]
  const [spawned, rng, nextId] = Array.reduce(
    tagged,
    none,
    ([made, state, id]) => {
      const [walker, next] = spawnWalker(id, state)
      const done: Spawned = [Array.append(made, walker), next, id + 1]
      return done
    },
  )
  return {
    ...world,
    dots: Array.map(world.dots, dot => ({
      ...dot,
      score:
        dot.score + Array.filter(tagged, tag => tag.slot === dot.slot).length,
    })),
    walkers: Array.appendAll(
      Array.filter(
        world.walkers,
        walker => !Array.some(tagged, tag => tag.walker === walker.id),
      ),
      spawned,
    ),
    rng,
    nextId,
  }
}

const step = (
  world: StandInWorld,
  players: ReadonlyArray<PlayerTick>,
): StandInWorld =>
  tagWalkers({
    ...world,
    tick: world.tick + 1,
    dots: Array.map(world.dots, dot => stepDot(dot, players)),
    walkers: Array.map(world.walkers, moveWalker),
  })

// WIRE

const AWAY_FLAG = 1

const DOT_X = 1
const DOT_Y = 2
const DOT_AWAY = 4
const DOT_SCORE = 8
const DOT_NEW = 16

const WALKER_X = 1
const WALKER_Y = 2
const WALKER_NEW = 4

const writeDot = (writer: Writer, dot: Dot) => {
  writer.u8(dot.slot)
  writer.u8(dot.away ? AWAY_FLAG : 0)
  writer.position(dot.x)
  writer.position(dot.y)
  writer.varint(dot.score)
}

const readDot = (reader: Reader): Dot => ({
  slot: reader.u8(),
  away: (reader.u8() & AWAY_FLAG) !== 0,
  x: reader.position(),
  y: reader.position(),
  score: reader.varint(),
})

const readWalker = (reader: Reader): Walker => ({
  id: reader.varint(),
  x: reader.position(),
  y: reader.position(),
  vx: 0,
  vy: 0,
})

const snapshot = (writer: Writer, world: StandInWorld) => {
  writer.varint(world.tick)
  writer.u8(world.dots.length)
  Array.forEach(world.dots, dot => writeDot(writer, dot))
  writer.varint(world.walkers.length)
  Array.forEach(world.walkers, walker => {
    writer.varint(walker.id)
    writer.position(walker.x)
    writer.position(walker.y)
  })
}

const MAX_WALKERS = 256

const readSnapshot = (reader: Reader): StandInWorld => {
  const tick = reader.varint()
  const dots = repeat(reader.u8(), () => readDot(reader))
  const walkerCount = reader.varint()
  if (walkerCount > MAX_WALKERS) {
    throw WireError.make({ reason: `${walkerCount} walkers` })
  }
  return {
    tick,
    dots,
    walkers: repeat(walkerCount, () => readWalker(reader)),
    rng: 0,
    nextId: 0,
  }
}

const differs = (a: number, b: number): boolean =>
  quantizePosition(a) !== quantizePosition(b)

const dotMask = (prev: Option.Option<Dot>, next: Dot): number =>
  Option.match(prev, {
    onNone: () => DOT_NEW,
    onSome: before =>
      (differs(before.x, next.x) ? DOT_X : 0) |
      (differs(before.y, next.y) ? DOT_Y : 0) |
      (before.away !== next.away ? DOT_AWAY : 0) |
      (before.score !== next.score ? DOT_SCORE : 0),
  })

const walkerMask = (prev: Option.Option<Walker>, next: Walker): number =>
  Option.match(prev, {
    onNone: () => WALKER_NEW,
    onSome: before =>
      (differs(before.x, next.x) ? WALKER_X : 0) |
      (differs(before.y, next.y) ? WALKER_Y : 0),
  })

const dotBySlot = (dots: ReadonlyArray<Dot>, slot: number) =>
  Array.findFirst(dots, dot => dot.slot === slot)

const walkerById = (walkers: ReadonlyArray<Walker>, id: number) =>
  Array.findFirst(walkers, walker => walker.id === id)

const diff = (writer: Writer, prev: StandInWorld, next: StandInWorld) => {
  writer.varint(Math.max(0, next.tick - prev.tick))

  const goneDots = Array.filter(prev.dots, dot =>
    Option.isNone(dotBySlot(next.dots, dot.slot)),
  )
  const changedDots = Array.getSomes(
    Array.map(next.dots, dot => {
      const mask = dotMask(dotBySlot(prev.dots, dot.slot), dot)
      return mask === 0 ? Option.none() : Option.some({ dot, mask })
    }),
  )
  writer.u8(goneDots.length)
  Array.forEach(goneDots, dot => writer.u8(dot.slot))
  writer.u8(changedDots.length)
  Array.forEach(changedDots, ({ dot, mask }) => {
    writer.u8(dot.slot)
    writer.u8(mask)
    if ((mask & DOT_NEW) !== 0) {
      writeDot(writer, dot)
      return
    }
    if ((mask & DOT_X) !== 0) {
      writer.position(dot.x)
    }
    if ((mask & DOT_Y) !== 0) {
      writer.position(dot.y)
    }
    if ((mask & DOT_AWAY) !== 0) {
      writer.bool(dot.away)
    }
    if ((mask & DOT_SCORE) !== 0) {
      writer.varint(dot.score)
    }
  })

  const goneWalkers = Array.filter(prev.walkers, walker =>
    Option.isNone(walkerById(next.walkers, walker.id)),
  )
  const changedWalkers = Array.getSomes(
    Array.map(next.walkers, walker => {
      const mask = walkerMask(walkerById(prev.walkers, walker.id), walker)
      return mask === 0 ? Option.none() : Option.some({ walker, mask })
    }),
  )
  writer.varint(goneWalkers.length)
  Array.forEach(goneWalkers, walker => writer.varint(walker.id))
  writer.varint(changedWalkers.length)
  Array.forEach(changedWalkers, ({ walker, mask }) => {
    writer.varint(walker.id)
    writer.u8(mask)
    if ((mask & (WALKER_X | WALKER_NEW)) !== 0) {
      writer.position(walker.x)
    }
    if ((mask & (WALKER_Y | WALKER_NEW)) !== 0) {
      writer.position(walker.y)
    }
  })
}

const missing = (what: string): never => {
  throw WireError.make({ reason: `A diff changed an unknown ${what}` })
}

const applyDotChange = (reader: Reader, dots: ReadonlyArray<Dot>) => {
  const slot = reader.u8()
  const mask = reader.u8()
  if ((mask & DOT_NEW) !== 0) {
    const dot = readDot(reader)
    return pipe(
      Array.filter(dots, existing => existing.slot !== slot),
      Array.append(dot),
      Array.sort((a: Dot, b: Dot) => numberOrder(a.slot, b.slot)),
    )
  }
  const before = Option.getOrElse(dotBySlot(dots, slot), () => missing('dot'))
  const x = (mask & DOT_X) !== 0 ? reader.position() : before.x
  const y = (mask & DOT_Y) !== 0 ? reader.position() : before.y
  const away = (mask & DOT_AWAY) !== 0 ? reader.bool() : before.away
  const score = (mask & DOT_SCORE) !== 0 ? reader.varint() : before.score
  return Array.map(dots, dot =>
    dot.slot === slot ? { slot, x, y, away, score } : dot,
  )
}

const applyWalkerChange = (reader: Reader, walkers: ReadonlyArray<Walker>) => {
  const id = reader.varint()
  const mask = reader.u8()
  if ((mask & WALKER_NEW) !== 0) {
    return Array.append(walkers, {
      id,
      x: reader.position(),
      y: reader.position(),
      vx: 0,
      vy: 0,
    })
  }
  const before = Option.getOrElse(walkerById(walkers, id), () =>
    missing('walker'),
  )
  const x = (mask & WALKER_X) !== 0 ? reader.position() : before.x
  const y = (mask & WALKER_Y) !== 0 ? reader.position() : before.y
  return Array.map(walkers, walker =>
    walker.id === id ? { ...walker, x, y } : walker,
  )
}

const applyDiff = (reader: Reader, prev: StandInWorld): StandInWorld => {
  const tick = prev.tick + reader.varint()
  const goneSlots = repeat(reader.u8(), () => reader.u8())
  const keptDots = Array.filter(
    prev.dots,
    dot => !Array.contains(goneSlots, dot.slot),
  )
  const dots = Array.reduce(
    repeat(reader.u8(), () => 0),
    keptDots,
    current => applyDotChange(reader, current),
  )
  const goneIds = repeat(reader.varint(), () => reader.varint())
  const keptWalkers = Array.filter(
    prev.walkers,
    walker => !Array.contains(goneIds, walker.id),
  )
  const walkerChanges = reader.varint()
  if (walkerChanges > MAX_WALKERS) {
    throw WireError.make({ reason: `${walkerChanges} walker changes` })
  }
  const walkers = Array.reduce(
    repeat(walkerChanges, () => 0),
    keptWalkers,
    current => applyWalkerChange(reader, current),
  )
  return { tick, dots, walkers, rng: prev.rng, nextId: prev.nextId }
}

// INTERPOLATION

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t

const interpolate = (
  from: StandInWorld,
  to: StandInWorld,
  t: number,
): StandInWorld => ({
  ...to,
  dots: Array.map(to.dots, dot =>
    Option.match(dotBySlot(from.dots, dot.slot), {
      onNone: () => dot,
      onSome: before => ({
        ...dot,
        x: lerp(before.x, dot.x, t),
        y: lerp(before.y, dot.y, t),
      }),
    }),
  ),
  walkers: Array.map(to.walkers, walker =>
    Option.match(
      Option.filter(
        walkerById(from.walkers, walker.id),
        before =>
          Math.hypot(before.x - walker.x, before.y - walker.y) <
          TELEPORT_DISTANCE,
      ),
      {
        onNone: () => walker,
        onSome: before => ({
          ...walker,
          x: lerp(before.x, walker.x, t),
          y: lerp(before.y, walker.y, t),
        }),
      },
    ),
  ),
})

// WORLD

export const StandIn: World<StandInWorld, Dot> = {
  name: 'StandIn',
  start,
  step,
  removePlayer: (world, slot) => ({
    ...world,
    dots: Array.filter(world.dots, dot => dot.slot !== slot),
  }),
  isOver: world => world.tick >= ROUND_TICKS,
  isWon: () => false,
  scores: (world): ReadonlyArray<Score> =>
    Array.map(world.dots, dot => ({ slot: dot.slot, score: dot.score })),
  snapshot,
  readSnapshot,
  diff,
  applyDiff,
  interpolate,
  own: {
    of: (world, slot) => dotBySlot(world.dots, slot),
    put: (world, slot, own) => ({
      ...world,
      dots: Array.map(world.dots, dot => (dot.slot === slot ? own : dot)),
    }),
    step: (own, input) => (own.away ? own : moveDot(own, input)),
    gap: (a, b) => Math.hypot(a.x - b.x, a.y - b.y),
    blend: (from, to, t) => ({
      ...to,
      x: lerp(from.x, to.x, t),
      y: lerp(from.y, to.y, t),
    }),
  },
}
