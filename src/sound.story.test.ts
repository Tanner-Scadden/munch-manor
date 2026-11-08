import { Array, Option, pipe } from 'effect'
import {
  Command,
  type StorySimulation,
  given,
  message,
  model,
  story,
} from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { type SoundEffect, positionVariation } from './audio'
import { FIXED_STEP_MS } from './constants'
import { Message } from './message'
import {
  AudioState,
  type Bullet,
  DifficultyCard,
  type Model,
  Phase,
  Pierce,
  type Zombie,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { initialModel, update } from './pureApp'
import {
  MUZZLE_X,
  SURFACE,
  holdFire,
  openFloorSpot,
  resolvePlayed,
  tick,
  zombieAt,
} from './testing'
import { PlaySound, ResumeAudio, managedResources } from './update/sound'

const FRAME_MS = FIXED_STEP_MS
const MID_GAME_MS = 30_000
const SHOT_X = PARLOUR.width / 2 + 6
const SHOT_Y = PARLOUR.height / 2

const readyScreen: Model = modifyFields(initialModel, {
  difficultyCard: () => DifficultyCard.Seen(),
  maybeSurface: () => Option.some(SURFACE),
  musicSetting: () => 'Off',
})

const withAudio = (base: Model, audio: AudioState): Model =>
  modifyFields(base, { audio: () => audio })

const playingWave = (audio: AudioState, wave: number): Model =>
  modifyFields(withAudio(readyScreen, audio), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  })

const playing = (audio: AudioState): Model => playingWave(audio, 1)

const oneHitZombieAt = (id: number, x: number, y: number): Zombie =>
  modifyFields(zombieAt(id, x, y), { hp: () => 1 })

const withOneHitZombieInFront = (base: Model): Model =>
  modifyFields(base, {
    zombies: () => [oneHitZombieAt(100, MUZZLE_X, PARLOUR.height / 2)],
  })

const pressFire = holdFire
const pressMute = message(Message.PressedKey({ code: 'KeyM' }))

const soundsOf = (
  commands: StorySimulation<Model, Message>['commands'],
): ReadonlyArray<unknown> =>
  pipe(
    commands,
    Array.filter(command => command.name === PlaySound.name),
    Array.map(command => command.args?.['sound']),
  )

const expectSounds =
  (expected: ReadonlyArray<SoundEffect>) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): StorySimulation<StoryModel, StoryMessage, OutMessage> => {
    expect(soundsOf(simulation.commands)).toEqual(expected)
    return simulation
  }

type PlaySoundResolver = readonly [
  typeof PlaySound,
  typeof Message.CompletedPlaySound.Type,
]

const playedResolver = (sound: SoundEffect): PlaySoundResolver => [
  PlaySound,
  Message.CompletedPlaySound({ sound, outcome: 'Played' }),
]

const resolveAllPlayed = (sounds: ReadonlyArray<SoundEffect>) =>
  Command.resolveAll(...Array.map(sounds, playedResolver))

const COMBAT_SOUNDS: ReadonlyArray<SoundEffect> = [
  'Shot',
  'ZombieHit',
  'ZombieDeath',
]

const requestsAudioEngine = (current: Model): boolean =>
  Option.isSome(managedResources.audioEngine.modelToMaybeRequirements(current))

describe('audio unlock', () => {
  test('a key press unlocks audio and the fresh round plays the start sound', () => {
    story(
      update,
      given(readyScreen),
      model(current => {
        expect(current.audio).toEqual(AudioState.Locked())
        expect(requestsAudioEngine(current)).toBe(false)
      }),
      message(Message.PressedKey({ code: 'Enter' })),
      Command.expectNone(),
      model(current => {
        expect(current.audio).toEqual(AudioState.Unlocking())
        expect(requestsAudioEngine(current)).toBe(true)
      }),
      message(Message.AcquiredAudioEngine()),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
      Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
      resolvePlayed('Start'),
    )
  })

  test('a mouse press unlocks audio', () => {
    story(
      update,
      given(readyScreen),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 400,
          clientY: 200,
        }),
      ),
      Command.expectNone(),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Unlocking())
      }),
    )
  })

  test('a touch press unlocks audio and a still-suspended context retries on release', () => {
    story(
      update,
      given(readyScreen),
      message(
        Message.PressedPointer({
          pointerId: 7,
          device: 'Touch',
          clientX: 120,
          clientY: 300,
        }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      message(Message.AcquiredAudioEngine()),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Suspended' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Suspended())
      }),
      message(Message.ReleasedPointer({ pointerId: 7 })),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
      Command.expectNone(),
    )
  })

  test('a browser without Web Audio stays silent for good', () => {
    story(
      update,
      given(readyScreen),
      message(Message.PressedKey({ code: 'Enter' })),
      message(
        Message.FailedAcquireAudioEngine({ reason: 'AudioContext missing' }),
      ),
      model(current => {
        expect(current.audio).toEqual(AudioState.Unavailable())
        expect(requestsAudioEngine(current)).toBe(false)
      }),
      holdFire,
      tick(FRAME_MS),
      Command.expectNone(),
    )
  })
})

