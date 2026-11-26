import { Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import {
  AudioState,
  BreakClock,
  Frenzy,
  type Model,
  Phase,
  type PlannedSpawn,
  RunMode,
  ZombieAction,
  ZombieState,
} from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { CueMusic } from '../../app/update/music'
import {
  AcquireAudioEngine,
  PlaySound,
  ResumeAudio,
} from '../../app/update/sound'
import { FetchBuild } from '../../app/update/version'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  ZOMBIE_MAX_HP,
} from '../../shared/constants'
import { type SoundEffect } from '../../shared/soundEffect'
import { DISTANT_SPAWN, escaping, withFinale } from '../../test/model.fixture'
import {
  SLAM_FRAMES,
  SURFACE,
  type StoryStep,
  checkModel,
  checkPendingSounds,
  exactStoryOf,
  press,
  resolveAll,
  resolveFocusLobby,
  resolvePlayed,
  send,
  storyOf,
  tick,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { Finale } from '../../world/dare/dareSchema'
import { START_LEVEL } from '../../world/level/arena'
import { modifyFocus } from '../../world/party/party'
import { FINAL_WAVE } from '../../world/waves/wavePlans'
import type { MusicMood } from '../music'

const FRAME_MS = FIXED_STEP_MS
const FAR_AWAY_SPAWN: PlannedSpawn = {
  atMs: 1e9,
  kind: 'Shambler',
  door: 'North',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack: 0,
  formation: 'Squad',
}

const titleScreen = (audio: AudioState): Model =>
  UiStruct.evolve(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    audio: () => audio,
  })

const preparing = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  audio: AudioState,
): Model =>
  UiStruct.evolve(titleScreen(audio), {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave,
        remainingMs: 15_000,
        durationMs: 15_000,
        spawns,
      }),
  })

const fighting = (wave: number, audio: AudioState): Model =>
  UiStruct.evolve(titleScreen(audio), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [FAR_AWAY_SPAWN] }),
  })

const holdingOut = (audio: AudioState): Model =>
  withFinale(fighting(4, audio), Finale.Open())

const resolveCue =
  (_mood: MusicMood): StoryStep =>
  s =>
    s.resolve(CueMusic, Component.noop)

const slamHeard =
  (heard: Array<SoundEffect>): StoryStep =>
  s => {
    for (let frame = 0; frame < SLAM_FRAMES; frame += 1) {
      s.pipe(
        tick(MAX_FRAME_DELTA_MS),
        checkPendingSounds(sounds => {
          heard.push(...sounds)
        }),
      )
    }
    return s
  }

const resolvePaydayAndKey: StoryStep = resolveAll(PlaySound)(Component.noop)

