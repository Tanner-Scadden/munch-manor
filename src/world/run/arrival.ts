import { Function } from 'effect'

import { FIRST_PREPARATION_MS, STEP_EPSILON_MS } from '../../shared/constants'
import { type World, modifyWorldFields } from '../schema/world'
import { type IntroCut, Phase } from '../schema/worldSchema'
import { beginPreparation } from '../waves/waves'

// The intro's clock (LORE.md, "The intro: this feels really off"): a run
// starts Arriving, the World counts up to the doors slamming, and the slam
// starts the first break. Only the clock lives here; the beats are the
// client's drawing of it (src/features/intro/introBeat.ts). The room runs
// the same clock in co-op, so every screen slams on the same tick.

// NOTE: the whole cut, the drive up to HELLO?, plays the first time; after
// it, the knock and the slam, so RETRY stays quick.
export const ARRIVAL_MS: Readonly<Record<IntroCut, number>> = {
  Full: 15_400,
  Short: 3_800,
}

// NOTE: the slam is the last second of either cut, and is never skipped.
export const SLAM_MS = 1_000

export const slamAtMs = (cut: IntroCut): number => ARRIVAL_MS[cut] - SLAM_MS

export const isArriving = Phase.isAnyOf(['Arriving'])

// NOTE: a run under way, its intro too: what the frames and an online run's
// presses follow. A round (isRoundActive) starts only on the slam.
export const isRunUnderway = Phase.isAnyOf(['Arriving', 'Preparation', 'Wave'])

export const beginArrival: {
  (cut: IntroCut): <W extends World>(world: W) => W
  <W extends World>(world: W, cut: IntroCut): W
} = Function.dual(2, <W extends World>(world: W, cut: IntroCut): W =>
  modifyWorldFields(world, {
    phase: (): Phase => Phase.Arriving({ elapsedMs: 0, cut }),
  }),
)

// NOTE: one tick of the intro. Once the slam has rung out, the first break
// begins as it always has.
export const advanceArrival: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  Phase.matchOrElse(
    world.phase,
    {
      Arriving: ({ elapsedMs, cut }): World =>
        elapsedMs + deltaMs >= ARRIVAL_MS[cut] - STEP_EPSILON_MS
          ? beginPreparation(world, 1, FIRST_PREPARATION_MS)
          : modifyWorldFields(world, {
              phase: (): Phase =>
                Phase.Arriving({ elapsedMs: elapsedMs + deltaMs, cut }),
            }),
    },
    () => world,
  ),
)

// NOTE: the whole intro at once, to the first break, for a tool or a test
// that starts a run past it.
export const endArrival = (world: World): World =>
  Phase.matchOrElse(
    world.phase,
    { Arriving: ({ cut }) => advanceArrival(world, ARRIVAL_MS[cut]) },
    () => world,
  )

// NOTE: a press skips to the slam, never past it: single player's skip
// (src/app/update/intro.ts). A co-op client skips only its own drawing, and
// the room's clock decides the slam.
export const skipArrival = <W extends World>(world: W): W =>
  Phase.matchOrElse(
    world.phase,
    {
      Arriving: ({ elapsedMs, cut }): W =>
        elapsedMs >= slamAtMs(cut)
          ? world
          : modifyWorldFields(world, {
              phase: (): Phase =>
                Phase.Arriving({ elapsedMs: slamAtMs(cut), cut }),
            }),
    },
    () => world,
  )
