import { Array, Function, Option, Record } from 'effect'
import type { Canvas } from 'foldkit'

import { type ActStance, frontHandOf } from '../art/appearance'
import { DARE_ICONS } from '../art/dareArt'
import {
  CROWBAR,
  HAMMER_RAISED,
  HAMMER_STRUCK,
  JUNK,
  MAGAZINE,
  ROPE_FRAMES,
  SPARKLE_FRAMES,
  SPOON,
  SWEAT_DROP,
  type ToolSprite,
} from '../art/handTools'
import {
  type Facing,
  type SpriteSet,
  type Tone,
  boundsOf,
  group,
  placeAt,
} from '../art/sprite'
import type { DareKind } from '../world/dare/dareSchema'
import type { Vector } from '../world/schema/worldSchema'
import {
  ActionPose,
  type BeatPose,
  MOTIONS,
  type WorkingPose,
  keyframeOf,
  paceOf,
} from './actionPose'
import type { Payoff } from './renderSchema'

// How a player at work or playing a payoff is drawn (src/render/actionPose.ts):
// their own look in an action stance (src/art/appearance.ts, so the hat,
// the hero's prop, the shirt, and the skin all carry over), leaning into
// the work, with the tool in the front hand (src/art/handTools.ts) and the
// bits that fly: sweat off a CPR, junk out of a trunk, the dumbwaiter's
// rope running through the hands, the find held up with a sparkle. The gun
// is put away while the hands are busy. Every frame is a sprite built
// once; only where it is placed changes.

// NOTE: what the standing body is drawn with: the player's spot, look,
// tone, fade, and squash, as the standing frames are.
export type BodyLook = Readonly<{
  foot: Vector
  stances: Readonly<Record<ActStance, SpriteSet>>
  tone: Tone
  opacity: number
  scale: Vector
  elapsedMs: number
  facing: Facing
}>

const signOf = (facing: Facing): number => (facing === 'Left' ? -1 : 1)

const bodyShape = (
  look: BodyLook,
  stance: ActStance,
  facing: Facing,
  dx: number,
  dy: number,
): Canvas.Shape =>
  group({
    translate: {
      x: look.foot.x + dx * signOf(facing),
      y: look.foot.y + dy,
    },
    scale: look.scale,
    opacity: look.opacity,
    shapes: look.stances[stance][look.tone][facing],
  })

// NOTE: the front hand's pixel, in the world, for a stance leaning by
// `dx` and `dy`.
const handAt = (
  look: BodyLook,
  stance: ActStance,
  facing: Facing,
  dx: number,
  dy: number,
): Vector => {
  const hand = frontHandOf(stance)
  const sign = signOf(facing)
  return {
    x: look.foot.x + dx * sign + (facing === 'Left' ? -1 - hand.x : hand.x),
    y: look.foot.y + dy + hand.y,
  }
}

const toolAt = (
  tool: ToolSprite,
  at: Vector,
  facing: Facing,
  opacity: number,
): Canvas.Shape =>
  group({ opacity, shapes: [placeAt(at.x, at.y, tool[facing])] })

// WORK

type Extras = (
  look: BodyLook,
  pose: WorkingPose,
  hand: Vector,
) => ReadonlyArray<Canvas.Shape>

const NONE: Extras = () => []

const CYCLE_SWEAT_MS = 420
const SWEAT_FROM_SHARE = 0.25

// NOTE: CPR works up a sweat: a drop flicks off the back of the head and
// falls, once the revive is a quarter in.
const sweat: Extras = (look, pose) => {
  if (pose.share < SWEAT_FROM_SHARE) {
    return []
  }
  const t = (look.elapsedMs % CYCLE_SWEAT_MS) / CYCLE_SWEAT_MS
  const sign = signOf(pose.facing)
  return t < 0.75
    ? [
        toolAt(
          SWEAT_DROP,
          {
            x: Math.round(look.foot.x - sign * (3 + t * 5)),
            y: Math.round(look.foot.y - 11 + t * 7),
          },
          pose.facing,
          look.opacity,
        ),
      ]
    : []
}

const JUNK_ARC_PX = 9
const JUNK_REACH_PX = 11

// NOTE: a rummaged trunk coughs up junk over the shoulder, one piece a
// pass, round the sock, the bone, and the rag.
const junk: Extras = (look, pose, hand) => {
  const art = MOTIONS.Rummage
  const cycleMs = art.frameMs * art.frames.length
  const paced = look.elapsedMs * paceOf(pose.share)
  const t = (paced % cycleMs) / cycleMs
  const piece = Math.floor(paced / cycleMs) % JUNK.length
  const sign = signOf(pose.facing)
  return Option.match(Array.get(JUNK, piece), {
    onNone: () => [],
    onSome: sprite => [
      toolAt(
        sprite,
        {
          x: Math.round(hand.x - sign * t * JUNK_REACH_PX),
          y: Math.round(hand.y - 2 - Math.sin(t * Math.PI) * JUNK_ARC_PX),
        },
        pose.facing,
        look.opacity,
      ),
    ],
  })
}

