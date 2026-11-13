import { Array, Function, Option, Result, Schema, pipe } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import type { ActStance } from '../art/appearance'
import type { Facing } from '../art/sprite'
import { PLAYER_RADIUS } from '../shared/constants'
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

// The hands-on actions (owner, 2026-11-11: "It would be cool if the
// character interacted a lot more than just sitting there with a timer"):
// what a player's body is doing this frame, read off the World. A player
// at work loops a motion of two to four frames that quickens as the work
// fills: CPR on a downed teammate, rummaging a trunk, yanking the hollow
// book, hauling the dumbwaiter, cranking, pulling, pushing, or shoving a
// room tool, hammering a board, stirring at the stove, and prying a case.
// A short payoff plays when a thing is done (the find held up overhead, a
// fist pump for a revive, the revived springing up, a gun tossed in a
// swap, a trap set down, a pickup grabbed), read from the frame's events
// and from what the client saw last frame (`ActionWatch`).
//
// All of it is the client's own: nothing rides the wire, nothing touches
// the World, and the player keeps control throughout.

// MOTIONS

// NOTE: one frame of a motion: the body's stance and how far it leans,
// forward (`dx`, toward the work) and down (`dy`).
export type Keyframe = Readonly<{ stance: ActStance; dx: number; dy: number }>

type MotionArt = Readonly<{
  frames: Array.NonEmptyReadonlyArray<Keyframe>
  frameMs: number
  // NOTE: the frame that lands a blow (a push, a hammer's strike), where
  // the thump, the splinters, and the downed body's bounce go.
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

// NOTE: a motion quickens as its work fills: a third faster past half way,
// two thirds faster near done. Stepped, not smooth, so a frame never
// jumps back as the pace changes.
export const paceOf = (share: number): number => {
  if (share >= 0.8) {
    return 1.65
  }
  return share >= 0.5 ? 1.3 : 1
}

// NOTE: which frame of its motion a worker is on, by the World's clock.
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

// PAYOFFS

export const PAYOFF_MS: Readonly<Record<Payoff, number>> = {
  HoldUp: 850,
  FistPump: 620,
  SpringUp: 380,
  Swap: 260,
  SetTrap: 380,
  Grab: 280,
  PryOpen: 360,
}

// THE POSE

export const ActionPose = defineTaggedUnion({
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
export type WorkingPose = typeof ActionPose.Working.Type
export type BeatPose = typeof ActionPose.Beat.Type

const READY: ActionPose = ActionPose.Ready()

type Work = Readonly<{ motion: Motion; target: Vector; share: number }>

const facingTo = (from: Vector, to: Vector): Facing =>
  to.x < from.x ? 'Left' : 'Right'

// NOTE: the work a still player is at, first match wins: a teammate picked
// up, a room's find, a room tool, a board mended, then a hold to buy.
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

// NOTE: what the player at `slot` is doing this frame: at work (it always
// wins, since the hands are busy), playing a payoff, or ready, as usual.
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

// NOTE: the motion a downed player is being picked up with, for the
// bounce of their body under each push: the first reviver's.
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

// THE WATCH

// NOTE: the events a payoff comes from, each with the seat it goes to: the
// standing player nearest the spot, within `reachPx`.
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
      const risen = Option.map(
        // NOTE: at most 4 seats.
        // oxlint-disable-next-line munch/no-nested-scan
        Array.findFirst(
          playersOf(world),
          ({ player }) => distanceBetween(player, event) < 1,
        ),
        ({ seat }) => seat.slot,
      )
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

// NOTE: a seat whose weapon in hand changed since last frame swapped it.
const swapBeats = (
  world: World,
  watch: ActionWatch,
  held: ActionWatch['held'],
): ReadonlyArray<ActionBeat> =>
  Array.filterMap(held, ({ slot, weapon }) =>
    // NOTE: at most 4 seats, each holding one weapon.
    // oxlint-disable-next-line munch/no-nested-scan
    Array.some(
      watch.held,
      seen => seen.slot === slot && seen.weapon !== weapon,
    ) && isStanding(seatStateAt(world, slot).seat)
      ? Result.succeed(beat(slot, 'Swap', world.elapsedMs))
      : Result.failVoid,
  )

// NOTE: a trap that was not standing last frame was just set down, by its
// owner in co-op, or by the one player.
const trapBeats = (
  world: World,
  watch: ActionWatch,
): ReadonlyArray<ActionBeat> =>
  Array.filterMap(world.traps, trap =>
    // NOTE: at most 8 traps (2 a kind alone, 1 a kind a seat in co-op).
    // oxlint-disable-next-line munch/no-nested-scan
    Array.contains(watch.trapIds, trap.id)
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

const isPlaying =
  (now: number) =>
  ({ payoff, startMs }: ActionBeat): boolean =>
    now >= startMs && now - startMs < PAYOFF_MS[payoff]

// NOTE: each seat at work this frame: its motion, the frame it is on, and
// where the work is, kept so the next frame can tell a blow that just
// landed from one already seen.
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

// NOTE: the watch after a frame: the new payoffs from its events and from
// what changed, the old ones that are still playing, and what the frame
// saw. The first frame of a run sees every trap and weapon as they stand,
// so nothing plays for what was already there.
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
    beats,
    held,
    trapIds: Array.map(world.traps, ({ id }) => id),
    working: watch.working,
  }
  return { ...next, working: workingOf(world, next) }
})

// NOTE: the payoffs that started between two watches, for their dust.
export const freshBeats: {
  (after: ActionWatch): (before: ActionWatch) => ReadonlyArray<ActionBeat>
  (before: ActionWatch, after: ActionWatch): ReadonlyArray<ActionBeat>
} = Function.dual(
  2,
  (before: ActionWatch, after: ActionWatch): ReadonlyArray<ActionBeat> =>
    Array.filter(
      after.beats,
      next =>
        // NOTE: at most one payoff a seat, 4 seats.
        // oxlint-disable-next-line munch/no-nested-scan
        !Array.some(
          before.beats,
          seen =>
            seen.slot === next.slot &&
            seen.payoff === next.payoff &&
            seen.startMs === next.startMs,
        ),
    ),
)

// NOTE: the blows that landed between two watches: a push on a chest, a
// hammer on a board, a shove, a pry, each once as its strike frame comes
// round.
export const strikesBetween: {
  (after: ActionWatch): (before: ActionWatch) => ActionWatch['working']
  (before: ActionWatch, after: ActionWatch): ActionWatch['working']
} = Function.dual(
  2,
  (before: ActionWatch, after: ActionWatch): ActionWatch['working'] =>
    Array.filter(
      after.working,
      now =>
        isStrikeFrame(now.motion, now.frame) &&
        // NOTE: at most one action a seat, 4 seats.
        // oxlint-disable-next-line munch/no-nested-scan
        !Array.some(
          before.working,
          seen =>
            seen.slot === now.slot &&
            seen.motion === now.motion &&
            seen.frame === now.frame,
        ),
    ),
)
