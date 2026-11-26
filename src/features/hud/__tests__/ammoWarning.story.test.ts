import { Effect, Option, Schema } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import {
  Arsenal,
  AudioState,
  type CarriedGun,
  DifficultyCard,
  type Model,
  Phase,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { saveOf } from '../../../platform/save'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { SavedOnboarding } from '../../../shared/playerData'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  SURFACE,
  checkPendingSounds,
  exactStoryOf,
  holdFire,
  steps,
  tick,
} from '../../../test/testing'
import { STARTING_PISTOL, freshGun } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'
import { isOnLastShots } from '../ammoWarning'

const FRAME_MS = FIXED_STEP_MS

const smg = (loaded: number): CarriedGun => ({ ...freshGun('Smg'), loaded })

const fightingWith = (second: CarriedGun, first = STARTING_PISTOL): Model =>
  modifyFocus(
    UiStruct.evolve(initialModel, {
      difficultyCard: () => DifficultyCard.Seen,
      maybeSurface: () => Option.some(SURFACE),
      audio: () => AudioState.Ready,
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          arsenal: () => Arsenal.HoldingSecond({ first, second }),
        }),
    },
  )

describe('the last shots of a magazine', () => {
  test('up to five shots, or a quarter of the magazine, are its last', () => {
    expect(isOnLastShots(smg(30))).toBe(false)
    expect(isOnLastShots(smg(5))).toBe(false)
    expect(isOnLastShots(smg(4))).toBe(true)
    expect(isOnLastShots(smg(1))).toBe(true)
    expect(isOnLastShots(smg(0))).toBe(false)
    expect(isOnLastShots({ ...freshGun('Shotgun'), loaded: 1 })).toBe(true)
    expect(isOnLastShots({ ...freshGun('Shotgun'), loaded: 2 })).toBe(false)
  })

  test('the Pop Pistol counts too, and the Clang Pan never does', () => {
    expect(isOnLastShots({ ...STARTING_PISTOL, loaded: 2 })).toBe(true)
    expect(isOnLastShots({ ...freshGun('Pan'), loaded: 1 })).toBe(false)
  })
})

const firedFrame = steps(holdFire, tick(FRAME_MS))

describe('the last shots tick', () => {
  it.effect('each of the last few shots plays a low tick', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(fightingWith(smg(3)))
      s.pipe(
        firedFrame,
        checkPendingSounds(sounds => {
          expect(sounds).toContain('AmmoTick')
        }),
      )
    }),
  )

  it.effect('a full magazine fires without the tick', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(fightingWith(smg(30)))
      s.pipe(
        firedFrame,
        checkPendingSounds(sounds => {
          expect(sounds).toContain('SmgShot')
          expect(sounds).not.toContain('AmmoTick')
        }),
      )
    }),
  )
})

describe('the ammo tip, gone with endless ammo', () => {
  test('an onboarding saved with the ammo tip still reads, without it', () => {
    const onboarding = saveOf(initialModel).onboarding
    expect(
      Schema.decodeUnknownOption(SavedOnboarding)({
        ...onboarding,
        ammoTip: 'Seen',
      }),
    ).toEqual(Option.some(onboarding))
  })
})
