import { Array, Function, Order, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS } from '../../shared/constants'
import { type Seeded, between, nextRandom } from '../../shared/prng'
import { trapBlockers } from '../gear/traps'
import { type Level, distanceToBox, isSolidAt } from '../level/arena'
import { nearestOf, targetsOf } from '../party/party'
import type { World } from '../schema/world'
import {
  GameEvent,
  type Trap,
  type Vector,
  type Zombie,
  ZombieAction,
} from '../schema/worldSchema'
import { STALL_BOX } from '../shop/shop'
import { circlesOverlap, distanceBetween } from '../step/geometry'
import { bodyRadiusOf, isFree, isWalking } from './zombies'

// RULES

type CrawlerRules = {
  surfaceMs: number
  clearPx: number
  holdPx: number
  clingMs: number
  clingSlow: number
  windedMs: number
  draws: number
  footingPx: number
  doorClearPx: number
  propClearPx: number
}

export const CRAWLER_RULES: CrawlerRules = {
  surfaceMs: 600,
  clearPx: 56,
  holdPx: 40,
  clingMs: 1100,
  clingSlow: 0.5,
  windedMs: 2600,
  draws: 12,
  footingPx: 6,
  doorClearPx: 24,
  propClearPx: 8,
}

const CRAWLER_KIND = 'Crawler'

// WHERE IT COMES UP

const FLOOR_LEFT = 16
const FLOOR_RIGHT = 304
const FLOOR_TOP = 28
const FLOOR_BOTTOM = 164

// NOTE: the fallback spots are open floor in every corner and along every
// wall, so when no draw lands on good floor the one farthest from the player
// is still a fair place to come up.
const FALLBACK_SPOTS: Array.NonEmptyReadonlyArray<Vector> = [
  { x: 40, y: 60 },
  { x: 120, y: 30 },
  { x: 220, y: 34 },
  { x: 290, y: 70 },
  { x: 290, y: 120 },
  { x: 200, y: 160 },
  { x: 70, y: 160 },
  { x: 30, y: 125 },
]

const hasFooting = (level: Level, point: Vector): boolean =>
  Array.every(
    [
      point,
      { x: point.x - CRAWLER_RULES.footingPx, y: point.y },
      { x: point.x + CRAWLER_RULES.footingPx, y: point.y },
      { x: point.x, y: point.y - CRAWLER_RULES.footingPx },
      { x: point.x, y: point.y + CRAWLER_RULES.footingPx },
    ],
    corner => !isSolidAt(level, corner),
  )

const isClearOfDoors = (level: Level, point: Vector): boolean =>
  Array.every(
    level.doorIds,
    door =>
      distanceToBox(point, level.thresholds[door].box) >
      CRAWLER_RULES.doorClearPx,
  )

const isClearOfProps = (
  level: Level,
  point: Vector,
  traps: ReadonlyArray<Trap>,
): boolean =>
  distanceToBox(point, STALL_BOX) > CRAWLER_RULES.propClearPx &&
  Array.every(
    trapBlockers(level, traps),
    box => distanceToBox(point, box) > CRAWLER_RULES.propClearPx,
  )

const isFairSurfacing = (
  level: Level,
  point: Vector,
  player: Vector,
  traps: ReadonlyArray<Trap>,
): boolean =>
  distanceBetween(point, player) >= CRAWLER_RULES.clearPx &&
  hasFooting(level, point) &&
  isClearOfDoors(level, point) &&
  isClearOfProps(level, point, traps)

const byFarthestFrom = (player: Vector) =>
  Order.flip(
    Order.mapInput(Order.Number, (spot: Vector) =>
      distanceBetween(spot, player),
    ),
  )

const fallbackSpot = (player: Vector): Vector =>
  pipe(FALLBACK_SPOTS, Array.sort(byFarthestFrom(player)), Array.headNonEmpty)

const searchSpot = (
  level: Level,
  state: number,
  player: Vector,
  traps: ReadonlyArray<Trap>,
  drawsLeft: number,
): Seeded<Vector> => {
  if (drawsLeft <= 0) {
    return [state, fallbackSpot(player)]
  }

  const xDraw = nextRandom(state)
  const yDraw = nextRandom(xDraw.nextState)
  const point = {
    x: Math.round(between(xDraw.value, FLOOR_LEFT, FLOOR_RIGHT)),
    y: Math.round(between(yDraw.value, FLOOR_TOP, FLOOR_BOTTOM)),
  }
  return isFairSurfacing(level, point, player, traps)
    ? [yDraw.nextState, point]
    : searchSpot(level, yDraw.nextState, player, traps, drawsLeft - 1)
}

// NOTE: the spot is drawn from the seeded generator when the Ankle Biter is
// due, never planned in Preparation, since it must stay clear of wherever
// the player stands by then. The door preview counts it as FLOOR.
export const drawSurfacingSpot: {
  (
    state: number,
    player: Vector,
    traps: ReadonlyArray<Trap>,
  ): (level: Level) => Seeded<Vector>
  (
    level: Level,
    state: number,
    player: Vector,
    traps: ReadonlyArray<Trap>,
  ): Seeded<Vector>
} = Function.dual(
  4,
  (
    level: Level,
    state: number,
    player: Vector,
    traps: ReadonlyArray<Trap>,
  ): Seeded<Vector> =>
    searchSpot(level, state, player, traps, CRAWLER_RULES.draws),
)

export const burrowed = (): ZombieAction =>
  ZombieAction.Burrowed({
    remainingMs: CRAWLER_RULES.surfaceMs,
    durationMs: CRAWLER_RULES.surfaceMs,
  })

