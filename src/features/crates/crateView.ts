import { Array, Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import { PICKUP_SPRITES } from '../../art/sprites/pickups'
import {
  CRATE_FIND_RISE,
  CRATE_SPRITES,
  TRAP_ICONS,
} from '../../art/sprites/traps'
import type { Drawable } from '../../render/depth'
import { type RingPixel, rect, ringPixels } from '../../render/drawing'
import {
  type CrateFind,
  areCratesOpen,
  crateRoomsOf,
  crateSpotOf,
  maybeFindIn,
} from '../../world/gear/crates'
import {
  healthShare,
  maybeMendingTrap,
  trapCenter,
} from '../../world/gear/traps'
import { levelOf } from '../../world/level/arena'
import type { Crate, CrateRoom, Trap } from '../../world/schema/worldSchema'

// The trap crates (src/world/gear/crates.ts) in the world, and the ring a
// trap wears while someone mends it. Show, don't explain: a shut crate in a
// wave, an open one in a break with its find (a trap or a heart) bobbing in it, an open empty
// one once it is taken, and a green ring filling round a trap as it mends.

const BOB_MS = 320
const BOB_PX = 1

const findIcon = (find: CrateFind): Sprite =>
  find === 'Heart' ? PICKUP_SPRITES.Heart : TRAP_ICONS[find]

const crateOf = (model: Model, room: CrateRoom): Option.Option<Crate> =>
  Array.findFirst(model.crates.crates, crate => crate.room === room)

const findShapes = (
  model: Model,
  crate: Crate,
  spot: Readonly<{ x: number; y: number }>,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(maybeFindIn(model, crate), {
    onNone: () => [],
    onSome: find => {
      const bob = Math.floor(model.elapsedMs / BOB_MS) % 2 === 0 ? 0 : BOB_PX
      return [placeAt(spot.x, spot.y - CRATE_FIND_RISE - bob, findIcon(find))]
    },
  })

// NOTE: a crate sorts with what stands around it, by the floor it sits on.
export const crateDrawables = (model: Model): ReadonlyArray<Drawable> =>
  Array.map(crateRoomsOf(model), (room): Drawable => {
    const spot = crateSpotOf(levelOf(model), room)
    const maybeCrate = crateOf(model, room)
    const isOpen = areCratesOpen(model) && Option.isSome(maybeCrate)
    return {
      footY: spot.y,
      rank: 'Prop',
      shapes: [
        placeAt(spot.x, spot.y, CRATE_SPRITES[isOpen ? 'Open' : 'Shut']),
        ...Option.match(maybeCrate, {
          onNone: () => [],
          onSome: crate => findShapes(model, crate, spot),
        }),
      ],
    }
  })

// MENDING

const MEND_RING_RADIUS = 9
const MEND_RING_STEPS = 12
const MEND_FILLED = '#9be36a'
const MEND_EMPTY = '#20301a'

const mendRing = (pixels: ReadonlyArray<RingPixel>, filled: number): Sprite =>
  bakeShapes(
    Array.map(pixels, ({ x, y, turn }) =>
      rect(x, y, 1, 1, turn < filled ? MEND_FILLED : MEND_EMPTY),
    ),
  )

const MEND_RINGS: Array.NonEmptyReadonlyArray<Sprite> = (() => {
  const pixels = ringPixels(MEND_RING_RADIUS)
  return [
    mendRing(pixels, 0),
    ...Array.makeBy(MEND_RING_STEPS, step =>
      mendRing(pixels, (step + 1) / MEND_RING_STEPS),
    ),
  ]
})()

const mendRingShapes = (model: Model, trap: Trap): Canvas.Shape => {
  const center = trapCenter(levelOf(model), trap)
  const step = Math.min(
    MEND_RING_STEPS,
    Math.floor(healthShare(trap) * MEND_RING_STEPS),
  )
  return placeAt(
    Math.round(center.x),
    Math.round(center.y),
    Option.getOrElse(Array.get(MEND_RINGS, step), () =>
      Array.headNonEmpty(MEND_RINGS),
    ),
  )
}

// NOTE: over everything: a ring round each trap a player is mending, filled
// as far as the trap is whole.
export const mendRingsOf = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Array.map(
    Array.dedupeWith(
      Array.getSomes(
        Array.map(model.seats, ({ seat }) =>
          maybeMendingTrap(model, seat.slot),
        ),
      ),
      (first, second) => first.id === second.id,
    ),
    trap => mendRingShapes(model, trap),
  )
