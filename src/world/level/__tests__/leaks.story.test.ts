import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { AudioState, type Model } from '#app/model.ts'
import { PlayPlaced } from '#app/update/sound.ts'
import { FIXED_STEP_MS, PLAYER_FOOT_OFFSET } from '#shared/constants.ts'
import { quietWave } from '#test/model.fixture.ts'
import {
  checkPendingArgs,
  modelAfter,
  press,
  settleRunCommands,
  steps,
  tick,
  ticks,
  zombieOf,
} from '#test/testing.ts'
import { levelOf } from '#world/level/arena.ts'
import { WADE_PACE, leaksOf } from '#world/level/leaks.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'
import { distanceBetween } from '#world/step/geometry.ts'

const FRAME_MS = FIXED_STEP_MS
const STEPS = 8

const wave = quietWave(5)
const leak = Option.getOrThrow(Array.head(leaksOf(levelOf(wave))))
const middle = Option.getOrThrow(
  Array.get(leak.rows, Math.floor(leak.rows.length / 2)),
)

const wet = { x: middle.left + 0.5, y: middle.y - PLAYER_FOOT_OFFSET + 0.5 }
const dry = {
  x: wet.x,
  y: Array.headNonEmpty(leak.rows).y - PLAYER_FOOT_OFFSET - 4.5,
}

const shore = { x: middle.left - 4.5, y: wet.y }
const SPLASH_STEPS = 12

const playerAt = (at: Readonly<{ x: number; y: number }>): Model =>
  modifyFocus(wave, {
    player: player => UiStruct.evolve(player, { x: () => at.x, y: () => at.y }),
  })

const playerWalked = (at: Readonly<{ x: number; y: number }>) =>
  modelAfter(playerAt(at), steps(press('KeyD'), ticks(STEPS, FRAME_MS))).pipe(
    Effect.map(model => distanceBetween(focusOf(model).player, at)),
  )

const zombieAt = (at: Readonly<{ x: number; y: number }>): Model =>
  modifyFocus(
    UiStruct.evolve(wave, {
      zombies: () => [zombieOf('Shambler', 900, at.x, at.y, { speed: 40 })],
    }),
    {
      player: player =>
        UiStruct.evolve(player, { x: () => at.x + 90, y: () => at.y }),
    },
  )

const zombieWalked = (at: Readonly<{ x: number; y: number }>) =>
  modelAfter(zombieAt(at), ticks(STEPS, FRAME_MS)).pipe(
    Effect.map(({ zombies }) =>
      distanceBetween(Option.getOrThrow(Array.head(zombies)), at),
    ),
  )

describe('wading through a roof leak', () => {
  it.effect('a player walks slower with their feet in a puddle', () =>
    Effect.gen(function* () {
      const inWater = yield* playerWalked(wet)
      const onFloor = yield* playerWalked(dry)
      expect(onFloor).toBeGreaterThan(0)
      expect(inWater / onFloor).toBeCloseTo(WADE_PACE, 2)
    }),
  )

  it.effect('a zombie wades slower through a puddle too', () =>
    Effect.gen(function* () {
      const inWater = yield* zombieWalked(wet)
      const onFloor = yield* zombieWalked(dry)
      expect(onFloor).toBeGreaterThan(0)
      expect(inWater / onFloor).toBeCloseTo(WADE_PACE, 1)
    }),
  )

  it.effect('wading feet slosh and kick up water, dry feet do not', () => {
    const steppedIn = (at: Readonly<{ x: number; y: number }>) =>
      Effect.suspend(() => {
        const sounds: Array<string> = []
        return modelAfter(
          UiStruct.evolve(playerAt(at), { audio: () => AudioState.Ready }),
          steps(
            press('KeyD'),
            ...Array.makeBy(SPLASH_STEPS, () =>
              steps(
                tick(FRAME_MS),
                checkPendingArgs(PlayPlaced)(placed => {
                  sounds.push(...Array.map(placed, ({ sound }) => sound))
                }),
                settleRunCommands,
              ),
            ),
          ),
        ).pipe(
          Effect.map(({ cosmetics }) => ({
            isSloshing: Array.contains(sounds, 'Wade'),
            isSplashing: Array.some(
              cosmetics.particles,
              ({ kind }) => kind === 'Splash',
            ),
          })),
        )
      })
    return Effect.gen(function* () {
      const wading = yield* steppedIn(shore)
      const walking = yield* steppedIn(dry)
      expect(wading).toEqual({ isSloshing: true, isSplashing: true })
      expect(walking).toEqual({ isSloshing: false, isSplashing: false })
    })
  })
})
