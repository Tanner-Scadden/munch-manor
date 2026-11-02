import { Array, Option, Result, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  COVER_SYMBOLS,
  type Level,
  circleTouchesBox,
  distanceToBox,
  isOnSoupAt,
  levelOf,
  maybeExit,
  tileBox,
  tilesWithSymbol,
} from './arena'
import { ZOMBIE_BLAST_TARGET, bountyOf } from './combat'
import { BULLET_STEP_PX } from './constants'
import { KITCHEN_EXIT, boxAround } from './exits'
import { payKillShared } from './party'
import type { World } from './world'
import {
  GameEvent,
  Oven,
  type Vector,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from './worldSchema'
import { bodyRadiusOf, isFree, isGrounded, statsOf } from './zombies'

// OVENS

type OvenRules = Readonly<{
  belchMs: number
  tickMs: number
  ticks: number
  damagePerTick: number
  cooldownMs: number
  reachPx: number
  sidePx: number
  knockback: number
  strikePx: number
}>

export const OVEN_RULES: OvenRules = {
  belchMs: 700,
  tickMs: 175,
  ticks: 4,
  damagePerTick: 3,
  cooldownMs: 8000,
  reachPx: 28,
  sidePx: 2,
  knockback: 70,
  strikePx: BULLET_STEP_PX + 1,
}

const OVEN_SYMBOL = pipe(
  Object.entries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Oven'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'G'),
)

const isOvenCorner =
  (tiles: ReadonlyArray<Readonly<{ column: number; row: number }>>) =>
  ({ column, row }: Readonly<{ column: number; row: number }>): boolean =>
    !Array.some(
      tiles,
      other =>
        (other.column === column - 1 && other.row === row) ||
        (other.column === column && other.row === row - 1),
    )

const ovenBoxesBuilt = new WeakMap<Level, ReadonlyArray<Box>>()

// NOTE: each oven is a block of oven tiles on the map, in reading order. A
// level keeps its list, so a frame only reads it.
export const ovenBoxesOf = (level: Level): ReadonlyArray<Box> => {
  const cached = ovenBoxesBuilt.get(level)
  if (cached !== undefined) {
    return cached
  }
  const tiles = tilesWithSymbol(level, OVEN_SYMBOL)
  const boxes = Array.filterMap(
    Array.filter(tiles, isOvenCorner(tiles)),
    corner =>
      Option.match(
        boxAround(
          Array.map(
            Array.filter(
              tiles,
              ({ column, row }) =>
                column >= corner.column &&
                column <= corner.column + 1 &&
                row >= corner.row &&
                row <= corner.row + 1,
            ),
            tileBox,
          ),
        ),
        { onNone: () => Result.failVoid, onSome: Result.succeed },
      ),
  )
  ovenBoxesBuilt.set(level, boxes)
  return boxes
}

export const flameBoxOf = (oven: Box): Box => ({
  left: oven.left - OVEN_RULES.sidePx,
  top: oven.bottom,
  right: oven.right + OVEN_RULES.sidePx,
  bottom: oven.bottom + OVEN_RULES.reachPx,
})

export const isKitchenOpen = (level: Level): boolean =>
  Option.exists(maybeExit(level, KITCHEN_EXIT), ({ isOpen }) => isOpen)

export const freshOvens = (level: Level): ReadonlyArray<Oven> =>
  Array.map(ovenBoxesOf(level), () => Oven.Ready())

const ovenAt = (model: World, index: number): Oven =>
  Option.getOrElse(Array.get(model.ovens, index), () => Oven.Ready())

export const ovensOf = (model: World): ReadonlyArray<Oven> =>
  Array.map(ovenBoxesOf(levelOf(model)), (_, index) => ovenAt(model, index))

const isStruckBy =
  (oven: Box) =>
  (event: GameEvent): boolean =>
    GameEvent.isAnyOf(['BulletStruck'])(event) &&
    distanceToBox(event, oven) <= OVEN_RULES.strikePx

const belching = (): Oven =>
  Oven.Belching({ remainingMs: OVEN_RULES.belchMs, burnedTicks: 0 })

const ignite = (model: World): World => {
  const boxes = ovenBoxesOf(levelOf(model))
  const struck = Array.map(
    boxes,
    (box, index) =>
      Oven.isAnyOf(['Ready'])(ovenAt(model, index)) &&
      Array.some(model.frameEvents, isStruckBy(box)),
  )
  if (!Array.some(struck, isLit => isLit)) {
    return model
  }
  return modifyFields(model, {
    ovens: () =>
      Array.map(boxes, (_, index) =>
        struck[index] === true ? belching() : ovenAt(model, index),
      ),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.filterMap(boxes, (box, index) =>
        struck[index] === true
          ? Result.succeed(
              GameEvent.OvenBelched({
                x: (box.left + box.right) / 2,
                y: box.bottom,
              }),
            )
          : Result.failVoid,
      ),
    ],
  })
}

