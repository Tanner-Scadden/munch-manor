import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import {
  AudioState,
  type Bullet,
  DifficultyCard,
  type Model,
  Phase,
  Pierce,
  type Zombie,
} from '../../app/model'
import { initialModel } from '../../app/pureApp'
import {
  AcquireAudioEngine,
  PlaySound,
  ResumeAudio,
} from '../../app/update/sound'
import { FIXED_STEP_MS } from '../../shared/constants'
import { DISTANT_SPAWN } from '../../test/model.fixture'
import {
  MUZZLE_X,
  SURFACE,
  type StoryStep,
  checkModel,
  checkPendingSounds,
  droppedSound,
  exactStoryOf,
  holdFire,
  openFloorSpot,
  press,
  resolvePlayed,
  send,
  storyOf,
  tick,
  zombieAt,
} from '../../test/testing'
import { START_LEVEL } from '../../world/level/arena'
import { type SoundEffect, positionVariation } from '../audio'

const FRAME_MS = FIXED_STEP_MS
const MID_GAME_MS = 30_000
const SHOT_X = START_LEVEL.start.x + 6
const SHOT_Y = START_LEVEL.start.y

const readyScreen: Model = UiStruct.evolve(initialModel, {
  difficultyCard: () => DifficultyCard.Seen,
  maybeSurface: () => Option.some(SURFACE),
  settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
})

const withAudio = (base: Model, audio: AudioState): Model =>
  UiStruct.evolve(base, { audio: () => audio })

const playingWave = (audio: AudioState, wave: number): Model =>
  UiStruct.evolve(withAudio(readyScreen, audio), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const playing = (audio: AudioState): Model => playingWave(audio, 1)

const oneHitZombieAt = (id: number, x: number, y: number): Zombie =>
  UiStruct.evolve(zombieAt(id, x, y), { hp: () => 1 })

const withOneHitZombieInFront = (base: Model): Model =>
  UiStruct.evolve(base, {
    zombies: () => [oneHitZombieAt(100, MUZZLE_X, START_LEVEL.start.y)],
  })

const pressFire = holdFire
const pressMute = press('KeyM')

const expectSounds = (expected: ReadonlyArray<SoundEffect>): StoryStep =>
  checkPendingSounds(sounds => {
    expect(sounds).toEqual(expected)
  })

const COMBAT_SOUNDS: ReadonlyArray<SoundEffect> = [
  'Shot',
  'ZombieHit',
  'ZombieDeath',
]

const engineBuilt: StoryStep = s =>
  s.resolve(AcquireAudioEngine, Message.SucceededAcquireAudioEngine())

const engineMissing: StoryStep = s =>
  s.resolve(
    AcquireAudioEngine,
    Message.FailedAcquireAudioEngine({ reason: 'AudioContext missing' }),
  )

const resumed =
  (playback: 'Running' | 'Suspended'): StoryStep =>
  s =>
    s.resolve(ResumeAudio, Message.CompletedResumeAudio({ playback }))

const MOUSE_PRESS = Message.PressedPointer({
  pointerId: 1,
  device: 'Mouse',
  clientX: 400,
  clientY: 200,
})

const TOUCH_PRESS = Message.PressedPointer({
  pointerId: 7,
  device: 'Touch',
  clientX: 120,
  clientY: 300,
})

const bulletAtZombie: Bullet = {
  id: 1,
  x: MUZZLE_X,
  y: START_LEVEL.start.y,
  velocityX: 1,
  velocityY: 0,
  remainingMs: 900,
  weapon: 'Pistol',
  damage: 1,
  knockback: 110,
  glaze: 'Plain',
  pierce: Pierce.Stops(),
}

describe('audio unlock', () => {
  it.effect(
    'a key press unlocks audio and the fresh round plays the start sound',
    () =>
      Effect.gen(function* () {
        const s = yield* exactStoryOf(readyScreen)
        s.pipe(
          checkModel(current => {
            expect(current.audio).toEqual(AudioState.Locked)
          }),
          c => c.expectNone(),
          press('Enter'),
          checkModel(current => {
            expect(current.audio).toEqual(AudioState.Unlocking)
          }),
          c => c.expectExact(AcquireAudioEngine),
          engineBuilt,
          c => c.expectExact(ResumeAudio),
          resumed('Running'),
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Ready)
          }),
          c => c.expectExact(PlaySound.make({ sound: 'Start', variation: 0 })),
          resolvePlayed,
        )
      }),
  )

  it.effect('a mouse press unlocks audio', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(readyScreen)
      s.pipe(
        send(MOUSE_PRESS),
        c => c.expectExact(AcquireAudioEngine),
        checkModel(({ audio }) => {
          expect(audio).toEqual(AudioState.Unlocking)
        }),
        engineMissing,
      )
    }),
  )

  it.effect(
    'a touch press unlocks audio and a still-suspended context retries on release',
    () =>
      Effect.gen(function* () {
        const s = yield* exactStoryOf(readyScreen)
        s.pipe(
          send(TOUCH_PRESS),
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Unlocking)
          }),
          engineBuilt,
          resumed('Suspended'),
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Suspended)
          }),
          send(Message.ReleasedPointer({ pointerId: 7 })),
          c => c.expectExact(ResumeAudio),
          resumed('Running'),
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Ready)
          }),
          c => c.expectNone(),
        )
      }),
  )

  it.effect('a browser without Web Audio stays silent for good', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(readyScreen)
      s.pipe(
        press('Enter'),
        engineMissing,
        checkModel(current => {
          expect(current.audio).toEqual(AudioState.Unavailable)
        }),
        c => c.expectNone(),
        holdFire,
        tick(FRAME_MS),
        c => c.expectNone(),
      )
    }),
  )
})