describe('frame sounds', () => {
  test('a frame with a shot, a hit, and a kill plays each sound once', () => {
    story(
      update,
      given(withOneHitZombieInFront(playing(AudioState.Ready()))),
      pressFire,
      Command.expectNone(),
      tick(FRAME_MS),
      Command.expectHas(
        PlaySound({
          sound: 'Shot',
          variation: positionVariation(SHOT_X, SHOT_Y),
        }),
      ),
      expectSounds(COMBAT_SOUNDS),
      resolveAllPlayed(COMBAT_SOUNDS),
    )
  })

  test('a frame where the player is touched plays the hurt sound', () => {
    story(
      update,
      given(
        modifyFields(playing(AudioState.Ready()), {
          zombies: () => [
            zombieAt(100, PARLOUR.width / 2 + 2, PARLOUR.height / 2),
          ],
        }),
      ),
      tick(FRAME_MS),
      expectSounds(['PlayerHurt']),
      resolvePlayed('PlayerHurt'),
    )
  })

  test('forty kills in one frame play one death sound', () => {
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
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }))

    story(
      update,
      given(
        modifyFields(playingWave(AudioState.Ready(), 2), {
          zombies: () => victims,
          bullets: () => killingBullets,
        }),
      ),
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(
          Array.filter(frameEvents, ({ _tag }) => _tag === 'ZombieKilled'),
        ).toHaveLength(floodSize)
      }),
      expectSounds(['ZombieHit', 'ZombieDeath']),
      resolveAllPlayed(['ZombieHit', 'ZombieDeath']),
    )
  })

  test('no sound Commands while audio is locked, unlocking, suspended, or unavailable', () => {
    const silentStates = [
      AudioState.Locked(),
      AudioState.Unlocking(),
      AudioState.Suspended(),
      AudioState.Unavailable(),
    ]
    const bulletAtZombie: Bullet = {
      id: 1,
      x: MUZZLE_X,
      y: PARLOUR.height / 2,
      velocityX: 1,
      velocityY: 0,
      remainingMs: 900,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }
    Array.forEach(silentStates, audio => {
      story(
        update,
        given(
          modifyFields(withOneHitZombieInFront(playing(audio)), {
            bullets: () => [bulletAtZombie],
          }),
        ),
        tick(FRAME_MS),
        model(({ frameEvents }) => {
          expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
            'ZombieHit',
            'ZombieKilled',
          ])
        }),
        Command.expectNone(),
      )
    })
  })

  test('a muted game plays no sounds', () => {
    story(
      update,
      given(withOneHitZombieInFront(playing(AudioState.Ready()))),
      pressMute,
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('Muted')
      }),
      pressFire,
      tick(FRAME_MS),
      model(({ frameEvents }) => {
        expect(Array.isReadonlyArrayNonEmpty(frameEvents)).toBe(true)
      }),
      Command.expectNone(),
    )
  })

  test('M turns a muted game back on', () => {
    story(
      update,
      given(
        modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
          soundSetting: () => 'Muted',
        }),
      ),
      pressMute,
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
      pressFire,
      tick(FRAME_MS),
      expectSounds(COMBAT_SOUNDS),
      resolveAllPlayed(COMBAT_SOUNDS),
    )
  })

  test('the mute button toggles the setting and unlocks audio', () => {
    story(
      update,
      given(playing(AudioState.Locked())),
      message(Message.ClickedMuteButton()),
      model(({ soundSetting, audio }) => {
        expect(soundSetting).toBe('Muted')
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      message(Message.ClickedMuteButton()),
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
    )
  })

  test('a context the browser suspends mid-game waits for the next press', () => {
    story(
      update,
      given(
        modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
          elapsedMs: () => MID_GAME_MS,
        }),
      ),
      pressFire,
      tick(FRAME_MS),
      Command.resolveAll(
        ...Array.map(COMBAT_SOUNDS, (sound): PlaySoundResolver => [
          PlaySound,
          Message.CompletedPlaySound({
            sound,
            outcome: 'DroppedWhileSuspended',
          }),
        ]),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Suspended())
      }),
      message(Message.PressedKey({ code: 'KeyW' })),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      model(({ audio }) => {
        expect(audio).toEqual(AudioState.Ready())
      }),
    )
  })
})