const isInFlames =
  (flames: Box) =>
  (zombie: Zombie): boolean =>
    isGrounded(zombie) && circleTouchesBox(zombie, bodyRadiusOf(zombie), flames)

const SCORCH_DIRECTION: Vector = { x: 0, y: 1 }

const scorch = (model: World, oven: Box): World => {
  const flames = flameBoxOf(oven)
  const outcomes = Array.map(model.zombies, zombie =>
    isInFlames(flames)(zombie)
      ? ZOMBIE_BLAST_TARGET.hurt(zombie, {
          damage: OVEN_RULES.damagePerTick,
          direction: SCORCH_DIRECTION,
          knockbackSpeed: OVEN_RULES.knockback,
        })
      : { target: zombie, events: [] },
  )
  const events = Array.flatMap(outcomes, outcome => outcome.events)
  return Array.isReadonlyArrayEmpty(events)
    ? model
    : payKillShared(
        modifyFields(model, {
          zombies: () => Array.map(outcomes, ({ target }) => target),
          frameEvents: frameEvents => [...frameEvents, ...events],
        }),
        bountyOf(events),
      )
}

type Heat = Readonly<{ oven: Oven; ticksDue: number }>

const heatUp = (oven: Oven, deltaMs: number): Heat =>
  Oven.match(oven, {
    Ready: () => ({ oven, ticksDue: 0 }),
    Belching: ({ remainingMs, burnedTicks }) => {
      const left = remainingMs - deltaMs
      const burned = Math.min(
        OVEN_RULES.ticks,
        Math.floor(
          (OVEN_RULES.belchMs - Math.max(0, left)) / OVEN_RULES.tickMs,
        ) + 1,
      )
      return {
        oven:
          left > 0
            ? Oven.Belching({ remainingMs: left, burnedTicks: burned })
            : Oven.Cooling({ remainingMs: OVEN_RULES.cooldownMs }),
        ticksDue: Math.max(0, burned - burnedTicks),
      }
    },
    Cooling: ({ remainingMs }) => ({
      oven:
        remainingMs > deltaMs
          ? Oven.Cooling({ remainingMs: remainingMs - deltaMs })
          : Oven.Ready(),
      ticksDue: 0,
    }),
  })

const isIdle = Oven.isAnyOf(['Ready'])

// NOTE: Array.makeBy makes at least one item, so the ticks due are picked
// out of a full belch's ticks rather than made from their count.
// A belch burns whatever stands in front of the oven once every tick,
// so a zombie that walks into the flames late still gets singed, and one
// that stands in them the whole time takes every tick.
const tickOvens = (model: World, deltaMs: number): World => {
  if (Array.every(model.ovens, isIdle)) {
    return model
  }
  const boxes = ovenBoxesOf(levelOf(model))
  const heats = Array.map(boxes, (_, index) =>
    heatUp(ovenAt(model, index), deltaMs),
  )
  const heated: World = modifyFields(model, {
    ovens: () => Array.map(heats, ({ oven }) => oven),
  })
  return Array.reduce(
    Array.zip(boxes, heats),
    heated,
    (current: World, [box, { ticksDue }]) =>
      Array.reduce(
        Array.filter(
          Array.makeBy(OVEN_RULES.ticks, index => index),
          index => index < ticksDue,
        ),
        current,
        (scorched: World) => scorch(scorched, box),
      ),
  )
}

