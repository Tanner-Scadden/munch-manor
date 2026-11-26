import { Array, Function, Option, Result, Schema, pipe } from 'effect'

import { UiSchema } from '@effect/ui'

import type { ActStance } from '../art/appearance'
import type { Facing } from '../art/sprite'
import { PLAYER_RADIUS } from '../shared/constants'
import { sameIfUnchanged } from '../shared/sameList'
import { maybeFindWorkOf } from '../world/dare/dare'
import { DareKind } from '../world/dare/dareSchema'
import type { FindStyle } from '../world/dare/finds'
import { maybeMendingTrap, trapCenter } from '../world/gear/traps'
import { heldWeapon } from '../world/gear/weapons'
import { levelOf } from '../world/level/arena'
import {
  COOP_RULES,
  isStanding,
  playersOf,
  seatStateAt,
  trapOwnerOf,
} from '../world/party/party'
import { maybeRevivingOf } from '../world/party/revive'
import type { World } from '../world/schema/world'
import {
  GameEvent,
  type PlayerSlot,
  type Purchasable,
  type StationId,
  type Vector,
  isHolding,
} from '../world/schema/worldSchema'
import { holdProgress } from '../world/shop/purchase'
import { maybeStationWorkOf } from '../world/stations/stations'
import { isStill } from '../world/stations/work'
import { distanceBetween } from '../world/step/geometry'
import {
  type ActionBeat,
  type ActionWatch,
  Motion,
  Payoff,
} from './renderSchema'

export type Keyframe = Readonly<{ stance: ActStance; dx: number; dy: number }>

type MotionArt = Readonly<{
  frames: Array.NonEmptyReadonlyArray<Keyframe>
  frameMs: number
  maybeStrike: Option.Option<number>
}>

const frame = (stance: ActStance, dx = 0, dy = 0): Keyframe => ({
  stance,
  dx,
  dy,
})

export const MOTIONS: Readonly<Record<Motion, MotionArt>> = {
  Compress: {
    frames: [frame('KneelMid', 1), frame('KneelLow', 1, 1)],
    frameMs: 280,
    maybeStrike: Option.some(1),
  },
  Rummage: {
    frames: [
      frame('KneelLow', 1, 1),
      frame('KneelMid', 1),
      frame('KneelUp', 0, -1),
    ],
    frameMs: 140,
    maybeStrike: Option.none(),
  },
  Yank: {
    frames: [frame('Reach', 1), frame('Reach', 0), frame('ReachLow', -1)],
    frameMs: 120,
    maybeStrike: Option.none(),
  },
  Haul: {
    frames: [frame('FrontUp'), frame('BackUp', 0, 1)],
    frameMs: 220,
    maybeStrike: Option.none(),
  },
  Crank: {
    frames: [
      frame('ReachHigh', 0, -1),
      frame('Reach', 1),
      frame('ReachLow', 0, 1),
      frame('Reach', -1),
    ],
    frameMs: 110,
    maybeStrike: Option.none(),
  },
  Pull: {
    frames: [frame('FrontUp'), frame('ReachHigh', -1, 1)],
    frameMs: 200,
    maybeStrike: Option.none(),
  },
  Push: {
    frames: [frame('Reach', 0), frame('Reach', 1)],
    frameMs: 180,
    maybeStrike: Option.none(),
  },
  Shove: {
    frames: [frame('ReachLow', -1, 1), frame('Reach', 2)],
    frameMs: 160,
    maybeStrike: Option.some(1),
  },
  Hammer: {
    frames: [frame('KneelUp', 0, -1), frame('KneelMid', 1)],
    frameMs: 170,
    maybeStrike: Option.some(1),
  },
  Stir: {
    frames: [
      frame('Reach', 0),
      frame('ReachLow', 1),
      frame('Reach', 1),
      frame('ReachLow', 0),
    ],
    frameMs: 130,
    maybeStrike: Option.none(),
  },
  Pry: {
    frames: [frame('Reach', 1), frame('ReachLow', -1, 1)],
    frameMs: 160,
    maybeStrike: Option.some(1),
  },
}

