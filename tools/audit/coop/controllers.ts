// Co-op audit (tools/audit/coop.ts): what a player does in the room: held keys,
// walking routes, shooting, and the bot's roles.

import { Array, Clock, Effect, Function, Option } from 'effect'
import type { Page } from 'playwright-core'

import { type Readout } from '@game/features/coop/readout'
import { TILE_SIZE } from '@game/shared/constants'
import { START_LEVEL } from '@game/world/level/arena'
import { isWalkableTile, tileCoordinate } from '@game/world/level/tileQueries'

import { pollUntil } from '../lib'
import { type AuditFailed, attempt, failWith } from '../page'
import { type Seat, readoutOf, slotOf, toClient } from './readouts'

// CONTROLLERS

const MOVE_KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' }

export type Held = { keys: Set<string>; firing: boolean }

const holdKeys = (page: Page, held: Held, want: Set<string>) =>
  Effect.gen(function* () {
    for (const key of held.keys) {
      if (!want.has(key)) {
        yield* attempt(() => page.keyboard.up(key))
      }
    }
    for (const key of want) {
      if (!held.keys.has(key)) {
        yield* attempt(() => page.keyboard.down(key))
      }
    }
    held.keys = want
  })

// NOTE: lets go of the trigger if it is held.
const release = (page: Page, held: Held) =>
  Effect.gen(function* () {
    if (held.firing) {
      yield* attempt(() => page.mouse.up())
      held.firing = false
    }
  })

export const stopAll: {
  (held: Held): (page: Page) => Effect.Effect<void, AuditFailed>
  (page: Page, held: Held): Effect.Effect<void, AuditFailed>
} = Function.dual(
  2,
  (page: Page, held: Held): Effect.Effect<void, AuditFailed> =>
    Effect.andThen(holdKeys(page, held, new Set()), release(page, held)),
)

const keysToward = (
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  near = 6,
): Set<string> => {
  const keys = new Set<string>()
  if (to.x - from.x > near) {
    keys.add(MOVE_KEYS.right)
  }
  if (from.x - to.x > near) {
    keys.add(MOVE_KEYS.left)
  }
  if (to.y - from.y > near) {
    keys.add(MOVE_KEYS.down)
  }
  if (from.y - to.y > near) {
    keys.add(MOVE_KEYS.up)
  }
  return keys
}

// NOTE: a walk across the parlour goes round its furniture, tile by tile,
// on the game's own map: a straight line from one side to the other can
// run into a crate or a table and hold the key against it until the step
// times out. Each tile's distance to the goal's tile comes from one
// breadth-first pass over the walkable tiles, four ways, and the player
// heads for the middle of the next tile down that slope. On the goal's tile
// it heads for the goal itself.
type Point = Readonly<{ x: number; y: number }>

const STEPS: ReadonlyArray<Point> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]

const tileKey = (column: number, row: number) => `${column},${row}`

const distancesTo = (goal: Point): ReadonlyMap<string, number> => {
  const start = { x: tileCoordinate(goal.x), y: tileCoordinate(goal.y) }
  const distances = new Map([[tileKey(start.x, start.y), 0]])
  const queue = [start]
  for (const tile of queue) {
    const distance = distances.get(tileKey(tile.x, tile.y)) ?? 0
    for (const step of STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y }
      if (
        isWalkableTile(START_LEVEL, next.x, next.y) &&
        !distances.has(tileKey(next.x, next.y))
      ) {
        distances.set(tileKey(next.x, next.y), distance + 1)
        queue.push(next)
      }
    }
  }
  return distances
}

const routeKeys = (from: Point, goal: Point, near: number): Set<string> => {
  const column = tileCoordinate(from.x)
  const row = tileCoordinate(from.y)
  const distances = distancesTo(goal)
  const here = distances.get(tileKey(column, row))
  if (here === undefined || here === 0) {
    return keysToward(from, goal, near)
  }
  return Option.match(
    Array.findFirst(
      STEPS,
      step =>
        distances.get(tileKey(column + step.x, row + step.y)) === here - 1,
    ),
    {
      onNone: () => keysToward(from, goal, near),
      onSome: next =>
        keysToward(
          from,
          {
            x: (column + next.x + 0.5) * TILE_SIZE,
            y: (row + next.y + 0.5) * TILE_SIZE,
          },
          2,
        ),
    },
  )
}