// SOUP

type SoupRules = Readonly<{
  slipMs: number
  skidSpeed: number
  playerSkidAccel: number
}>

const SOUP_RULES: SoupRules = {
  slipMs: 900,
  skidSpeed: 70,
  playerSkidAccel: 260,
}

const SLIPPERS: ReadonlyArray<ZombieKind> = [
  'Shambler',
  'Runner',
  'Exploder',
  'Thrower',
]

const canSlip = (zombie: Zombie): boolean =>
  isFree(zombie) && Array.contains(SLIPPERS, zombie.kind)

const skidOf = (zombie: Zombie, before: Vector): Vector => {
  const deltaX = zombie.x - before.x
  const deltaY = zombie.y - before.y
  const length = Math.hypot(deltaX, deltaY)
  const speed = SOUP_RULES.skidSpeed * statsOf(zombie).knockbackScale
  return length > 0
    ? { x: (deltaX / length) * speed, y: (deltaY / length) * speed }
    : { x: 0, y: 0 }
}

const slip = (zombie: Zombie, before: Vector): Zombie =>
  modifyFields(zombie, {
    action: () =>
      ZombieAction.Dazed({
        remainingMs: SOUP_RULES.slipMs,
        durationMs: SOUP_RULES.slipMs,
      }),
    knockback: () => skidOf(zombie, before),
  })

// NOTE: a zombie that steps onto spilled soup from dry floor loses its
// footing: it skids on in the way it was walking and lies there dazed for a
// moment. One that gets up in the soup walks out of it, so it never slips
// forever. Big Lugs, Ankle Biters, and Uncle Chunk keep their feet.
const slipOnSoup = (before: World, model: World): World => {
  const level = levelOf(model)
  if (!level.hasSoup || !isKitchenOpen(level)) {
    return model
  }
  const was = new Map(
    Array.map(before.zombies, ({ id, x, y }) => [id, { x, y }] as const),
  )
  const slipped = Array.map(model.zombies, zombie => {
    const from = was.get(zombie.id)
    return from !== undefined &&
      canSlip(zombie) &&
      isOnSoupAt(level, zombie) &&
      !isOnSoupAt(level, from)
      ? Option.some(from)
      : Option.none()
  })
  if (!Array.some(slipped, Option.isSome)) {
    return model
  }
  return modifyFields(model, {
    zombies: zombies =>
      Array.map(zombies, (zombie, index) =>
        Option.match(Option.flatten(Option.fromNullishOr(slipped[index])), {
          onNone: () => zombie,
          onSome: from => slip(zombie, from),
        }),
      ),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.filterMap(model.zombies, (zombie, index) =>
        Option.match(Option.flatten(Option.fromNullishOr(slipped[index])), {
          onNone: () => Result.failVoid,
          onSome: () =>
            Result.succeed(
              GameEvent.ZombieSlipped({ x: zombie.x, y: zombie.y }),
            ),
        }),
      ),
    ],
  })
}

// NOTE: the player slides a little on soup: moving there builds up a skid
// that carries on for a moment after the stick lets go.
export const soupSkid = (
  level: Level,
  position: Vector,
  move: Vector,
  seconds: number,
): Vector =>
  isOnSoupAt(level, position)
    ? {
        x: move.x * SOUP_RULES.playerSkidAccel * seconds,
        y: move.y * SOUP_RULES.playerSkidAccel * seconds,
      }
    : { x: 0, y: 0 }

// FRAME

export const advanceKitchen = (
  before: World,
  model: World,
  deltaMs: number,
): World =>
  isKitchenOpen(levelOf(model))
    ? slipOnSoup(before, tickOvens(ignite(model), deltaMs))
    : model
