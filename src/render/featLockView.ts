import { Array, Function, Option } from 'effect'

import { FEAT_FLAME, FEAT_ICONS } from '#art/caseArt.ts'
import { textShapes, textWidth } from '#art/font.ts'
import { type Sprite, bakeShapes, placeAt } from '#art/sprite.ts'
import { gunIcon, knifeSprite } from '#art/sprites/guns.ts'
import { ZOMBIE_SPRITES } from '#art/sprites/zombies.ts'
import { goalOf, progressOf } from '#world/feats/feats.ts'
import type { Level } from '#world/level/arena.ts'
import {
  type Armament,
  Feat,
  type FeatTally,
  type Vector,
} from '#world/schema/worldSchema.ts'

import type * as Draw from './draw.ts'
import { rect, ringPixels } from './drawing.ts'
import type { Keepout as Box } from './keepout.ts'

const RING_RADIUS = 7
const RING_STEPS = 24
const COUNT_GAP_PX = 3
const COUNT_NEAR_PX = 56

const ringPixelsAt = ringPixels(RING_RADIUS)

const ringSprite = (filled: number): Sprite =>
  bakeShapes([
    rect(-5, -6, 11, 13, 'rgba(20, 12, 16, 0.8)'),
    rect(-6, -5, 13, 11, 'rgba(20, 12, 16, 0.8)'),
    ...Array.map(ringPixelsAt, ({ x, y }) => rect(x, y, 1, 1, '#140c10')),
    ...Array.map(ringPixelsAt, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? '#ffd23f' : '#3a2a1a'),
    ),
  ])

const RINGS: Array.NonEmptyReadonlyArray<Sprite> = [
  ringSprite(0),
  ...Array.makeBy(RING_STEPS, step => ringSprite((step + 1) / RING_STEPS)),
]

type Viewer = Readonly<{ feats: FeatTally; player: Vector }>

const armamentIcon = (armament: Armament): Sprite => {
  if (armament === 'Knife') {
    return knifeSprite(0)
  } else if (armament === 'Fire') {
    return FEAT_FLAME
  } else {
    return gunIcon(armament, 0)
  }
}

const featIconOf = (feat: Feat): Sprite =>
  Feat.matchOrElse(
    feat,
    {
      KillsWith: ({ armament }) => armamentIcon(armament),
      KillsOf: ({ kind }) => ZOMBIE_SPRITES[kind].icon,
    },
    ({ _tag }) => FEAT_ICONS[_tag],
  )

const ringOf = (progress: number, goal: number): Sprite =>
  Option.getOrElse(
    Array.get(
      RINGS,
      Math.min(RING_STEPS, Math.floor((progress / goal) * RING_STEPS)),
    ),
    () => RINGS[0],
  )

type LockSpot = Readonly<{
  x: number
  y: number
  countSide: 'Left' | 'Right'
  countShows: 'Always' | 'Near'
}>

export const lockSpotIn: {
  (at: Vector): (level: Level) => LockSpot
  (level: Level, at: Vector): LockSpot
} = Function.dual(2, (level: Level, at: Vector): LockSpot => ({
  x: at.x,
  y: at.y,
  countSide:
    at.x > (level.bounds.left + level.bounds.right) / 2 ? 'Left' : 'Right',
  countShows: 'Near',
}))

export const featCountOf: {
  (tally: FeatTally): (feat: Feat) => Option.Option<string>
  (feat: Feat, tally: FeatTally): Option.Option<string>
} = Function.dual(2, (feat: Feat, tally: FeatTally): Option.Option<string> => {
  const goal = goalOf(feat)
  return goal > 1
    ? Option.some(`${progressOf(tally, feat)}/${goal}`)
    : Option.none()
})

export const featLockBoxOf: {
  (at: LockSpot): (feat: Feat) => Box
  (feat: Feat, at: LockSpot): Box
} = Function.dual(2, (feat: Feat, at: LockSpot): Box => {
  const goal = goalOf(feat)
  const count = goal > 1 ? COUNT_GAP_PX + textWidth(`${goal}/${goal}`) : 0
  return {
    left: at.x - RING_RADIUS - (at.countSide === 'Left' ? count : 0),
    top: at.y - RING_RADIUS,
    right: at.x + RING_RADIUS + 1 + (at.countSide === 'Right' ? count : 0),
    bottom: at.y + RING_RADIUS + 1,
  }
})

export const featLockShapes: {
  (viewer: Viewer, at: LockSpot): (feat: Feat) => ReadonlyArray<Draw.Shape>
  (feat: Feat, viewer: Viewer, at: LockSpot): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (feat: Feat, viewer: Viewer, at: LockSpot): ReadonlyArray<Draw.Shape> => {
    const goal = goalOf(feat)
    const progress = progressOf(viewer.feats, feat)
    const isShown =
      at.countShows === 'Always' ||
      Math.hypot(viewer.player.x - at.x, viewer.player.y - at.y) <=
        COUNT_NEAR_PX
    return [
      placeAt(at.x, at.y, ringOf(progress, goal)),
      placeAt(at.x, at.y, featIconOf(feat)),
      ...(isShown
        ? Option.match(featCountOf(feat, viewer.feats), {
            onNone: () => [],
            onSome: count =>
              textShapes(
                count,
                progress >= goal ? 'Fresh' : 'Plain',
                at.countSide === 'Right'
                  ? at.x + RING_RADIUS + COUNT_GAP_PX
                  : at.x - RING_RADIUS - COUNT_GAP_PX,
                at.y - 3,
                at.countSide === 'Right' ? 'Left' : 'Right',
              ),
          })
        : []),
    ]
  },
)