// SURFACING

type Step = Readonly<{
  zombie: Zombie
  events: ReadonlyArray<GameEvent>
}>

const stay = (zombie: Zombie): Step => ({ zombie, events: [] })

const withAction = (zombie: Zombie, action: ZombieAction): Zombie =>
  modifyFields(zombie, { action: () => action })

const surface = (zombie: Zombie, player: Vector, deltaMs: number): Step => {
  if (!ZombieAction.isAnyOf(['Burrowed'])(zombie.action)) {
    return stay(zombie)
  }

  const { remainingMs, durationMs } = zombie.action
  if (remainingMs > deltaMs) {
    return stay(
      withAction(
        zombie,
        ZombieAction.Burrowed({
          remainingMs: remainingMs - deltaMs,
          durationMs,
        }),
      ),
    )
  } else if (distanceBetween(zombie, player) < CRAWLER_RULES.holdPx) {
    return stay(
      remainingMs === 0
        ? zombie
        : withAction(
            zombie,
            ZombieAction.Burrowed({ remainingMs: 0, durationMs }),
          ),
    )
  } else {
    return {
      zombie: withAction(zombie, ZombieAction.Roaming()),
      events: [GameEvent.CrawlerSurfaced({ x: zombie.x, y: zombie.y })],
    }
  }
}

// CLINGING

const ANKLE_OFFSET: Vector = { x: -5, y: 4 }

const isTouchingPlayer = (zombie: Zombie, player: Vector): boolean =>
  circlesOverlap(zombie, bodyRadiusOf(zombie), player, PLAYER_RADIUS)

const cling = (zombie: Zombie, player: Vector, deltaMs: number): Step => {
  if (ZombieAction.isAnyOf(['Clinging'])(zombie.action)) {
    const { remainingMs } = zombie.action
    const held = modifyFields(zombie, {
      x: () => player.x + ANKLE_OFFSET.x,
      y: () => player.y + ANKLE_OFFSET.y,
      knockback: () => ({ x: 0, y: 0 }),
    })
    return stay(
      remainingMs > deltaMs
        ? withAction(
            held,
            ZombieAction.Clinging({ remainingMs: remainingMs - deltaMs }),
          )
        : withAction(
            held,
            ZombieAction.Winded({ remainingMs: CRAWLER_RULES.windedMs }),
          ),
    )
  } else if (
    ZombieAction.isAnyOf(['Roaming'])(zombie.action) &&
    isFree(zombie) &&
    isTouchingPlayer(zombie, player)
  ) {
    return {
      zombie: withAction(
        zombie,
        ZombieAction.Clinging({ remainingMs: CRAWLER_RULES.clingMs }),
      ),
      events: [GameEvent.AnklesGrabbed({ x: player.x, y: player.y })],
    }
  } else {
    return stay(zombie)
  }
}

const stepCrawler =
  (targetFor: (zombie: Zombie) => Vector, deltaMs: number) =>
  (zombie: Zombie): Step => {
    if (zombie.kind !== CRAWLER_KIND || !isWalking(zombie)) {
      return stay(zombie)
    }
    const player = targetFor(zombie)
    const surfaced = surface(zombie, player, deltaMs)
    const clung = cling(surfaced.zombie, player, deltaMs)
    return {
      zombie: clung.zombie,
      events: [...surfaced.events, ...clung.events],
    }
  }

const hasCrawler = (zombies: ReadonlyArray<Zombie>): boolean =>
  Array.some(zombies, zombie => zombie.kind === CRAWLER_KIND)

export const advanceCrawlers: {
  (deltaMs: number): (model: World) => World
  (model: World, deltaMs: number): World
} = Function.dual(2, (model: World, deltaMs: number): World => {
  if (!hasCrawler(model.zombies)) {
    return model
  }

  const targets = targetsOf(model)
  const steps = Array.map(
    model.zombies,
    stepCrawler(zombie => nearestOf(targets, zombie), deltaMs),
  )
  return modifyFields(model, {
    zombies: () => Array.map(steps, ({ zombie }) => zombie),
    frameEvents: frameEvents => [
      ...frameEvents,
      ...Array.flatMap(steps, ({ events }) => events),
    ],
  })
})

// THE PLAYER'S ANKLES

export const ankleSlowAt = (zombies: ReadonlyArray<Zombie>): number =>
  Array.some(
    zombies,
    zombie =>
      isWalking(zombie) && ZombieAction.isAnyOf(['Clinging'])(zombie.action),
  )
    ? CRAWLER_RULES.clingSlow
    : 1

const ANKLE_REACH_PX = 4

// NOTE: in co-op an Ankle Biter slows only the player whose ankles it holds.
export const ankleSlowNear: {
  (player: Vector): (zombies: ReadonlyArray<Zombie>) => number
  (zombies: ReadonlyArray<Zombie>, player: Vector): number
} = Function.dual(
  2,
  (zombies: ReadonlyArray<Zombie>, player: Vector): number =>
    Array.some(
      zombies,
      zombie =>
        isWalking(zombie) &&
        ZombieAction.isAnyOf(['Clinging'])(zombie.action) &&
        circlesOverlap(
          zombie,
          bodyRadiusOf(zombie) + ANKLE_REACH_PX,
          player,
          PLAYER_RADIUS,
        ),
    )
      ? CRAWLER_RULES.clingSlow
      : 1,
)

export const surfacingProgress = (zombie: Zombie): number =>
  ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
    ? 1 - zombie.action.remainingMs / Math.max(1, zombie.action.durationMs)
    : 1