const STATION_MOTIONS: Readonly<Record<StationId, Motion>> = {
  Cleat: 'Crank',
  Gramophone: 'Crank',
  NorthStack: 'Shove',
  SouthStack: 'Shove',
  Shelf: 'Push',
  Barrels: 'Shove',
  Bulb: 'Pull',
  SoupPot: 'Stir',
}

const FIND_MOTIONS: Readonly<Record<FindStyle, Option.Option<Motion>>> = {
  Walk: Option.none(),
  Rummage: Option.some('Rummage'),
  HollowBook: Option.some('Yank'),
  Dumbwaiter: Option.some('Haul'),
}

const PURCHASE_MOTIONS: Readonly<Record<Purchasable['_tag'], Motion>> = {
  Exit: 'Pry',
  Fridge: 'Pull',
  Prize: 'Yank',
  Stove: 'Stir',
  Valve: 'Crank',
  Case: 'Pry',
  BackDoor: 'Push',
}

export const paceOf = (share: number): number => {
  if (share >= 0.8) {
    return 1.65
  }
  return share >= 0.5 ? 1.3 : 1
}

export const motionFrameOf: {
  (share: number, elapsedMs: number): (motion: Motion) => number
  (motion: Motion, share: number, elapsedMs: number): number
} = Function.dual(
  3,
  (motion: Motion, share: number, elapsedMs: number): number => {
    const art = MOTIONS[motion]
    return (
      Math.floor((elapsedMs * paceOf(share)) / art.frameMs) % art.frames.length
    )
  },
)

export const keyframeOf: {
  (index: number): (motion: Motion) => Keyframe
  (motion: Motion, index: number): Keyframe
} = Function.dual(2, (motion: Motion, index: number): Keyframe => {
  const { frames } = MOTIONS[motion]
  return Option.getOrElse(Array.get(frames, index), () =>
    Array.headNonEmpty(frames),
  )
})

export const isStrikeFrame: {
  (index: number): (motion: Motion) => boolean
  (motion: Motion, index: number): boolean
} = Function.dual(2, (motion: Motion, index: number): boolean =>
  Option.contains(MOTIONS[motion].maybeStrike, index),
)

export const PAYOFF_MS: Readonly<Record<Payoff, number>> = {
  HoldUp: 850,
  FistPump: 620,
  SpringUp: 380,
  Swap: 260,
  SetTrap: 380,
  Grab: 280,
  PryOpen: 360,
}

export const ActionPose = UiSchema.TaggedEnum({
  Ready: {},
  Working: {
    motion: Motion,
    share: Schema.Finite,
    frame: Schema.Finite,
    facing: Schema.Literals(['Left', 'Right']),
    target: Schema.Struct({ x: Schema.Finite, y: Schema.Finite }),
  },
  Beat: {
    payoff: Payoff,
    share: Schema.Finite,
    maybeThing: Schema.Option(DareKind),
  },
})
export type ActionPose = typeof ActionPose.Type
export type WorkingPose = typeof ActionPose.cases.Working.Type
export type BeatPose = typeof ActionPose.cases.Beat.Type

const READY: ActionPose = ActionPose.Ready()

type Work = Readonly<{ motion: Motion; target: Vector; share: number }>

const facingTo = (from: Vector, to: Vector): Facing =>
  to.x < from.x ? 'Left' : 'Right'

const maybeWorkOf = (world: World, slot: PlayerSlot): Option.Option<Work> => {
  const { seat, player, purchase } = seatStateAt(world, slot)
  if (!isStanding(seat)) {
    return Option.none()
  }
  const holding = isHolding(purchase)
    ? Option.some<Work>({
        motion: PURCHASE_MOTIONS[purchase.target._tag],
        target: player,
        share: holdProgress(purchase),
      })
    : Option.none<Work>()
  if (!isStill(world, slot)) {
    return holding
  }
  return pipe(
    maybeRevivingOf(world, slot),
    Option.map(({ target, share }): Work => ({
      motion: 'Compress',
      target,
      share,
    })),
    Option.orElse(() =>
      Option.flatMap(maybeFindWorkOf(world, slot), ({ style, spot, share }) =>
        Option.map(FIND_MOTIONS[style], (motion): Work => ({
          motion,
          target: spot,
          share,
        })),
      ),
    ),
    Option.orElse(() =>
      Option.map(
        maybeStationWorkOf(world, slot),
        ({ id, center, share }): Work => ({
          motion: STATION_MOTIONS[id],
          target: center,
          share,
        }),
      ),
    ),
    Option.orElse(() =>
      Option.map(maybeMendingTrap(world, slot), (trap): Work => ({
        motion: 'Hammer',
        target: trapCenter(levelOf(world), trap),
        share: trap.hp / Math.max(1, trap.maxHp),
      })),
    ),
    Option.orElse(() => holding),
  )
}

