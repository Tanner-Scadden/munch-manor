import { Array, Function, Option } from 'effect'
import type { Canvas } from 'foldkit'

import { FEAT_FLAME, FEAT_ICONS } from '../art/caseArt'
import { textShapes } from '../art/font'
import { type Sprite, bakeShapes, placeAt } from '../art/sprite'
import { gunIcon, knifeSprite } from '../art/sprites/guns'
import { ZOMBIE_SPRITES } from '../art/sprites/zombies'
import { goalOf, progressOf } from '../world/feats/feats'
import type { Level } from '../world/level/arena'
import {
  type Armament,
  Feat,
  type FeatTally,
  type Vector,
} from '../world/schema/worldSchema'
import { rect, ringPixels } from './drawing'

// A feat's lock (src/world/feats/feats.ts), hung over what it opens: a
// display case, the stove, or the gas valve. The feat's icon sits in a dark
// disc with a ring round it that fills gold with the player's own progress,
// and the count beside it: always over a display case, so what opens it
// reads from across the room (owner's playtest, 2026-11-10), and over the
// stove and the valve once the player walks up. No words: the icon says
// what to do and the numbers how far there is to go.

const RING_RADIUS = 7
const RING_STEPS = 24
const COUNT_GAP_PX = 3
const COUNT_NEAR_PX = 56

const ringPixelsAt = ringPixels(RING_RADIUS)

// NOTE: the dark disc and the ring in one image, so a lock is three
// shapes and its count.
const ringSprite = (filled: number): Sprite =>
  bakeShapes([
    rect(-5, -6, 11, 13, 'rgba(20, 12, 16, 0.8)'),
    rect(-6, -5, 13, 11, 'rgba(20, 12, 16, 0.8)'),
    ...Array.map(ringPixelsAt, ({ x, y }) => rect(x, y, 1, 1, '#140c10')),
    ...Array.map(ringPixelsAt, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? '#ffd23f' : '#3a2a1a'),
    ),
  ])

// NOTE: a ring for each step of progress, baked as the module loads.
const RINGS: Array.NonEmptyReadonlyArray<Sprite> = [
  ringSprite(0),
  ...Array.makeBy(RING_STEPS, step => ringSprite((step + 1) / RING_STEPS)),
]

// NOTE: who is looking: their own tally, and where they stand.
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

// NOTE: where a lock hangs, the side its count goes (toward the middle of
// the house, so a lock by an east wall keeps its count on the screen), and
// whether the count shows always or only to a player near it.
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

// NOTE: how far a player has gone toward a feat, as its lock's count reads
// (`4/10`); a feat done once shows no count, only its ring.
export const featCountOf: {
  (tally: FeatTally): (feat: Feat) => Option.Option<string>
  (feat: Feat, tally: FeatTally): Option.Option<string>
} = Function.dual(2, (feat: Feat, tally: FeatTally): Option.Option<string> => {
  const goal = goalOf(feat)
  return goal > 1
    ? Option.some(`${progressOf(tally, feat)}/${goal}`)
    : Option.none()
})

// NOTE: a lock centred on `at`, filled to the player's own tally.
export const featLockShapes: {
  (viewer: Viewer, at: LockSpot): (feat: Feat) => ReadonlyArray<Canvas.Shape>
  (feat: Feat, viewer: Viewer, at: LockSpot): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (feat: Feat, viewer: Viewer, at: LockSpot): ReadonlyArray<Canvas.Shape> => {
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