type Zombie = Readout['zombies'][number]

const nearestOf = (
  zombies: Readout['zombies'],
  at: Readonly<{ x: number; y: number }>,
) =>
  Array.reduce(zombies, Option.none<Zombie>(), (best, zombie) =>
    Option.isNone(best) ||
    Math.hypot(zombie.x - at.x, zombie.y - at.y) <
      Math.hypot(best.value.x - at.x, best.value.y - at.y)
      ? Option.some(zombie)
      : best,
  )

// NOTE: aims the mouse at the nearest zombie in the parlour and holds the
// trigger; with none in, lets go.
const AIM_REACH_PX = 20

const shootNearest = (
  page: Page,
  held: Held,
  readout: Readout,
  own: Seat,
  isTarget: (zombie: Point) => boolean,
) =>
  Option.match(
    nearestOf(
      Array.filter(
        readout.zombies,
        zombie =>
          zombie.x > 0 &&
          zombie.x < 320 &&
          zombie.y > 0 &&
          zombie.y < 180 &&
          isTarget(zombie),
      ),
      own,
    ),
    {
      onNone: () => release(page, held),
      onSome: target =>
        Effect.gen(function* () {
          // NOTE: the mouse points along the line to the zombie, a short way
          // from the player, not at the zombie itself: a zombie down by the
          // HUD would put the click on a slot (the knife's draws the knife),
          // not the room.
          const gap = Math.max(
            1,
            Math.hypot(target.x - own.x, target.y - own.y),
          )
          const reach = Math.min(gap, AIM_REACH_PX)
          const at = yield* toClient(
            page,
            own.x + ((target.x - own.x) / gap) * reach,
            own.y + ((target.y - own.y) / gap) * reach,
          )
          yield* attempt(() => page.mouse.move(at.x, at.y))
          if (!held.firing) {
            yield* attempt(() => page.mouse.down())
            held.firing = true
          }
        }),
    },
  )

const anyZombie = () => true

type Role = 'Fight' | 'Feed' | 'Guard' | 'Revive' | 'Idle'

const distance = (from: Point, to: Point) =>
  Math.hypot(to.x - from.x, to.y - from.y)

// NOTE: how near a zombie comes before a guard or a reviver turns on it.
const THREAT_PX = 28

// NOTE: the open aisle between the party table and the start spot.
const ROOM_MIDDLE = { x: START_LEVEL.start.x, y: START_LEVEL.start.y - 15 }

