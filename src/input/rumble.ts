import { Array, Function, Option, Order, pipe } from 'effect'

import type { Vector } from '../world/schema/entitySchema'
import { GameEvent } from '../world/schema/worldSchema'
import { distanceBetween } from '../world/step/geometry'

// A controller's rumble, read off a frame's events: a bite on your own
// player, Uncle Chunk's stomp, and a blast, weaker the farther away. One
// rumble a frame, the strongest; the Rumble Command plays it
// (src/app/update/rumble.ts). Pure, so the frame stays deterministic.

export type RumbleCue = Readonly<{
  strong: number
  weak: number
  durationMs: number
}>

// NOTE: a bite lands where the bitten player stood, so one within this of
// your own player is yours, and a teammate's bite elsewhere is not.
const OWN_BITE_REACH = 12

// NOTE: a stomp or a blast is felt out to this many times its radius,
// fading to nothing at the edge.
const FELT_RADII = 3

const BITE: RumbleCue = { strong: 0.5, weak: 0.9, durationMs: 160 }
const STOMP: RumbleCue = { strong: 1, weak: 0.7, durationMs: 320 }
const BLAST: RumbleCue = { strong: 0.8, weak: 0.5, durationMs: 220 }

const scaled = (cue: RumbleCue, nearness: number): RumbleCue => ({
  ...cue,
  strong: cue.strong * nearness,
  weak: cue.weak * nearness,
})

const nearnessOf = (player: Vector, spot: Vector, radius: number): number =>
  Math.max(0, 1 - distanceBetween(player, spot) / (radius * FELT_RADII))

const feltAt = (
  player: Vector,
  spot: Vector,
  radius: number,
  cue: RumbleCue,
): Option.Option<RumbleCue> => {
  const nearness = nearnessOf(player, spot, radius)
  return nearness > 0 ? Option.some(scaled(cue, nearness)) : Option.none()
}

const cueOf = (player: Vector, event: GameEvent): Option.Option<RumbleCue> =>
  GameEvent.matchOrElse(
    event,
    {
      PlayerHurt: (hurt): Option.Option<RumbleCue> =>
        distanceBetween(player, hurt) <= OWN_BITE_REACH
          ? Option.some(BITE)
          : Option.none(),
      BossStomped: stomp => feltAt(player, stomp, stomp.radius, STOMP),
      Exploded: blast => feltAt(player, blast, blast.radius, BLAST),
    },
    () => Option.none(),
  )

const byStrength = Order.mapInput(
  Order.Number,
  (cue: RumbleCue) => cue.strong + cue.weak,
)

export const rumbleOf: {
  (
    events: ReadonlyArray<GameEvent>,
  ): (player: Vector) => Option.Option<RumbleCue>
  (player: Vector, events: ReadonlyArray<GameEvent>): Option.Option<RumbleCue>
} = Function.dual(
  2,
  (
    player: Vector,
    events: ReadonlyArray<GameEvent>,
  ): Option.Option<RumbleCue> =>
    pipe(
      Array.getSomes(Array.map(events, event => cueOf(player, event))),
      Array.match({
        onEmpty: () => Option.none(),
        onNonEmpty: cues => Option.some(Array.max(cues, byStrength)),
      }),
    ),
)
