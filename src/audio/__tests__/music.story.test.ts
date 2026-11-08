import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import {
  AudioState,
  Frenzy,
  type Model,
  Phase,
  type PlannedSpawn,
  ZombieAction,
  ZombieState,
} from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { CueMusic } from '../../app/update/music'
import { PlaySound, ResumeAudio } from '../../app/update/sound'
import { FetchBuild } from '../../app/update/version'
import { FIXED_STEP_MS, ZOMBIE_MAX_HP } from '../../shared/constants'
import {
  APPLICATION,
  SURFACE,
  press,
  resolveFocusLobby,
  resolvePlayed,
  tick,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { PARLOUR } from '../../world/level/arena'
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
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    audio: () => audio,
  })

const preparing = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  audio: AudioState,
): Model =>
  modifyFields(titleScreen(audio), {
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 15_000,
        durationMs: 15_000,
        spawns,
      }),
  })

const fighting = (wave: number, audio: AudioState): Model =>
  modifyFields(titleScreen(audio), {
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [FAR_AWAY_SPAWN] }),
  })

const resolveCue = (mood: MusicMood) =>
  Story.Command.resolve(CueMusic, Message.CompletedCueMusic({ mood }))

describe('music follows the phase', () => {
  it.effect(
    'the title and Preparation share the creep loop, cued once audio is ready',
    () =>
      Story.story(
        APPLICATION,
        Story.given(titleScreen(AudioState.Locked())),
        press('Enter'),
        resolveFocusLobby(),
        press('Enter'),
        Story.Command.expectNone(),
        Story.message(Message.AcquiredAudioEngine()),
        Story.Command.expectExact(ResumeAudio),
        Story.Command.resolve(
          ResumeAudio,
          Message.CompletedResumeAudio({ playback: 'Running' }),
        ),
        Story.Command.expectExact(
          PlaySound({ sound: 'Start', variation: 0 }),
          CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
        ),
        resolvePlayed('Start'),
        resolveCue('Creep'),
      ),
  )

  it.effect(
    'a title that is already audible keeps the creep loop into Preparation',
    () =>
      Story.story(
        APPLICATION,
        Story.given(titleScreen(AudioState.Ready())),
        press('Enter'),
        resolveFocusLobby(),
        resolvePlayed('Pop'),
        press('Enter'),
        Story.model(({ phase }) => {
          expect(phase._tag).toBe('Preparation')
        }),
        Story.Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
        resolvePlayed('Start'),
      ),
  )

  it.effect(
    'a wave romps, a pause ducks it, a resume restores it, and a cleared wave sneaks back with a stinger',
    () =>
      Story.story(
        APPLICATION,
        Story.given(preparing(1, [], AudioState.Ready())),
        press('Enter'),
        Story.Command.expectExact(
          CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
        ),
        resolveCue('Romp'),
        press('Escape'),
        Story.Command.expectExact(
          CueMusic({ mood: 'Romp', level: 'Ducked', stinger: 'None' }),
        ),
        resolveCue('Romp'),
        press('Escape'),
        Story.Command.expectExact(
          CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
        ),
        resolveCue('Romp'),
        tick(FRAME_MS),
        Story.model(({ phase }) => {
          expect(phase._tag).toBe('Preparation')
        }),
        Story.Command.expectHas(
          CueMusic({ mood: 'Creep', level: 'Full', stinger: 'Cleared' }),
        ),
        resolveCue('Creep'),
        resolvePlayed('Payday'),
      ),
  )

  it.effect('the finale wave stampedes and Victory plays its stinger', () =>
    Story.story(
      APPLICATION,
      Story.given(preparing(FINAL_WAVE, [], AudioState.Ready())),
      press('Enter'),
      Story.Command.expectExact(
        CueMusic({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Stampede'),
      tick(FRAME_MS),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Story.Command.expectHas(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'Victory' }),
      ),
      resolveCue('Silence'),
      resolvePlayed('Payday'),
    ),
  )

  it.effect('GameOver plays its stinger', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(fighting(3, AudioState.Ready()), {
            zombies: () => [
              {
                id: 100,
                kind: 'Shambler',
                x: PARLOUR.width / 2 + 2,
                y: PARLOUR.height / 2,
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
          { player: player => modifyFields(player, { hp: () => 1 }) },
        ),
      ),
      tick(FRAME_MS),
      Story.model(({ phase }) => {
        expect(phase._tag).toBe('GameOver')
      }),
      Story.Command.expectHas(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'GameOver' }),
      ),
      resolveCue('Silence'),
      resolvePlayed('PlayerHurt'),
    ),
  )

  it.effect(
    'a frame that changes nothing about the phase sends no music Command',
    () =>
      Story.story(
        APPLICATION,
        Story.given(fighting(2, AudioState.Ready())),
        tick(FRAME_MS),
        tick(FRAME_MS),
        Story.Command.expectNone(),
      ),
  )
})