const maybeBeatOf = (
  watch: ActionWatch,
  slot: PlayerSlot,
  elapsedMs: number,
): Option.Option<BeatPose> =>
  Option.map(
    Array.findLast(
      watch.beats,
      beat =>
        beat.slot === slot &&
        elapsedMs >= beat.startMs &&
        elapsedMs - beat.startMs < PAYOFF_MS[beat.payoff],
    ),
    beat =>
      ActionPose.Beat({
        payoff: beat.payoff,
        share: (elapsedMs - beat.startMs) / PAYOFF_MS[beat.payoff],
        maybeThing: beat.maybeThing,
      }),
  )

export const poseOf: {
  (watch: ActionWatch, slot: PlayerSlot): (world: World) => ActionPose
  (world: World, watch: ActionWatch, slot: PlayerSlot): ActionPose
} = Function.dual(
  3,
  (world: World, watch: ActionWatch, slot: PlayerSlot): ActionPose =>
    Option.match(maybeWorkOf(world, slot), {
      onSome: ({ motion, target, share }) => {
        const { player } = seatStateAt(world, slot)
        return ActionPose.Working({
          motion,
          share,
          frame: motionFrameOf(motion, share, world.elapsedMs),
          facing: facingTo(player, target),
          target,
        })
      },
      onNone: () =>
        Option.getOrElse(
          maybeBeatOf(watch, slot, world.elapsedMs),
          () => READY,
        ),
    }),
)

const isWorkingPose = ActionPose.isAnyOf(['Working'])

export const maybeCompressedOf: {
  (
    watch: ActionWatch,
    slot: PlayerSlot,
  ): (world: World) => Option.Option<number>
  (world: World, watch: ActionWatch, slot: PlayerSlot): Option.Option<number>
} = Function.dual(
  3,
  (world: World, watch: ActionWatch, slot: PlayerSlot): Option.Option<number> =>
    Array.findFirst(playersOf(world), ({ seat }) => {
      if (seat.slot === slot) {
        return Option.none()
      }
      const pose = poseOf(world, watch, seat.slot)
      return isWorkingPose(pose) &&
        pose.motion === 'Compress' &&
        distanceBetween(pose.target, seatStateAt(world, slot).player) < 1
        ? Option.some(pose.frame)
        : Option.none()
    }),
)

const isDareFound = GameEvent.isAnyOf(['DareFound'])
const isRevived = GameEvent.isAnyOf(['PlayerRevived'])
const isGrabbed = GameEvent.isAnyOf([
  'PickupGrabbed',
  'PantryTaken',
  'KeysFound',
])
const isPrized = GameEvent.isAnyOf(['PrizeTaken'])
const isCrated = GameEvent.isAnyOf(['CrateTaken'])

const FIND_REACH_PX = 30
const GRAB_REACH_PX = 16
const CRATE_REACH_PX = 22
const FIST_PUMP_REACH_PX = PLAYER_RADIUS * 2 + COOP_RULES.reviveReachPx + 4

const nearestStanding = (
  world: World,
  spot: Vector,
  reachPx: number,
): Option.Option<PlayerSlot> =>
  pipe(
    playersOf(world),
    Array.filter(
      ({ seat, player }) =>
        isStanding(seat) && distanceBetween(player, spot) <= reachPx,
    ),
    Array.map(({ seat, player }) => ({
      slot: seat.slot,
      distance: distanceBetween(player, spot),
    })),
    Array.reduce(
      Option.none<Readonly<{ slot: PlayerSlot; distance: number }>>(),
      (best, next) =>
        Option.isSome(best) && best.value.distance <= next.distance
          ? best
          : Option.some(next),
    ),
    Option.map(({ slot }) => slot),
  )

