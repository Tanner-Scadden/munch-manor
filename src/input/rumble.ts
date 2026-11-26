import { Array, Function, Option, Order, pipe } from 'effect'

import type { Vector } from '#world/schema/entitySchema.ts'
import { GameEvent } from '#world/schema/worldSchema.ts'
import { distanceBetween } from '#world/step/geometry.ts'

export type RumbleCue = Readonly<{
  strong: number
  weak: number
  durationMs: number
}>

const OWN_BITE_REACH = 12

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
