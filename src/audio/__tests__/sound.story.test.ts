import { Array, Effect, Option, pipe } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

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
  PlaySound,
  ResumeAudio,
  managedResources,
} from '../../app/update/sound'
import { FIXED_STEP_MS } from '../../shared/constants'
import { DISTANT_SPAWN } from '../../test/model.fixture'
import {
  APPLICATION,
  MUZZLE_X,
  SURFACE,
  holdFire,
  openFloorSpot,
  resolvePlayed,
  tick,
  zombieAt,
} from '../../test/testing'
import { START_LEVEL } from '../../world/level/arena'
import { type SoundEffect, positionVariation } from '../audio'

const FRAME_MS = FIXED_STEP_MS
const MID_GAME_MS = 30_000
const SHOT_X = START_LEVEL.start.x + 6
const SHOT_Y = START_LEVEL.start.y

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
    zombies: () => [oneHitZombieAt(100, MUZZLE_X, START_LEVEL.start.y)],
  })

const pressFire = holdFire
const pressMute = Story.message(Message.PressedKey({ code: 'KeyM' }))

const soundsOf = (
  commands: Story.StorySimulation<Model, Message>['commands'],
): ReadonlyArray<unknown> =>
  pipe(
    commands,
    Array.filter(command => command.name === PlaySound.name),
    Array.map(command => command.args?.['sound']),
  )

const expectSounds =
  (expected: ReadonlyArray<SoundEffect>) =>
  <StoryModel, StoryMessage, OutMessage>(
    simulation: Story.StorySimulation<StoryModel, StoryMessage, OutMessage>,
  ): Story.StorySimulation<StoryModel, StoryMessage, OutMessage> => {
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
  Story.Command.resolveAll(...Array.map(sounds, playedResolver))

const COMBAT_SOUNDS: ReadonlyArray<SoundEffect> = [
  'Shot',
  'ZombieHit',
  'ZombieDeath',
]

const requestsAudioEngine = (current: Model): boolean =>
  Option.isSome(managedResources.audioEngine.modelToMaybeRequirements(current))

describe('audio unlock', () => {
  it.effect(
    'a key press unlocks audio and the fresh round plays the start sound',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyScreen),
        Story.model(current => {
          expect(current.audio).toEqual(AudioState.Locked())
          expect(requestsAudioEngine(current)).toBe(false)
        }),
        Story.message(Message.PressedKey({ code: 'Enter' })),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(current.audio).toEqual(AudioState.Unlocking())
          expect(requestsAudioEngine(current)).toBe(true)
        }),
        Story.message(Message.AcquiredAudioEngine()),
        Story.Command.expectExact(ResumeAudio),
        Story.Command.resolve(
          ResumeAudio,
          Message.CompletedResumeAudio({ playback: 'Running' }),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Ready())
        }),
        Story.Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
        resolvePlayed('Start'),
      ),
  )

  it.effect('a mouse press unlocks audio', () =>
    Story.story(
      APPLICATION,
      Story.given(readyScreen),
      Story.message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 400,
          clientY: 200,
        }),
      ),
      Story.Command.expectNone(),
      Story.model(({ audio }) => {
        expect(audio).toEqual(AudioState.Unlocking())
      }),
    ),
  )

  it.effect(
    'a touch press unlocks audio and a still-suspended context retries on release',
    () =>
      Story.story(
        APPLICATION,
        Story.given(readyScreen),
        Story.message(
          Message.PressedPointer({
            pointerId: 7,
            device: 'Touch',
            clientX: 120,
            clientY: 300,
          }),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Unlocking())
        }),
        Story.message(Message.AcquiredAudioEngine()),
        Story.Command.resolve(
          ResumeAudio,
          Message.CompletedResumeAudio({ playback: 'Suspended' }),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Suspended())
        }),
        Story.message(Message.ReleasedPointer({ pointerId: 7 })),
        Story.Command.expectExact(ResumeAudio),
        Story.Command.resolve(
          ResumeAudio,
          Message.CompletedResumeAudio({ playback: 'Running' }),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Ready())
        }),
        Story.Command.expectNone(),
      ),
  )

  it.effect('a browser without Web Audio stays silent for good', () =>
    Story.story(
      APPLICATION,
      Story.given(readyScreen),
      Story.message(Message.PressedKey({ code: 'Enter' })),
      Story.message(
        Message.FailedAcquireAudioEngine({ reason: 'AudioContext missing' }),
      ),
      Story.model(current => {
        expect(current.audio).toEqual(AudioState.Unavailable())
        expect(requestsAudioEngine(current)).toBe(false)
      }),
      holdFire,
      tick(FRAME_MS),
      Story.Command.expectNone(),
    ),
  )
})

