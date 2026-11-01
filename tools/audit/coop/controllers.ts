// Co-op audit (tools/audit/coop.ts): what a player does in the room: held keys,
// walking routes, shooting, and the bot's roles.

import type { Page } from 'playwright-core'

import { PARLOUR, isWalkableTile, tileCoordinate } from '@game/arena'
import { TILE_SIZE } from '@game/constants'
import { type Readout } from '@game/coop/readout'

import { nowMs, pollUntil } from '../lib'
import { type Seat, readoutOf, slotOf, toClient } from './readouts'

// CONTROLLERS

const MOVE_KEYS = { left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS' }

export type Held = { keys: Set<string>; firing: boolean }

const holdKeys = async (page: Page, held: Held, want: Set<string>) => {
  for (const key of held.keys) {
    if (!want.has(key)) {
      await page.keyboard.up(key)
    }
  }
  for (const key of want) {
    if (!held.keys.has(key)) {
      await page.keyboard.down(key)
    }
  }
  held.keys = want
}

export const stopAll = async (page: Page, held: Held) => {
  await holdKeys(page, held, new Set())
  if (held.firing) {
    await page.mouse.up()
    held.firing = false
  }
}

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
        isWalkableTile(PARLOUR, next.x, next.y) &&
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
  const next = STEPS.find(
    step => distances.get(tileKey(column + step.x, row + step.y)) === here - 1,
  )
  return next === undefined
    ? keysToward(from, goal, near)
    : keysToward(
        from,
        {
          x: (column + next.x + 0.5) * TILE_SIZE,
          y: (row + next.y + 0.5) * TILE_SIZE,
        },
        2,
      )
}

const nearestOf = (
  zombies: Readout['zombies'],
  at: Readonly<{ x: number; y: number }>,
) =>
  zombies.reduce<Readout['zombies'][number] | undefined>(
    (best, zombie) =>
      best === undefined ||
      Math.hypot(zombie.x - at.x, zombie.y - at.y) <
        Math.hypot(best.x - at.x, best.y - at.y)
        ? zombie
        : best,
    undefined,
  )

// NOTE: aims the mouse at the nearest zombie in the parlour and holds the
// trigger; with none in, lets go.
const AIM_REACH_PX = 20

const shootNearest = async (
  page: Page,
  held: Held,
  readout: Readout,
  own: Seat,
  isTarget: (zombie: Point) => boolean = () => true,
) => {
  const target = nearestOf(
    readout.zombies.filter(
      zombie =>
        zombie.x > 0 &&
        zombie.x < 320 &&
        zombie.y > 0 &&
        zombie.y < 180 &&
        isTarget(zombie),
    ),
    own,
  )
  if (target === undefined) {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    return
  }
  // NOTE: the mouse points along the line to the zombie, a short way from
  // the player, not at the zombie itself: a zombie down by the HUD would
  // put the click on a slot (the knife's draws the knife), not the room.
  const gap = Math.max(1, Math.hypot(target.x - own.x, target.y - own.y))
  const reach = Math.min(gap, AIM_REACH_PX)
  const at = await toClient(
    page,
    own.x + ((target.x - own.x) / gap) * reach,
    own.y + ((target.y - own.y) / gap) * reach,
  )
  await page.mouse.move(at.x, at.y)
  if (!held.firing) {
    await page.mouse.down()
    held.firing = true
  }
}

type Role = 'Fight' | 'Feed' | 'Guard' | 'Revive' | 'Shop' | 'Idle'

const distance = (from: Point, to: Point) =>
  Math.hypot(to.x - from.x, to.y - from.y)

// NOTE: how near a zombie comes before a guard or a reviver turns on it.
const THREAT_PX = 28

const PARLOUR_MIDDLE = { x: 160, y: 96 }

// NOTE: one step of one page's player, from what its own page draws.
const drive = async (
  page: Page,
  held: Held,
  role: Role,
  partner: number,
): Promise<void> => {
  const readout = await readoutOf(page)
  const slot = await slotOf(page)
  const own = readout?.players.find(seat => seat.slot === slot)
  if (readout === undefined || own === undefined) {
    return
  }
  if (role === 'Idle' || own.life !== 'Standing') {
    return stopAll(page, held)
  }
  if (role === 'Feed') {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    // NOTE: the feeder walks unarmed into the nearest zombie already in the
    // room, never out into a doorway's crowd, so they go down where the
    // others fight and the team stays close.
    const inside = readout.zombies.filter(
      zombie =>
        zombie.x > 24 && zombie.x < 296 && zombie.y > 36 && zombie.y < 168,
    )
    return holdKeys(
      page,
      held,
      routeKeys(own, nearestOf(inside, own) ?? PARLOUR_MIDDLE, 2),
    )
  }
  const mate = readout.players.find(seat => seat.slot === partner)
  if (role === 'Guard') {
    // NOTE: while the feeder walks into the zombies, the others stand still
    // and shoot only what comes at them, never a zombie by the feeder: a
    // teammate who took bites here had too few hearts left to revive.
    await holdKeys(page, held, new Set())
    return shootNearest(
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
    const isThreatened = readout.zombies.some(
      zombie =>
        distance(zombie, own) < THREAT_PX ||
        (mate !== undefined && distance(zombie, mate) < THREAT_PX),
    )
    const isClose = mate !== undefined && distance(mate, own) < 9
    await holdKeys(
      page,
      held,
      mate === undefined || isClose || isThreatened
        ? new Set()
        : routeKeys(own, mate, 3),
    )
    return shootNearest(page, held, readout, own)
  }
  if (role === 'Shop') {
    if (held.firing) {
      await page.mouse.up()
      held.firing = false
    }
    // NOTE: the counter opens within SHOP_REACH_PX (12) of the stall, so a
    // spot 6 px left of its middle is in reach.
    const beside = {
      x: readout.stall.left - 6,
      y: (readout.stall.top + readout.stall.bottom) / 2,
    }
    return holdKeys(
      page,
      held,
      own.shop === 'Browsing' ? new Set() : routeKeys(own, beside, 1),
    )
  }
  const leg = Math.floor(nowMs() / 900 + slot) % 4
  const drift =
    [MOVE_KEYS.right, MOVE_KEYS.down, MOVE_KEYS.left, MOVE_KEYS.up][leg] ??
    MOVE_KEYS.right
  const home =
    Math.hypot(own.x - PARLOUR_MIDDLE.x, own.y - PARLOUR_MIDDLE.y) > 50
  await holdKeys(
    page,
    held,
    home ? routeKeys(own, PARLOUR_MIDDLE, 6) : new Set([drift]),
  )
  return shootNearest(page, held, readout, own)
}

export const heldOf = (helds: ReadonlyArray<Held>, index: number): Held => {
  const held = helds[index]
  if (held === undefined) {
    throw new Error(`no keys held for player ${index + 1}`)
  }
  return held
}

export const playFor = async (
  everyone: ReadonlyArray<Page>,
  helds: ReadonlyArray<Held>,
  roleOf: (index: number) => Role,
  partner: number,
  isDone: () => Promise<boolean>,
  timeoutMs: number,
): Promise<boolean> => {
  const { last: isMet } = await pollUntil(
    async () => {
      await Promise.all(
        everyone.map((page, index) =>
          drive(page, heldOf(helds, index), roleOf(index), partner).catch(
            () => {},
          ),
        ),
      )
      return isDone().catch(() => false)
    },
    hasFinished => hasFinished,
    90,
    timeoutMs,
  )
  return isMet
}