describe('music only plays when it can be heard', () => {
  it.effect(
    'no music Commands while audio is locked, unlocking, suspended, or unavailable',
    () =>
      Effect.gen(function* () {
        const silentStates = [
          AudioState.Locked(),
          AudioState.Unlocking(),
          AudioState.Suspended(),
          AudioState.Unavailable(),
        ]
        yield* Effect.forEach(silentStates, audio =>
          Story.story(
            APPLICATION,
            Story.given(
              modifyFields(preparing(1, [FAR_AWAY_SPAWN], audio), {
                phase: () =>
                  Phase.Preparation({
                    wave: 1,
                    remainingMs: 1,
                    durationMs: 15_000,
                    spawns: [FAR_AWAY_SPAWN],
                  }),
              }),
            ),
            tick(FRAME_MS),
            Story.model(({ phase }) => {
              expect(phase._tag).toBe('Wave')
            }),
            Story.Command.expectNone(),
          ),
        )
      }),
  )

  it.effect('with music off, a phase change sends no music Command', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(preparing(1, [FAR_AWAY_SPAWN], AudioState.Ready()), {
          musicSetting: () => 'Off',
        }),
      ),
      press('Enter'),
      Story.model(({ phase }) => {
        expect(phase._tag).toBe('Wave')
      }),
      Story.Command.expectNone(),
    ),
  )

  it.effect('N toggles music off and back on', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting(2, AudioState.Ready())),
      press('KeyN'),
      Story.model(({ musicSetting }) => {
        expect(musicSetting).toBe('Off')
      }),
      Story.Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      press('KeyN'),
      Story.model(({ musicSetting }) => {
        expect(musicSetting).toBe('On')
      }),
      Story.Command.expectExact(
        CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Romp'),
    ),
  )

  it.effect('the music button toggles music and unlocks audio', () =>
    Story.story(
      APPLICATION,
      Story.given(titleScreen(AudioState.Locked())),
      Story.message(Message.ClickedMusicButton()),
      Story.model(({ musicSetting, audio }) => {
        expect(musicSetting).toBe('Off')
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      Story.Command.expectNone(),
      Story.message(Message.ClickedMusicButton()),
      Story.model(({ musicSetting }) => {
        expect(musicSetting).toBe('On')
      }),
    ),
  )

  it.effect(
    'the music button on an audible title stops and restarts the creep loop',
    () =>
      Story.story(
        APPLICATION,
        Story.given(titleScreen(AudioState.Ready())),
        Story.message(Message.ClickedMusicButton()),
        Story.Command.expectExact(
          CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
        ),
        resolveCue('Silence'),
        Story.message(Message.ClickedMusicButton()),
        Story.Command.expectExact(
          CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
        ),
        resolveCue('Creep'),
      ),
  )

  it.effect('mute silences the music, and unmuting brings it back', () =>
    Story.story(
      APPLICATION,
      Story.given(fighting(FINAL_WAVE, AudioState.Ready())),
      press('KeyM'),
      Story.model(({ soundSetting, musicSetting }) => {
        expect(soundSetting).toBe('Muted')
        expect(musicSetting).toBe('On')
      }),
      Story.Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      press('KeyN'),
      press('KeyN'),
      Story.Command.expectNone(),
      press('KeyM'),
      Story.Command.expectExact(
        CueMusic({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Stampede'),
    ),
  )

  it.effect(
    'a hidden tab silences the title music, and coming back resumes it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(titleScreen(AudioState.Ready())),
        Story.message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
        Story.Command.expectExact(
          CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
        ),
        resolveCue('Silence'),
        Story.message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
        Story.Command.expectExact(
          CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
          FetchBuild,
        ),
        resolveCue('Creep'),
        Story.Command.resolve(
          FetchBuild,
          Message.FailedFetchBuild({ reason: 'offline' }),
        ),
      ),
  )

  it.effect('a muted run plays no stinger when it ends', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(preparing(FINAL_WAVE, [], AudioState.Ready()), {
          soundSetting: () => 'Muted',
        }),
      ),
      press('Enter'),
      tick(FRAME_MS),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Story.Command.expectNone(),
    ),
  )
})

describe('the end stingers stop when the music goes quiet', () => {
  const victoryScreen = (audio: AudioState): Model =>
    modifyFields(titleScreen(audio), {
      phase: () => Phase.Victory(),
      screenMs: () => 0,
    })

  it.effect('mute during the Victory stinger stops it', () =>
    Story.story(
      APPLICATION,
      Story.given(victoryScreen(AudioState.Ready())),
      press('KeyM'),
      Story.model(({ soundSetting }) => {
        expect(soundSetting).toBe('Muted')
      }),
      Story.Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
    ),
  )

  it.effect('turning music off during the Game Over stinger stops it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(victoryScreen(AudioState.Ready()), {
          phase: () => Phase.GameOver({ wave: 4 }),
        }),
      ),
      Story.message(Message.ClickedMusicButton()),
      Story.model(({ musicSetting }) => {
        expect(musicSetting).toBe('Off')
      }),
      Story.Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
    ),
  )

  it.effect('unmuting on the Victory screen does not replay the stinger', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(victoryScreen(AudioState.Ready()), {
          soundSetting: () => 'Muted',
        }),
      ),
      press('KeyM'),
      Story.model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
      Story.Command.expectNone(),
    ),
  )
})