const seatOnSpot = (world: World, spot: Vector): Option.Option<PlayerSlot> =>
  Option.map(
    Array.findFirst(
      playersOf(world),
      ({ player }) => distanceBetween(player, spot) < 1,
    ),
    ({ seat }) => seat.slot,
  )

const bySlot = <Row extends Readonly<{ slot: number }>>(
  rows: ReadonlyArray<Row>,
): ReadonlyMap<number, ReadonlyArray<Row>> => {
  const index = new Map<number, Array<Row>>()
  for (const row of rows) {
    const bucket = index.get(row.slot)
    if (bucket === undefined) {
      index.set(row.slot, [row])
    } else {
      bucket.push(row)
    }
  }
  return index
}

const NO_ROWS: ReadonlyArray<never> = []

const beat = (
  slot: PlayerSlot,
  payoff: Payoff,
  startMs: number,
  maybeThing: Option.Option<DareKind> = Option.none(),
): ActionBeat => ({ slot, payoff, startMs, maybeThing })

const eventBeats = (world: World): ReadonlyArray<ActionBeat> =>
  Array.flatMap(world.frameEvents, (event): ReadonlyArray<ActionBeat> => {
    const now = world.elapsedMs
    if (isDareFound(event)) {
      return Option.toArray(
        Option.map(nearestStanding(world, event, FIND_REACH_PX), slot =>
          beat(slot, 'HoldUp', now, Option.some(event.kind)),
        ),
      )
    }
    if (isRevived(event)) {
      const risen = seatOnSpot(world, event)
      return [
        ...Option.toArray(
          Option.map(risen, slot => beat(slot, 'SpringUp', now)),
        ),
        ...pipe(
          playersOf(world),
          Array.filter(
            ({ seat, player }) =>
              isStanding(seat) &&
              !Option.contains(risen, seat.slot) &&
              distanceBetween(player, event) <= FIST_PUMP_REACH_PX,
          ),
          Array.map(({ seat }) => beat(seat.slot, 'FistPump', now)),
        ),
      ]
    }
    if (isGrabbed(event)) {
      return Option.toArray(
        Option.map(nearestStanding(world, event, GRAB_REACH_PX), slot =>
          beat(slot, 'Grab', now),
        ),
      )
    }
    if (isPrized(event)) {
      return Option.toArray(
        Option.map(nearestStanding(world, event, FIND_REACH_PX), slot =>
          beat(slot, 'HoldUp', now),
        ),
      )
    }
    return isCrated(event)
      ? Option.toArray(
          Option.map(nearestStanding(world, event, CRATE_REACH_PX), slot =>
            beat(slot, 'PryOpen', now),
          ),
        )
      : []
  })

const heldOf = (world: World): ActionWatch['held'] =>
  Array.map(playersOf(world), ({ seat, player }) => ({
    slot: seat.slot,
    weapon: `${player.wield}:${heldWeapon(player.arsenal)}`,
  }))

const swapBeats = (
  world: World,
  watch: ActionWatch,
  held: ActionWatch['held'],
): ReadonlyArray<ActionBeat> => {
  const seenBySlot = bySlot(watch.held)
  return Array.filterMap(held, ({ slot, weapon }) =>
    Array.some(
      seenBySlot.get(slot) ?? NO_ROWS,
      seen => seen.weapon !== weapon,
    ) && isStanding(seatStateAt(world, slot).seat)
      ? Result.succeed(beat(slot, 'Swap', world.elapsedMs))
      : Result.failVoid,
  )
}

const trapBeats = (
  world: World,
  watch: ActionWatch,
): ReadonlyArray<ActionBeat> => {
  if (Array.isReadonlyArrayEmpty(world.traps)) {
    return []
  }
  const seenIds: ReadonlySet<number> = new Set(watch.trapIds)
  return Array.filterMap(world.traps, trap =>
    seenIds.has(trap.id)
      ? Result.failVoid
      : pipe(
          trapOwnerOf(world, trap.id),
          Option.orElse(() =>
            nearestStanding(
              world,
              trapCenter(levelOf(world), trap),
              Number.POSITIVE_INFINITY,
            ),
          ),
          Option.map(slot => beat(slot, 'SetTrap', world.elapsedMs)),
          Result.fromOption(() => undefined),
        ),
  )
}