describe('music follows the phase', () => {
  it.effect(
    'the title creeps, START goes quiet for the intro, cued once audio is ready',
    () =>
      Effect.gen(function* () {
        const s = yield* exactStoryOf(titleScreen(AudioState.Locked))
        s.pipe(
          press('Enter'),
          c => c.expectHas(AcquireAudioEngine),
          c => c.keepPending(AcquireAudioEngine),
          resolveFocusLobby(),
          press('Enter'),
          c => c.expectExact(AcquireAudioEngine),
          c =>
            c.resolve(
              AcquireAudioEngine,
              Message.SucceededAcquireAudioEngine(),
            ),
          c => c.expectExact(ResumeAudio),
          c =>
            c.resolve(
              ResumeAudio,
              Message.CompletedResumeAudio({ playback: 'Running' }),
            ),
          c => c.expectExact(PlaySound.make({ sound: 'Start', variation: 0 })),
          resolvePlayed,
        )
      }),
  )

  it.effect(
    'an audible title goes quiet for the intro, and the creep loop comes back on the slam',
    () =>
      Effect.gen(function* () {
        const heard: Array<SoundEffect> = []
        const s = yield* storyOf(titleScreen(AudioState.Ready))
        s.pipe(
          press('Enter'),
          resolveFocusLobby(),
          resolvePlayed,
          press('Enter'),
          checkModel(({ phase }) => {
            expect(phase._tag).toBe('Arriving')
          }),
          c =>
            c.expectExact(
              PlaySound.make({ sound: 'Start', variation: 0 }),
              CueMusic.make({
                mood: 'Silence',
                level: 'Full',
                stinger: 'None',
              }),
            ),
          resolvePlayed,
          resolveCue('Silence'),
          press('Escape'),
          slamHeard(heard),
          c => {
            expect(heard).toEqual(['DoorSlam'])
            return c
          },
          checkModel(({ phase }) => {
            expect(phase._tag).toBe('Preparation')
          }),
          c =>
            c.expectExact(
              CueMusic.make({ mood: 'Creep', level: 'Full', stinger: 'None' }),
            ),
          resolveCue('Creep'),
        )
      }),
  )

  it.effect(
    'a wave romps, a pause ducks it, a resume restores it, and a cleared wave sneaks back with a stinger',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(preparing(1, [], AudioState.Ready))
        s.pipe(
          press('Enter'),
          c =>
            c.expectExact(
              CueMusic.make({ mood: 'Romp', level: 'Full', stinger: 'None' }),
            ),
          resolveCue('Romp'),
          press('Escape'),
          c =>
            c.expectExact(
              CueMusic.make({ mood: 'Romp', level: 'Ducked', stinger: 'None' }),
            ),
          resolveCue('Romp'),
          press('Escape'),
          c =>
            c.expectExact(
              CueMusic.make({ mood: 'Romp', level: 'Full', stinger: 'None' }),
            ),
          resolveCue('Romp'),
          tick(FRAME_MS),
          checkModel(({ phase }) => {
            expect(phase._tag).toBe('Preparation')
          }),
          c =>
            c.expectHas(
              CueMusic.make({
                mood: 'Creep',
                level: 'Full',
                stinger: 'Cleared',
              }),
            ),
          resolveCue('Creep'),
          resolvePaydayAndKey,
        )
      }),
  )

  it.effect(
    'the hungrier house stampedes and an escape plays its stinger',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          escaping(preparing(FINAL_WAVE, [DISTANT_SPAWN], AudioState.Ready)),
        )
        s.pipe(
          press('Enter'),
          c =>
            c.expectExact(
              CueMusic.make({
                mood: 'Stampede',
                level: 'Full',
                stinger: 'None',
              }),
            ),
          resolveCue('Stampede'),
          tick(FRAME_MS),
          checkModel(({ phase }) => {
            expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
          }),
          c =>
            c.expectHas(
              CueMusic.make({
                mood: 'Silence',
                level: 'Full',
                stinger: 'Escaped',
              }),
            ),
          resolveCue('Silence'),
          resolvePlayed,
        )
      }),
  )

  it.effect('GameOver plays its stinger', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        modifyFocus(
          UiStruct.evolve(fighting(3, AudioState.Ready), {
            zombies: () => [
              {
                id: 100,
                kind: 'Shambler',
                x: START_LEVEL.start.x + 2,
                y: START_LEVEL.start.y,
                speed: 0,
                hp: ZOMBIE_MAX_HP,
                maxHp: ZOMBIE_MAX_HP,
                knockback: { x: 0, y: 0 },
                hitRemainingMs: 0,
                state: ZombieState.Walking(),
                action: ZombieAction.Roaming(),
                frenzy: Frenzy.Calm(),
              },
            ],
          }),
          { player: player => UiStruct.evolve(player, { hp: () => 1 }) },
        ),
      )
      s.pipe(
        tick(FRAME_MS),
        checkModel(({ phase }) => {
          expect(phase._tag).toBe('GameOver')
        }),
        c =>
          c.expectHas(
            CueMusic.make({
              mood: 'Silence',
              level: 'Full',
              stinger: 'GameOver',
            }),
          ),
        resolveCue('Silence'),
        resolvePlayed,
      )
    }),
  )

  it.effect(
    'a frame that changes nothing about the phase sends no music Command',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(fighting(2, AudioState.Ready))
        s.pipe(tick(FRAME_MS), tick(FRAME_MS), c => c.expectNone())
      }),
  )
})

