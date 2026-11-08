import { Option, Schema } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  AmmoTip,
  Arsenal,
  AudioState,
  type CarriedGun,
  DifficultyCard,
  type Model,
  Phase,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { restoreSave, saveOf } from '../../../platform/save'
import { cameraOf } from '../../../render/camera'
import { maybeBubbleKind } from '../../../screens/game/stallBubble'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { SavedOnboarding } from '../../../shared/playerData'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  APPLICATION,
  SURFACE,
  checkPendingSounds,
  holdFire,
  playPendingSounds,
  tick,
  ticks,
} from '../../../test/testing'
import { STARTING_PISTOL, freshGun } from '../../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../../world/party/party'
import {
  AMMO_TIP_MS,
  ammoLevelOf,
  isOutOfGuns,
  isRunningLow,
} from '../ammoWarning'

// NOTE: limited ammo made hard to miss, from a playtester who traded up to
// the Chatterbox and died the first time it ran dry.

const FRAME_MS = FIXED_STEP_MS

const smg = (rounds: number, loaded = Math.min(rounds, 30)): CarriedGun => ({
  kind: 'Smg',
  rounds,
  loaded,
  tier: 0,
})

const fightingWith = (second: CarriedGun, first = STARTING_PISTOL): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      difficultyCard: () => DifficultyCard.Seen(),
      maybeSurface: () => Option.some(SURFACE),
      musicSetting: () => 'Off',
      audio: () => AudioState.Ready(),
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    }),
    {
      player: player =>
        modifyFields(player, {
          arsenal: () => Arsenal.HoldingSecond({ first, second }),
        }),
    },
  )

describe('how low a gun is', () => {
  test('a gun with limited ammo goes Low, then Last on its last magazine, then Dry', () => {
    expect(ammoLevelOf(smg(150))).toBe('Plenty')
    expect(ammoLevelOf(smg(60))).toBe('Low')
    expect(ammoLevelOf(smg(30))).toBe('Last')
    expect(ammoLevelOf(smg(0, 0))).toBe('Dry')
    expect(ammoLevelOf(freshGun('Shotgun'))).toBe('Plenty')
    expect(ammoLevelOf({ ...freshGun('Shotgun'), rounds: 12 })).toBe('Low')
  })

  test('the Pop Pistol and the Clang Pan never run low', () => {
    expect(ammoLevelOf({ ...STARTING_PISTOL, loaded: 0 })).toBe('Plenty')
    expect(isRunningLow(freshGun('Pan'))).toBe(false)
  })

  test('the knife is the way out only when every gun is dry', () => {
    expect(
      isOutOfGuns(focusOf(fightingWith(smg(0, 0), freshGun('Shotgun'))).player),
    ).toBe(false)
    expect(
      isOutOfGuns(
        focusOf(
          fightingWith(smg(0, 0), {
            ...freshGun('Shotgun'),
            rounds: 0,
            loaded: 0,
          }),
        ).player,
      ),
    ).toBe(true)
  })
})

// NOTE: one frame with the trigger held, whose sound Commands are read.
const firedFrame = Story.steps(holdFire, tick(FRAME_MS))

describe('the last shots tick', () => {
  it.effect('each of the last few shots plays a low tick', () =>
    Story.story(
      APPLICATION,
      Story.given(fightingWith(smg(3, 3))),
      firedFrame,
      checkPendingSounds(sounds => {
        expect(sounds).toContain('AmmoTick')
      }),
    ),
  )

  it.effect('a gun with plenty left fires without the tick', () =>
    Story.story(
      APPLICATION,
      Story.given(fightingWith(smg(150, 30))),
      firedFrame,
      checkPendingSounds(sounds => {
        expect(sounds).toContain('SmgShot')
        expect(sounds).not.toContain('AmmoTick')
      }),
    ),
  )
})

describe("Rattles' call about ammo", () => {
  it.effect(
    'the first time a gun runs low, Rattles calls once, and the save keeps it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(fightingWith(smg(40, 30))),
        tick(FRAME_MS),
        Story.model(called => {
          expect(AmmoTip.isAnyOf(['Showing'])(called.ammoTip)).toBe(true)
          expect(saveOf(called).onboarding.ammoTip).toBe('Seen')
          expect(maybeBubbleKind(called, cameraOf(called))).toEqual(
            Option.some('Ammo'),
          )
        }),
        ...ticks(Math.ceil(AMMO_TIP_MS / FRAME_MS) + 1, FRAME_MS),
        Story.model(done => {
          expect(done.ammoTip).toEqual(AmmoTip.Seen())
          expect(
            restoreSave(fightingWith(smg(10, 10)), saveOf(done)).ammoTip,
          ).toEqual(AmmoTip.Seen())
        }),
        playPendingSounds,
      ),
  )

  it.effect('a gun with plenty left never calls', () =>
    Story.story(
      APPLICATION,
      Story.given(fightingWith(smg(150, 30))),
      ...ticks(10, FRAME_MS),
      Story.model(({ ammoTip }) => {
        expect(ammoTip).toEqual(AmmoTip.Unseen())
      }),
    ),
  )

  it.effect('once seen, a low gun never calls again', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(fightingWith(smg(20, 20)), {
          ammoTip: () => AmmoTip.Seen(),
        }),
      ),
      ...ticks(5, FRAME_MS),
      Story.model(({ ammoTip }) => {
        expect(ammoTip).toEqual(AmmoTip.Seen())
      }),
    ),
  )

  test('an onboarding saved before the ammo tip reads it as unseen', () => {
    const { ammoTip: _dropped, ...older } = saveOf(initialModel).onboarding
    expect(
      Option.map(
        Schema.decodeOption(SavedOnboarding)(older),
        ({ ammoTip }) => ammoTip,
      ),
    ).toEqual(Option.some('Unseen'))
  })
})