const isPlaying =
  (now: number) =>
  ({ payoff, startMs }: ActionBeat): boolean =>
    now >= startMs && now - startMs < PAYOFF_MS[payoff]

const workingOf = (world: World, watch: ActionWatch): ActionWatch['working'] =>
  Array.filterMap(playersOf(world), ({ seat }) => {
    const pose = poseOf(world, watch, seat.slot)
    return isWorkingPose(pose)
      ? Result.succeed({
          slot: seat.slot,
          motion: pose.motion,
          frame: pose.frame,
          x: pose.target.x,
          y: pose.target.y,
        })
      : Result.failVoid
  })

export const nextActionWatch: {
  (watch: ActionWatch): (world: World) => ActionWatch
  (world: World, watch: ActionWatch): ActionWatch
} = Function.dual(2, (world: World, watch: ActionWatch): ActionWatch => {
  const held = heldOf(world)
  const isFirstLook = Array.isReadonlyArrayEmpty(watch.held)
  const fresh = isFirstLook
    ? []
    : [
        ...eventBeats(world),
        ...swapBeats(world, watch, held),
        ...trapBeats(world, watch),
      ]
  const beats = [
    ...Array.filter(watch.beats, isPlaying(world.elapsedMs)),
    ...fresh,
  ]
  const next = {
    beats: sameIfUnchanged(watch.beats, beats),
    held:
      held.length === watch.held.length &&
      Array.every(held, (row, index) => isSameHeld(watch.held[index], row))
        ? watch.held
        : held,
    trapIds: sameIfUnchanged(
      watch.trapIds,
      Array.map(world.traps, ({ id }) => id),
    ),
    working: watch.working,
  }
  const working = workingOf(world, next)
  const keptWorking =
    working.length === watch.working.length &&
    Array.every(working, (row, index) =>
      isSameWorking(watch.working[index], row),
    )
      ? watch.working
      : working
  return next.beats === watch.beats &&
    next.held === watch.held &&
    next.trapIds === watch.trapIds &&
    keptWorking === watch.working
    ? watch
    : { ...next, working: keptWorking }
})

const isSameHeld = (
  seen: ActionWatch['held'][number] | undefined,
  row: ActionWatch['held'][number],
): boolean =>
  seen !== undefined && seen.slot === row.slot && seen.weapon === row.weapon

const isSameWorking = (
  seen: ActionWatch['working'][number] | undefined,
  row: ActionWatch['working'][number],
): boolean =>
  seen !== undefined &&
  seen.slot === row.slot &&
  seen.motion === row.motion &&
  Object.is(seen.frame, row.frame) &&
  Object.is(seen.x, row.x) &&
  Object.is(seen.y, row.y)

export const freshBeats: {
  (after: ActionWatch): (before: ActionWatch) => ReadonlyArray<ActionBeat>
  (before: ActionWatch, after: ActionWatch): ReadonlyArray<ActionBeat>
} = Function.dual(
  2,
  (before: ActionWatch, after: ActionWatch): ReadonlyArray<ActionBeat> => {
    if (after.beats === before.beats) {
      return []
    }
    const seenBySlot = bySlot(before.beats)
    return Array.filter(
      after.beats,
      next =>
        !Array.some(
          seenBySlot.get(next.slot) ?? NO_ROWS,
          seen => seen.payoff === next.payoff && seen.startMs === next.startMs,
        ),
    )
  },
)

export const strikesBetween: {
  (after: ActionWatch): (before: ActionWatch) => ActionWatch['working']
  (before: ActionWatch, after: ActionWatch): ActionWatch['working']
} = Function.dual(
  2,
  (before: ActionWatch, after: ActionWatch): ActionWatch['working'] => {
    if (after.working === before.working) {
      return []
    }
    const seenBySlot = bySlot(before.working)
    return Array.filter(
      after.working,
      now =>
        isStrikeFrame(now.motion, now.frame) &&
        !Array.some(
          seenBySlot.get(now.slot) ?? NO_ROWS,
          seen => seen.motion === now.motion && seen.frame === now.frame,
        ),
    )
  },
)