describe('frame sounds', () => {
  it.effect(
    'a frame with a shot, a hit, and a kill plays each sound once',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withOneHitZombieInFront(playing(AudioState.Ready()))),
        pressFire,
        Story.Command.expectNone(),
        tick(FRAME_MS),
        Story.Command.expectHas(
          PlaySound({
            sound: 'Shot',
            variation: positionVariation(SHOT_X, SHOT_Y),
          }),
        ),
        expectSounds(COMBAT_SOUNDS),
        resolveAllPlayed(COMBAT_SOUNDS),
      ),
  )

  it.effect('a frame where the player is touched plays the hurt sound', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(playing(AudioState.Ready()), {
          zombies: () => [
            zombieAt(100, START_LEVEL.start.x + 2, START_LEVEL.start.y),
          ],
        }),
      ),
      tick(FRAME_MS),
      expectSounds(['PlayerHurt']),
      resolvePlayed('PlayerHurt'),
    ),
  )

  it.effect('forty kills in one frame play one death sound', () => {
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

    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(playingWave(AudioState.Ready(), 2), {
          zombies: () => victims,
          bullets: () => killingBullets,
        }),
      ),
      tick(FRAME_MS),
      Story.model(({ frameEvents }) => {
        expect(
          Array.filter(frameEvents, ({ _tag }) => _tag === 'ZombieKilled'),
        ).toHaveLength(floodSize)
      }),
      expectSounds(['ZombieHit', 'ZombieDeath']),
      resolveAllPlayed(['ZombieHit', 'ZombieDeath']),
    )
  })

  it.effect(
    'no sound Commands while audio is locked, unlocking, suspended, or unavailable',
    () =>
      Effect.gen(function* () {
        const silentStates = [
          AudioState.Locked(),
          AudioState.Unlocking(),
          AudioState.Suspended(),
          AudioState.Unavailable(),
        ]
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
        yield* Effect.forEach(silentStates, audio =>
          Story.story(
            APPLICATION,
            Story.given(
              modifyFields(withOneHitZombieInFront(playing(audio)), {
                bullets: () => [bulletAtZombie],
              }),
            ),
            tick(FRAME_MS),
            Story.model(({ frameEvents }) => {
              expect(Array.map(frameEvents, ({ _tag }) => _tag)).toEqual([
                'ZombieHit',
                'ZombieKilled',
              ])
            }),
            Story.Command.expectNone(),
          ),
        )
      }),
  )

  it.effect('a muted game plays no sounds', () =>
    Story.story(
      APPLICATION,
      Story.given(withOneHitZombieInFront(playing(AudioState.Ready()))),
      pressMute,
      Story.model(({ soundSetting }) => {
        expect(soundSetting).toBe('Muted')
      }),
      pressFire,
      tick(FRAME_MS),
      Story.model(({ frameEvents }) => {
        expect(Array.isReadonlyArrayNonEmpty(frameEvents)).toBe(true)
      }),
      Story.Command.expectNone(),
    ),
  )

  it.effect('M turns a muted game back on', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
          soundSetting: () => 'Muted',
        }),
      ),
      pressMute,
      Story.model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
      pressFire,
      tick(FRAME_MS),
      expectSounds(COMBAT_SOUNDS),
      resolveAllPlayed(COMBAT_SOUNDS),
    ),
  )

  it.effect('the mute button toggles the setting and unlocks audio', () =>
    Story.story(
      APPLICATION,
      Story.given(playing(AudioState.Locked())),
      Story.message(Message.ClickedMuteButton()),
      Story.model(({ soundSetting, audio }) => {
        expect(soundSetting).toBe('Muted')
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      Story.message(Message.ClickedMuteButton()),
      Story.model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
    ),
  )

  it.effect(
    'a context the browser suspends mid-game waits for the next press',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(withOneHitZombieInFront(playing(AudioState.Ready())), {
            elapsedMs: () => MID_GAME_MS,
          }),
        ),
        pressFire,
        tick(FRAME_MS),
        Story.Command.resolveAll(
          ...Array.map(COMBAT_SOUNDS, (sound): PlaySoundResolver => [
            PlaySound,
            Message.CompletedPlaySound({
              sound,
              outcome: 'DroppedWhileSuspended',
            }),
          ]),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Suspended())
        }),
        Story.message(Message.PressedKey({ code: 'KeyW' })),
        Story.Command.expectExact(ResumeAudio),
        Story.Command.resolve(
          ResumeAudio,
          Message.CompletedResumeAudio({ playback: 'Running' }),
        ),
        Story.model(({ audio }) => {
          expect(audio).toEqual(AudioState.Ready())
        }),
      ),
  )
})