describe('frame sounds', () => {
  it.effect(
    'a frame with a shot, a hit, and a kill plays each sound once',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          withOneHitZombieInFront(playing(AudioState.Ready)),
        )
        s.pipe(
          pressFire,
          c => c.expectNone(),
          tick(FRAME_MS),
          c =>
            c.expectHas(
              PlaySound.make({
                sound: 'Shot',
                variation: positionVariation(SHOT_X, SHOT_Y),
              }),
            ),
          expectSounds(COMBAT_SOUNDS),
        )
      }),
  )

  it.effect('a frame where the player is touched plays the hurt sound', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(playing(AudioState.Ready), {
          zombies: () => [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
          ],
        }),
      )
      s.pipe(tick(FRAME_MS), expectSounds(['PlayerHurt']))
    }),
  )

  it.effect('forty kills in one frame play one death sound', () =>
    Effect.gen(function* () {
      const floodSize = 40
      const victims = Array.makeBy(floodSize, index =>
        oneHitZombieAt(
          200 + index,
          openFloorSpot(index).x,
          openFloorSpot(index).y,
        ),
      )
      const killingBullets = Array.map(victims, ({ id, x, y }): Bullet => ({
        id: id + floodSize,
        x,
        y,
        velocityX: 1,
        velocityY: 0,
        remainingMs: 900,
        weapon: 'Shotgun',
        damage: 1,
        knockback: 110,
        glaze: 'Plain',
        pierce: Pierce.Stops(),
      }))
      const s = yield* storyOf(
        UiStruct.evolve(playingWave(AudioState.Ready, 2), {
          zombies: () => victims,
          bullets: () => killingBullets,
          cases: () => [],
        }),
      )
      s.pipe(
        tick(FRAME_MS),
        checkModel(({ frameEvents }) => {
          expect(
            Array.filter(frameEvents, ({ _tag }) => _tag === 'ZombieKilled'),
          ).toHaveLength(floodSize)
        }),
        expectSounds(['ZombieHit', 'ZombieDeath', 'Purchase']),
      )
    }),
  )

  it.effect(
    'no sound Commands while audio is locked, unlocking, suspended, or unavailable',
    () =>
      Effect.gen(function* () {
        const silentStates = [
          AudioState.Locked,
          AudioState.Unlocking,
          AudioState.Suspended,
          AudioState.Unavailable,
        ]
        yield* Effect.forEach(silentStates, audio =>
          Effect.gen(function* () {
            const s = yield* exactStoryOf(
              UiStruct.evolve(withOneHitZombieInFront(playing(audio)), {
                bullets: () => [bulletAtZombie],
              }),
            )
            s.pipe(
              tick(FRAME_MS),
              checkModel(({ frameEvents }) => {
                expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
                  'ZombieHit',
                  'ZombieKilled',
                ])
              }),
              c => c.expectNone(),
            )
          }),
        )
      }),
  )

  it.effect('a muted game plays no sounds', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withOneHitZombieInFront(playing(AudioState.Ready)),
      )
      s.pipe(
        pressMute,
        checkModel(({ settings: { soundSetting } }) => {
          expect(soundSetting).toBe('Muted')
        }),
        pressFire,
        tick(FRAME_MS),
        checkModel(({ frameEvents }) => {
          expect(Array.isReadonlyArrayNonEmpty(frameEvents)).toBe(true)
        }),
        c => c.expectNone(),
      )
    }),
  )

  it.effect('M turns a muted game back on', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(withOneHitZombieInFront(playing(AudioState.Ready)), {
          settings: UiStruct.evolve({ soundSetting: () => 'Muted' }),
        }),
      )
      s.pipe(
        pressMute,
        checkModel(({ settings: { soundSetting } }) => {
          expect(soundSetting).toBe('On')
        }),
        pressFire,
        tick(FRAME_MS),
        expectSounds(COMBAT_SOUNDS),
      )
    }),
  )

  it.effect('the mute button toggles the setting and unlocks audio', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(playing(AudioState.Locked))
      s.pipe(
        send(Message.ClickedMuteButton()),
        checkModel(({ settings: { soundSetting }, audio }) => {
          expect(soundSetting).toBe('Muted')
          expect(audio).toEqual(AudioState.Unlocking)
        }),
        c => c.expectExact(AcquireAudioEngine),
        c => c.keepPending(AcquireAudioEngine),
        send(Message.ClickedMuteButton()),
        checkModel(({ settings: { soundSetting } }) => {
          expect(soundSetting).toBe('On')
        }),
        engineMissing,
      )
    }),
  )

  it.effect(
    'a context the browser suspends mid-game waits for the next press',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(withOneHitZombieInFront(playing(AudioState.Ready)), {
            elapsedMs: () => MID_GAME_MS,
          }),
        )
        s.pipe(pressFire, tick(FRAME_MS))
        Array.forEach(COMBAT_SOUNDS, sound => {
          s.resolve(PlaySound, droppedSound(sound))
        })
        s.pipe(
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Suspended)
          }),
          press('KeyW'),
          c => c.expectExact(ResumeAudio),
          resumed('Running'),
          checkModel(({ audio }) => {
            expect(audio).toEqual(AudioState.Ready)
          }),
        )
      }),
  )
})