const ROPE_TOP_PX = 15

// NOTE: the dumbwaiter's rope hangs in front of the hauler, top to waist,
// and runs through the hands each pull.
const rope: Extras = (look, pose, hand) => [
  toolAt(
    pose.frame % 2 === 0 ? ROPE_FRAMES[0] : ROPE_FRAMES[1],
    { x: hand.x, y: look.foot.y - ROPE_TOP_PX },
    pose.facing,
    look.opacity,
  ),
]

const holding =
  (tool: ToolSprite): Extras =>
  (look, pose, hand) => [toolAt(tool, hand, pose.facing, look.opacity)]

const hammer: Extras = (look, pose, hand) => [
  toolAt(
    pose.frame === 0 ? HAMMER_RAISED : HAMMER_STRUCK,
    hand,
    pose.facing,
    look.opacity,
  ),
]

const MOTION_EXTRAS: Readonly<Record<WorkingPose['motion'], Extras>> = {
  Compress: sweat,
  Rummage: junk,
  Yank: NONE,
  Haul: rope,
  Crank: NONE,
  Pull: NONE,
  Push: NONE,
  Shove: NONE,
  Hammer: hammer,
  Stir: holding(SPOON),
  Pry: holding(CROWBAR),
}

// NOTE: the sprite faces only left or right, so work up above the player
// (a tool on the wall behind them, the pot on its shelf) raises the arms a
// stance higher and turns the lean into a stretch upward.
const ALOFT: Readonly<Record<ActStance, ActStance>> = {
  Reach: 'FrontUp',
  ReachLow: 'Reach',
  ReachHigh: 'BothUp',
  FrontUp: 'BothUp',
  BackUp: 'BothUp',
  BothUp: 'BothUp',
  KneelLow: 'KneelMid',
  KneelMid: 'KneelUp',
  KneelUp: 'KneelUp',
}
const ALOFT_MIN_PX = 4

// NOTE: work on the floor (a chest, a trunk, a trap) stays low wherever
// it lies.
const FLOOR_WORK: ReadonlyArray<WorkingPose['motion']> = [
  'Compress',
  'Rummage',
  'Hammer',
]

const isAbove = (foot: Vector, pose: WorkingPose): boolean => {
  const rise = foot.y - pose.target.y
  return (
    !Array.contains(FLOOR_WORK, pose.motion) &&
    rise > ALOFT_MIN_PX &&
    Math.abs(pose.target.x - foot.x) < rise
  )
}

const workingShapes = (
  look: BodyLook,
  pose: WorkingPose,
): ReadonlyArray<Canvas.Shape> => {
  const keyframe = keyframeOf(pose.motion, pose.frame)
  const { stance, dx, dy } = isAbove(look.foot, pose)
    ? {
        stance: ALOFT[keyframe.stance],
        dx: 0,
        dy: keyframe.dy - Math.abs(keyframe.dx),
      }
    : keyframe
  const hand = handAt(look, stance, pose.facing, dx, dy)
  return [
    bodyShape(look, stance, pose.facing, dx, dy),
    ...MOTION_EXTRAS[pose.motion](look, pose, hand),
  ]
}

// PAYOFFS

type PayoffArt = Readonly<{
  stance: (share: number) => Option.Option<ActStance>
  lift: (share: number) => number
}>

const always = (stance: ActStance) => (): Option.Option<ActStance> =>
  Option.some(stance)

const FLAT = (): number => 0

// NOTE: each payoff's stance as it plays (none: the standing frames) and
// how far it lifts the body. The swap keeps the body as it stands and
// tosses the gun instead (src/render/playerView.ts).
const PAYOFF_ART: Readonly<Record<Payoff, PayoffArt>> = {
  HoldUp: {
    stance: always('BothUp'),
    lift: share =>
      share < 0.2 ? Math.round(Math.sin(share * 5 * Math.PI) * 2) : 0,
  },
  FistPump: {
    stance: always('FrontUp'),
    lift: share => (Math.floor(share * 4) % 2 === 0 ? 1 : 0),
  },
  SpringUp: {
    stance: always('BothUp'),
    lift: share => Math.round(Math.sin(share * Math.PI) * 3),
  },
  Swap: { stance: () => Option.none(), lift: FLAT },
  SetTrap: { stance: always('KneelLow'), lift: FLAT },
  Grab: {
    stance: share => (share < 0.65 ? Option.some('KneelLow') : Option.none()),
    lift: FLAT,
  },
  PryOpen: {
    stance: share => Option.some(share < 0.5 ? 'Reach' : 'ReachLow'),
    lift: FLAT,
  },
}

const SPARKLE_MS = 120
const THING_GAP_PX = 1

const THING_SIZES: Readonly<Record<DareKind, Vector>> = Record.map(
  DARE_ICONS,
  icon => {
    const box = boundsOf(icon)
    return { x: box.right - box.left, y: box.bottom - box.top }
  },
)

