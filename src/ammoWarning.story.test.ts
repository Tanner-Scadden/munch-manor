import { Array, Option, Schema, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  AMMO_TIP_MS,
  ammoLevelOf,
  isOutOfGuns,
  isRunningLow,
} from './ammoWarning'
import { cameraOf } from './camera'
import { FIXED_STEP_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  AmmoTip,
  Arsenal,
  AudioState,
  type CarriedGun,
  DifficultyCard,
  type Model,
  Phase,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { SavedOnboarding } from './playerData'
import { restoreSave, saveOf } from './save'
import { maybeBubbleKind } from './stallBubble'
import { FIRE_PRESS, FIRE_PUSH, SURFACE } from './testing'
import { PlaySound } from './update/sound'
import { STARTING_PISTOL, freshGun } from './weapons'

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
  modifyFields(initialModel, {
    difficultyCard: () => DifficultyCard.Seen(),
    maybeSurface: () => Option.some(SURFACE),
    musicSetting: () => 'Off',
    audio: () => AudioState.Ready(),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    player: player =>
      modifyFields(player, {
        arsenal: () => Arsenal.HoldingSecond({ first, second }),
      }),
  })

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
      isOutOfGuns(fightingWith(smg(0, 0), freshGun('Shotgun')).player),
    ).toBe(false)
    expect(
      isOutOfGuns(
        fightingWith(smg(0, 0), {
          ...freshGun('Shotgun'),
          rounds: 0,
          loaded: 0,
        }).player,
      ),
    ).toBe(true)
  })
})

// NOTE: one frame through the game's own update, firing, so the sound
// Commands of that frame can be read.
const firedFrame = (start: Model) => {
  const pressed = update(update(start, FIRE_PRESS).model, FIRE_PUSH).model
  return update(pressed, Message.TickedFrame({ deltaTime: FRAME_MS }))
}

const soundsOfFrame = (start: Model): ReadonlyArray<unknown> =>
  pipe(
    firedFrame(start).commands ?? [],
    Array.filter(command => command.name === PlaySound.name),
    Array.map(command => command.args?.['sound']),
  )

const framesOf = (start: Model, count: number): Model =>
  Array.reduce(
    Array.makeBy(count, () => 0),
    start,
    current =>
      update(current, Message.TickedFrame({ deltaTime: FRAME_MS })).model,
  )

describe('the last shots tick', () => {
  test('each of the last few shots plays a low tick', () => {
    expect(soundsOfFrame(fightingWith(smg(3, 3)))).toContain('AmmoTick')
  })

  test('a gun with plenty left fires without the tick', () => {
    const sounds = soundsOfFrame(fightingWith(smg(150, 30)))
    expect(sounds).toContain('SmgShot')
    expect(sounds).not.toContain('AmmoTick')
  })
})

describe("Rattles' call about ammo", () => {
  test('the first time a gun runs low, Rattles calls once, and the save keeps it', () => {
    const called = framesOf(fightingWith(smg(40, 30)), 1)
    expect(AmmoTip.isAnyOf(['Showing'])(called.ammoTip)).toBe(true)
    expect(saveOf(called).onboarding.ammoTip).toBe('Seen')
    expect(maybeBubbleKind(called, cameraOf(called))).toEqual(
      Option.some('Ammo'),
    )
    const done = framesOf(called, Math.ceil(AMMO_TIP_MS / FRAME_MS) + 1)
    expect(done.ammoTip).toEqual(AmmoTip.Seen())
    expect(
      restoreSave(fightingWith(smg(10, 10)), saveOf(done)).ammoTip,
    ).toEqual(AmmoTip.Seen())
  })

  test('a gun with plenty left never calls', () => {
    expect(framesOf(fightingWith(smg(150, 30)), 10).ammoTip).toEqual(
      AmmoTip.Unseen(),
    )
  })

  test('once seen, a low gun never calls again', () => {
    const seen = modifyFields(fightingWith(smg(20, 20)), {
      ammoTip: () => AmmoTip.Seen(),
    })
    expect(framesOf(seen, 5).ammoTip).toEqual(AmmoTip.Seen())
  })

  test('an onboarding saved before the ammo tip reads it as unseen', () => {
    const { ammoTip: _dropped, ...older } = saveOf(initialModel).onboarding
    expect(Schema.decodeSync(SavedOnboarding)(older).ammoTip).toBe('Unseen')
  })
})
