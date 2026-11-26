import { Function } from 'effect'

import { FIRST_PREPARATION_MS, STEP_EPSILON_MS } from '#shared/constants.ts'
import { type World, modifyWorldFields } from '#world/schema/world.ts'
import { type IntroCut, Phase } from '#world/schema/worldSchema.ts'
import { beginPreparation } from '#world/waves/waves.ts'

export const ARRIVAL_MS: Readonly<Record<IntroCut, number>> = {
  Full: 15_400,
  Short: 3_800,
}

export const SLAM_MS = 1_000

export const slamAtMs = (cut: IntroCut): number => ARRIVAL_MS[cut] - SLAM_MS

export const isArriving = Phase.isAnyOf(['Arriving'])

export const isRunUnderway = Phase.isAnyOf(['Arriving', 'Preparation', 'Wave'])

export const beginArrival: {
  (cut: IntroCut): <W extends World>(world: W) => W
  <W extends World>(world: W, cut: IntroCut): W
} = Function.dual(2, <W extends World>(world: W, cut: IntroCut): W =>
  modifyWorldFields(world, {
    phase: (): Phase => Phase.Arriving({ elapsedMs: 0, cut }),
  }),
)

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

export const endArrival = (world: World): World =>
  Phase.matchOrElse(
    world.phase,
    { Arriving: ({ cut }) => advanceArrival(world, ARRIVAL_MS[cut]) },
    () => world,
  )

export const skipArrival = <W extends World>(world: W): W =>
  modifyWorldFields(world, {
    phase: phase =>
      Phase.matchOrElse(
        phase,
        {
          Arriving: ({ elapsedMs, cut }): Phase =>
            elapsedMs >= slamAtMs(cut)
              ? phase
              : Phase.Arriving({ elapsedMs: slamAtMs(cut), cut }),
        },
        () => phase,
      ),
  })