// NOTE: the find held up in both hands over the head, a sparkle
// twinkling at its corner.
const heldUpShapes = (
  look: BodyLook,
  maybeThing: Option.Option<DareKind>,
  lift: number,
): ReadonlyArray<Canvas.Shape> => {
  const top = look.foot.y - lift + frontHandOf('BothUp').y
  const sparkle = Math.floor(look.elapsedMs / SPARKLE_MS) % 2 === 0
  const thingShapes = Option.match(maybeThing, {
    onNone: () => [],
    onSome: (kind): ReadonlyArray<Canvas.Shape> => [
      placeAt(
        look.foot.x - Math.floor(THING_SIZES[kind].x / 2),
        top - THING_SIZES[kind].y - THING_GAP_PX,
        DARE_ICONS[kind],
      ),
    ],
  })
  const height = Option.match(maybeThing, {
    onNone: () => 0,
    onSome: kind => THING_SIZES[kind].y,
  })
  return [
    ...thingShapes,
    toolAt(
      sparkle ? SPARKLE_FRAMES[0] : SPARKLE_FRAMES[1],
      { x: look.foot.x + 4, y: top - height - 2 },
      look.facing,
      look.opacity,
    ),
  ]
}

const pryOpenShapes = (
  look: BodyLook,
  stance: ActStance,
): ReadonlyArray<Canvas.Shape> => [
  toolAt(
    CROWBAR,
    handAt(look, stance, look.facing, 0, 0),
    look.facing,
    look.opacity,
  ),
]

// NOTE: a payoff drawn in its stance, or none while it plays in the
// standing frames (a swap, a grab getting up).
const beatShapes = (
  look: BodyLook,
  pose: BeatPose,
): Option.Option<ReadonlyArray<Canvas.Shape>> => {
  const art = PAYOFF_ART[pose.payoff]
  const lift = art.lift(pose.share)
  return Option.map(art.stance(pose.share), stance => [
    bodyShape(look, stance, look.facing, 0, -lift),
    ...(pose.payoff === 'HoldUp'
      ? heldUpShapes(look, pose.maybeThing, lift)
      : []),
    ...(pose.payoff === 'PryOpen' ? pryOpenShapes(look, stance) : []),
  ])
}

// NOTE: the body at work or in a payoff, in place of the standing frames
// and the gun; none when the player stands as usual.
export const maybeActingShapes: {
  (
    pose: ActionPose,
  ): (look: BodyLook) => Option.Option<ReadonlyArray<Canvas.Shape>>
  (look: BodyLook, pose: ActionPose): Option.Option<ReadonlyArray<Canvas.Shape>>
} = Function.dual(
  2,
  (
    look: BodyLook,
    pose: ActionPose,
  ): Option.Option<ReadonlyArray<Canvas.Shape>> =>
    ActionPose.match(pose, {
      Ready: () => Option.none(),
      Working: working => Option.some(workingShapes(look, working)),
      Beat: beat => beatShapes(look, beat),
    }),
)

// RELOAD

const MAG_OUT_SHARE = 0.3
const MAG_IN_SHARE = 0.75
const SLAP_SHARE = 0.88
const MAG_DROP_PX = 7
const MAG_TILT = 0.45
const SLAP_KICK = 0.3

// NOTE: a reload drawn on the gun, beyond its bar: the gun tips down and
// the old magazine drops out, the new one comes up from the belt, and the
// palm slaps it home with a kick of the muzzle. `tilt` turns the gun
// toward the floor (sign by facing), and the magazine is placed from the
// gun's grip.
export const reloadMotionOf = (
  share: number,
): Readonly<{ tilt: number; maybeMag: Option.Option<Vector> }> => {
  if (share < MAG_OUT_SHARE) {
    const t = share / MAG_OUT_SHARE
    return {
      tilt: MAG_TILT * Math.min(1, t * 2),
      maybeMag: Option.some({ x: 0, y: 1 + Math.round(t * MAG_DROP_PX) }),
    }
  }
  if (share < MAG_IN_SHARE) {
    const t = (share - MAG_OUT_SHARE) / (MAG_IN_SHARE - MAG_OUT_SHARE)
    return {
      tilt: MAG_TILT,
      maybeMag: Option.some({
        x: Math.round(-4 + t * 4),
        y: Math.round(5 - t * 4),
      }),
    }
  }
  return {
    tilt: share < SLAP_SHARE ? -SLAP_KICK : 0,
    maybeMag: Option.none(),
  }
}

export const magazineShape: {
  (facing: Facing, opacity: number): (at: Vector) => Canvas.Shape
  (at: Vector, facing: Facing, opacity: number): Canvas.Shape
} = Function.dual(
  3,
  (at: Vector, facing: Facing, opacity: number): Canvas.Shape =>
    toolAt(MAGAZINE, at, facing, opacity),
)

// NOTE: a swapped gun is tossed up spinning and caught.
const TOSS_PX = 5

export const tossOf = (
  share: number,
): Readonly<{ lift: number; spin: number }> => ({
  lift: Math.round(Math.sin(share * Math.PI) * TOSS_PX),
  spin: share * Math.PI * 2,
})