// NOTE: one step of one page's player, from what its own page draws.
const drive = (page: Page, held: Held, role: Role, partner: number) =>
  Effect.gen(function* () {
    const readout = yield* readoutOf(page)
    const slot = yield* slotOf(page)
    const own = Option.getOrUndefined(
      Array.findFirst(readout?.players ?? [], seat => seat.slot === slot),
    )
    if (readout === undefined || own === undefined) {
      return
    }
    if (role === 'Idle' || own.life !== 'Standing') {
      return yield* stopAll(page, held)
    }
    if (role === 'Feed') {
      yield* release(page, held)
      // NOTE: the feeder walks unarmed into the nearest zombie already in the
      // room, never out into a doorway's crowd, so they go down where the
      // others fight and the team stays close.
      const inside = Array.filter(
        readout.zombies,
        zombie =>
          zombie.x > 24 && zombie.x < 296 && zombie.y > 36 && zombie.y < 168,
      )
      return yield* holdKeys(
        page,
        held,
        routeKeys(
          own,
          Option.getOrElse(nearestOf(inside, own), () => ROOM_MIDDLE),
          2,
        ),
      )
    }
    const mate = Option.getOrUndefined(
      Array.findFirst(readout.players, seat => seat.slot === partner),
    )
    if (role === 'Guard') {
      // NOTE: while the feeder walks into the zombies, the others stand still
      // and shoot only what comes at them, never a zombie by the feeder: a
      // teammate who took bites here had too few hearts left to revive.
      yield* holdKeys(page, held, new Set())
      return yield* shootNearest(
        page,
        held,
        readout,
        own,
        zombie =>
          distance(zombie, own) < THREAT_PX &&
          (mate === undefined || distance(zombie, mate) > THREAT_PX),
      )
    }
    if (role === 'Revive') {
      // NOTE: the reviver stands still and shoots while a zombie is near it
      // or the downed player, and walks in only once that is clear: walking
      // into the crowd that downed them got the reviver eaten too. Standing
      // still in reach counts toward the revive either way.
      const isThreatened = Array.some(
        readout.zombies,
        zombie =>
          distance(zombie, own) < THREAT_PX ||
          (mate !== undefined && distance(zombie, mate) < THREAT_PX),
      )
      const isClose = mate !== undefined && distance(mate, own) < 9
      yield* holdKeys(
        page,
        held,
        mate === undefined || isClose || isThreatened
          ? new Set()
          : routeKeys(own, mate, 3),
      )
      return yield* shootNearest(page, held, readout, own, anyZombie)
    }
    const nowMs = yield* Clock.currentTimeMillis
    const leg = Math.floor(nowMs / 900 + slot) % 4
    const drift =
      [MOVE_KEYS.right, MOVE_KEYS.down, MOVE_KEYS.left, MOVE_KEYS.up][leg] ??
      MOVE_KEYS.right
    const home = Math.hypot(own.x - ROOM_MIDDLE.x, own.y - ROOM_MIDDLE.y) > 50
    yield* holdKeys(
      page,
      held,
      home ? routeKeys(own, ROOM_MIDDLE, 6) : new Set([drift]),
    )
    return yield* shootNearest(page, held, readout, own, anyZombie)
  })

export const heldOf: {
  (
    index: number,
  ): (helds: ReadonlyArray<Held>) => Effect.Effect<Held, AuditFailed>
  (helds: ReadonlyArray<Held>, index: number): Effect.Effect<Held, AuditFailed>
} = Function.dual(
  2,
  (
    helds: ReadonlyArray<Held>,
    index: number,
  ): Effect.Effect<Held, AuditFailed> =>
    Effect.fromOption(Array.get(helds, index)).pipe(
      Effect.mapError(() => failWith(`no keys held for player ${index + 1}`)),
    ),
)

export const playFor: {
  <E>(
    helds: ReadonlyArray<Held>,
    roleOf: (index: number) => Role,
    partner: number,
    isDone: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): (everyone: ReadonlyArray<Page>) => Effect.Effect<boolean>
  <E>(
    everyone: ReadonlyArray<Page>,
    helds: ReadonlyArray<Held>,
    roleOf: (index: number) => Role,
    partner: number,
    isDone: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): Effect.Effect<boolean>
} = Function.dual(
  6,
  <E>(
    everyone: ReadonlyArray<Page>,
    helds: ReadonlyArray<Held>,
    roleOf: (index: number) => Role,
    partner: number,
    isDone: Effect.Effect<boolean, E>,
    timeoutMs: number,
  ): Effect.Effect<boolean> =>
    Effect.andThen(
      Effect.forEach(
        everyone,
        (page, index) =>
          heldOf(helds, index).pipe(
            Effect.flatMap(held => drive(page, held, roleOf(index), partner)),
            Effect.ignore,
          ),
        { concurrency: 'unbounded', discard: true },
      ),
      isDone.pipe(Effect.orElseSucceed(() => false)),
    ).pipe(
      pollUntil(hasFinished => hasFinished, 90, timeoutMs),
      Effect.map(({ last }) => last),
    ),
)