describe('music only plays when it can be heard', () => {
  it.effect(
    'no music Commands while audio is locked, unlocking, suspended, or unavailable',
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
              UiStruct.evolve(preparing(1, [FAR_AWAY_SPAWN], audio), {
                phase: () =>
                  Phase.Preparation({
                    clock: BreakClock.Counting(),
                    wave: 1,
                    remainingMs: 1,
                    durationMs: 15_000,
                    spawns: [FAR_AWAY_SPAWN],
                  }),
              }),
            )
            s.pipe(
              tick(FRAME_MS),
              checkModel(({ phase }) => {
                expect(phase._tag).toBe('Wave')
              }),
              c => c.expectNone(),
            )
          }),
        )
      }),
  )

  it.effect('with music off, a phase change sends no music Command', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(preparing(1, [FAR_AWAY_SPAWN], AudioState.Ready), {
          settings: UiStruct.evolve({ musicSetting: () => 'Off' }),
        }),
      )
      s.pipe(
        press('Enter'),
        checkModel(({ phase }) => {
          expect(phase._tag).toBe('Wave')
        }),
        c => c.expectNone(),
      )
    }),
  )

  it.effect('N toggles music off and back on', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting(2, AudioState.Ready))
      s.pipe(
        press('KeyN'),
        checkModel(({ settings: { musicSetting } }) => {
          expect(musicSetting).toBe('Off')
        }),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Silence', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Silence'),
        press('KeyN'),
        checkModel(({ settings: { musicSetting } }) => {
          expect(musicSetting).toBe('On')
        }),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Romp', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Romp'),
      )
    }),
  )

  it.effect('the music button toggles music and unlocks audio', () =>
    Effect.gen(function* () {
      const s = yield* exactStoryOf(titleScreen(AudioState.Locked))
      s.pipe(
        send(Message.ClickedMusicButton()),
        checkModel(({ settings: { musicSetting }, audio }) => {
          expect(musicSetting).toBe('Off')
          expect(audio).toEqual(AudioState.Unlocking)
        }),
        c => c.expectExact(AcquireAudioEngine),
        c => c.keepPending(AcquireAudioEngine),
        send(Message.ClickedMusicButton()),
        checkModel(({ settings: { musicSetting } }) => {
          expect(musicSetting).toBe('On')
        }),
        c =>
          c.resolve(
            AcquireAudioEngine,
            Message.FailedAcquireAudioEngine({ reason: 'none' }),
          ),
      )
    }),
  )

  it.effect(
    'the music button on an audible title stops and restarts the creep loop',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(titleScreen(AudioState.Ready))
        s.pipe(
          send(Message.ClickedMusicButton()),
          c =>
            c.expectExact(
              CueMusic.make({
                mood: 'Silence',
                level: 'Full',
                stinger: 'None',
              }),
            ),
          resolveCue('Silence'),
          send(Message.ClickedMusicButton()),
          c =>
            c.expectExact(
              CueMusic.make({ mood: 'Creep', level: 'Full', stinger: 'None' }),
            ),
          resolveCue('Creep'),
        )
      }),
  )

  it.effect('wave 10 of a hunt still romps, with the list not done', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(fighting(FINAL_WAVE, AudioState.Ready))
      s.pipe(
        press('KeyM'),
        resolveCue('Silence'),
        press('KeyM'),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Romp', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Romp'),
      )
    }),
  )

  it.effect('Endless stampedes from wave 10, with no list', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(fighting(FINAL_WAVE, AudioState.Ready), {
          mode: () => RunMode.Endless(),
        }),
      )
      s.pipe(
        press('KeyM'),
        resolveCue('Silence'),
        press('KeyM'),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Stampede'),
      )
    }),
  )

  it.effect('mute silences the music, and unmuting brings it back', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(holdingOut(AudioState.Ready))
      s.pipe(
        press('KeyM'),
        checkModel(({ settings: { soundSetting, musicSetting } }) => {
          expect(soundSetting).toBe('Muted')
          expect(musicSetting).toBe('On')
        }),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Silence', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Silence'),
        press('KeyN'),
        press('KeyN'),
        c => c.expectNone(),
        press('KeyM'),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Stampede'),
      )
    }),
  )

  it.effect(
    'a hidden tab silences the title music, and coming back resumes it',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(titleScreen(AudioState.Ready))
        s.pipe(
          send(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
          c =>
            c.expectExact(
              CueMusic.make({
                mood: 'Silence',
                level: 'Full',
                stinger: 'None',
              }),
            ),
          resolveCue('Silence'),
          send(Message.ChangedPageVisibility({ visibility: 'Visible' })),
          c =>
            c.expectExact(
              FetchBuild,
              CueMusic.make({ mood: 'Creep', level: 'Full', stinger: 'None' }),
            ),
          resolveCue('Creep'),
          c =>
            c.resolve(
              FetchBuild,
              Message.FailedFetchBuild({ reason: 'offline' }),
            ),
        )
      }),
  )

  it.effect('a muted run plays no stinger when it ends', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(
          escaping(preparing(FINAL_WAVE, [DISTANT_SPAWN], AudioState.Ready)),
          { settings: UiStruct.evolve({ soundSetting: () => 'Muted' }) },
        ),
      )
      s.pipe(
        press('Enter'),
        tick(FRAME_MS),
        checkModel(({ phase }) => {
          expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
        }),
        c => c.expectNone(),
      )
    }),
  )
})

describe('the end stingers stop when the music goes quiet', () => {
  const escapedScreen = (audio: AudioState): Model =>
    UiStruct.evolve(titleScreen(audio), {
      phase: () => Phase.Escaped({ wave: 10 }),
      screenMs: () => 0,
    })

  it.effect('mute during the escape stinger stops it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(escapedScreen(AudioState.Ready))
      s.pipe(
        press('KeyM'),
        checkModel(({ settings: { soundSetting } }) => {
          expect(soundSetting).toBe('Muted')
        }),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Silence', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Silence'),
      )
    }),
  )

  it.effect('turning music off during the Game Over stinger stops it', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(escapedScreen(AudioState.Ready), {
          phase: () => Phase.GameOver({ wave: 4 }),
        }),
      )
      s.pipe(
        send(Message.ClickedMusicButton()),
        checkModel(({ settings: { musicSetting } }) => {
          expect(musicSetting).toBe('Off')
        }),
        c =>
          c.expectExact(
            CueMusic.make({ mood: 'Silence', level: 'Full', stinger: 'None' }),
          ),
        resolveCue('Silence'),
      )
    }),
  )

  it.effect('unmuting on the escape screen does not replay the stinger', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(escapedScreen(AudioState.Ready), {
          settings: UiStruct.evolve({ soundSetting: () => 'Muted' }),
        }),
      )
      s.pipe(
        press('KeyM'),
        checkModel(({ settings: { soundSetting } }) => {
          expect(soundSetting).toBe('On')
        }),
        c => c.expectNone(),
      )
    }),
  )
})
