import { Effect } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, type Zombie } from '#app/model.ts'
import { stragglerEdgeShapes } from '#features/hud/stragglerEdge.ts'
import { screenCameraOf } from '#render/camera/camera.ts'
import { screenOf } from '#render/camera/screen.ts'
import { quietWave } from '#test/model.fixture.ts'
import { exactStoryOf, zombieAt } from '#test/testing.ts'
import { START_LEVEL } from '#world/level/arena.ts'
import { modifyFocus } from '#world/party/party.ts'
import { LAST_ZOMBIE_RULES } from '#world/zombies/lastZombie.ts'

const HURRYING_MS = LAST_ZOMBIE_RULES.delayMs + 100

const lastFew = (zombies: ReadonlyArray<Zombie>, loneMs: number): Model =>
  modifyFocus(
    UiStruct.evolve(quietWave(3), {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
      zombies: () => zombies,
      pacing: pacing => UiStruct.evolve(pacing, { loneMs: () => loneMs }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          x: () => START_LEVEL.start.x,
          y: () => START_LEVEL.start.y,
        }),
    },
  )

const near = zombieAt(1, START_LEVEL.start.x + 20, START_LEVEL.start.y)
const far = zombieAt(2, START_LEVEL.start.x + 600, START_LEVEL.start.y)

const badgesOf = (model: Model): number =>
  stragglerEdgeShapes(model, screenOf(model), screenCameraOf(model)).length

describe('the edge badge of a hurrying last zombie', () => {
  it.effect('marks only the one out of the window, once they hurry', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(lastFew([near, far], HURRYING_MS))
      expect(badgesOf(s.model)).toBe(1)
      expect(badgesOf(lastFew([near, far], LAST_ZOMBIE_RULES.delayMs))).toBe(0)
      expect(badgesOf(lastFew([near], HURRYING_MS))).toBe(0)
    }),
  )
})
