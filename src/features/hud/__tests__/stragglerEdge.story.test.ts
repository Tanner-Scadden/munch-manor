import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, type Zombie } from '../../../app/model'
import { screenCameraOf } from '../../../render/camera'
import { screenOf } from '../../../render/screen'
import { quietWave } from '../../../test/model.fixture'
import { APPLICATION, zombieAt } from '../../../test/testing'
import { START_LEVEL } from '../../../world/level/arena'
import { modifyFocus } from '../../../world/party/party'
import { LAST_ZOMBIE_RULES } from '../../../world/zombies/lastZombie'
import { stragglerEdgeShapes } from '../stragglerEdge'

// NOTE: the wave's last zombies, once they hurry, get a red badge at the
// window's edge when they are out of it (src/features/hud/stragglerEdge.ts).

const HURRYING_MS = LAST_ZOMBIE_RULES.delayMs + 100

const lastFew = (zombies: ReadonlyArray<Zombie>, loneMs: number): Model =>
  modifyFocus(
    modifyFields(quietWave(3), {
      phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] }),
      zombies: () => zombies,
      pacing: pacing => modifyFields(pacing, { loneMs: () => loneMs }),
    }),
    {
      player: player =>
        modifyFields(player, {
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
    Story.story(
      APPLICATION,
      Story.given(lastFew([near, far], HURRYING_MS)),
      Story.model(model => {
        expect(badgesOf(model)).toBe(1)
        expect(badgesOf(lastFew([near, far], LAST_ZOMBIE_RULES.delayMs))).toBe(
          0,
        )
        expect(badgesOf(lastFew([near], HURRYING_MS))).toBe(0)
      }),
    ),
  )
})
