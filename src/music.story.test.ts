import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import { FIXED_STEP_MS, ZOMBIE_MAX_HP } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  AudioState,
  Frenzy,
  type Model,
  Phase,
  type PlannedSpawn,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import type { MusicMood } from './music'
import { CueMusic } from './musicPlan'
import { SURFACE, resolveFocusLobby, resolvePlayed, tick } from './testing'
import { PlaySound, ResumeAudio } from './update/sound'
import { FetchBuild } from './update/version'
import { asVeteran } from './veteran'
import { FINAL_WAVE } from './wavePlans'

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

const pressKey = (code: string) => message(Message.PressedKey({ code }))

const resolveCue = (mood: MusicMood) =>
  Command.resolve(CueMusic, Message.CompletedCueMusic({ mood }))

describe('music follows the phase', () => {
  test('the title and Preparation share the creep loop, cued once audio is ready', () => {
    story(
      update,
      given(titleScreen(AudioState.Locked())),
      pressKey('Enter'),
      resolveFocusLobby(),
      pressKey('Enter'),
      Command.expectNone(),
      message(Message.AcquiredAudioEngine()),
      Command.expectExact(ResumeAudio),
      Command.resolve(
        ResumeAudio,
        Message.CompletedResumeAudio({ playback: 'Running' }),
      ),
      Command.expectExact(
        PlaySound({ sound: 'Start', variation: 0 }),
        CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
      ),
      resolvePlayed('Start'),
      resolveCue('Creep'),
    )
  })

  test('a title that is already audible keeps the creep loop into Preparation', () => {
    story(
      update,
      given(titleScreen(AudioState.Ready())),
      pressKey('Enter'),
      resolveFocusLobby(),
      resolvePlayed('Pop'),
      pressKey('Enter'),
      model(({ phase }) => {
        expect(phase._tag).toBe('Preparation')
      }),
      Command.expectExact(PlaySound({ sound: 'Start', variation: 0 })),
      resolvePlayed('Start'),
    )
  })

  test('a wave romps, a pause ducks it, a resume restores it, and a cleared wave sneaks back with a stinger', () => {
    story(
      update,
      given(preparing(1, [], AudioState.Ready())),
      pressKey('Enter'),
      Command.expectExact(
        CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Romp'),
      pressKey('Escape'),
      Command.expectExact(
        CueMusic({ mood: 'Romp', level: 'Ducked', stinger: 'None' }),
      ),
      resolveCue('Romp'),
      pressKey('Escape'),
      Command.expectExact(
        CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Romp'),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase._tag).toBe('Preparation')
      }),
      Command.expectHas(
        CueMusic({ mood: 'Creep', level: 'Full', stinger: 'Cleared' }),
      ),
      resolveCue('Creep'),
      resolvePlayed('Payday'),
    )
  })

  test('the finale wave stampedes and Victory plays its stinger', () => {
    story(
      update,
      given(preparing(FINAL_WAVE, [], AudioState.Ready())),
      pressKey('Enter'),
      Command.expectExact(
        CueMusic({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Stampede'),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Command.expectHas(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'Victory' }),
      ),
      resolveCue('Silence'),
      resolvePlayed('Payday'),
    )
  })

  test('GameOver plays its stinger', () => {
    story(
      update,
      given(
        modifyFields(fighting(3, AudioState.Ready()), {
          player: player => modifyFields(player, { hp: () => 1 }),
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
      ),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase._tag).toBe('GameOver')
      }),
      Command.expectHas(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'GameOver' }),
      ),
      resolveCue('Silence'),
      resolvePlayed('PlayerHurt'),
    )
  })

  test('a frame that changes nothing about the phase sends no music Command', () => {
    story(
      update,
      given(fighting(2, AudioState.Ready())),
      tick(FRAME_MS),
      tick(FRAME_MS),
      Command.expectNone(),
    )
  })
})

describe('music only plays when it can be heard', () => {
  test('no music Commands while audio is locked, unlocking, suspended, or unavailable', () => {
    const silentStates = [
      AudioState.Locked(),
      AudioState.Unlocking(),
      AudioState.Suspended(),
      AudioState.Unavailable(),
    ]
    Array.forEach(silentStates, audio => {
      story(
        update,
        given(
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
        model(({ phase }) => {
          expect(phase._tag).toBe('Wave')
        }),
        Command.expectNone(),
      )
    })
  })

  test('with music off, a phase change sends no music Command', () => {
    story(
      update,
      given(
        modifyFields(preparing(1, [FAR_AWAY_SPAWN], AudioState.Ready()), {
          musicSetting: () => 'Off',
        }),
      ),
      pressKey('Enter'),
      model(({ phase }) => {
        expect(phase._tag).toBe('Wave')
      }),
      Command.expectNone(),
    )
  })

  test('N toggles music off and back on', () => {
    story(
      update,
      given(fighting(2, AudioState.Ready())),
      pressKey('KeyN'),
      model(({ musicSetting }) => {
        expect(musicSetting).toBe('Off')
      }),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      pressKey('KeyN'),
      model(({ musicSetting }) => {
        expect(musicSetting).toBe('On')
      }),
      Command.expectExact(
        CueMusic({ mood: 'Romp', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Romp'),
    )
  })

  test('the music button toggles music and unlocks audio', () => {
    story(
      update,
      given(titleScreen(AudioState.Locked())),
      message(Message.ClickedMusicButton()),
      model(({ musicSetting, audio }) => {
        expect(musicSetting).toBe('Off')
        expect(audio).toEqual(AudioState.Unlocking())
      }),
      Command.expectNone(),
      message(Message.ClickedMusicButton()),
      model(({ musicSetting }) => {
        expect(musicSetting).toBe('On')
      }),
    )
  })

  test('the music button on an audible title stops and restarts the creep loop', () => {
    story(
      update,
      given(titleScreen(AudioState.Ready())),
      message(Message.ClickedMusicButton()),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      message(Message.ClickedMusicButton()),
      Command.expectExact(
        CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Creep'),
    )
  })

  test('mute silences the music, and unmuting brings it back', () => {
    story(
      update,
      given(fighting(FINAL_WAVE, AudioState.Ready())),
      pressKey('KeyM'),
      model(({ soundSetting, musicSetting }) => {
        expect(soundSetting).toBe('Muted')
        expect(musicSetting).toBe('On')
      }),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      pressKey('KeyN'),
      pressKey('KeyN'),
      Command.expectNone(),
      pressKey('KeyM'),
      Command.expectExact(
        CueMusic({ mood: 'Stampede', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Stampede'),
    )
  })

  test('a hidden tab silences the title music, and coming back resumes it', () => {
    story(
      update,
      given(titleScreen(AudioState.Ready())),
      message(Message.ChangedPageVisibility({ visibility: 'Hidden' })),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
      message(Message.ChangedPageVisibility({ visibility: 'Visible' })),
      Command.expectExact(
        CueMusic({ mood: 'Creep', level: 'Full', stinger: 'None' }),
        FetchBuild,
      ),
      resolveCue('Creep'),
      Command.resolve(
        FetchBuild,
        Message.FailedFetchBuild({ reason: 'offline' }),
      ),
    )
  })

  test('a muted run plays no stinger when it ends', () => {
    story(
      update,
      given(
        modifyFields(preparing(FINAL_WAVE, [], AudioState.Ready()), {
          soundSetting: () => 'Muted',
        }),
      ),
      pressKey('Enter'),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      Command.expectNone(),
    )
  })
})

describe('the end stingers stop when the music goes quiet', () => {
  const victoryScreen = (audio: AudioState): Model =>
    modifyFields(titleScreen(audio), {
      phase: () => Phase.Victory(),
      screenMs: () => 0,
    })

  test('mute during the Victory stinger stops it', () => {
    story(
      update,
      given(victoryScreen(AudioState.Ready())),
      pressKey('KeyM'),
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('Muted')
      }),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
    )
  })

  test('turning music off during the Game Over stinger stops it', () => {
    story(
      update,
      given(
        modifyFields(victoryScreen(AudioState.Ready()), {
          phase: () => Phase.GameOver({ wave: 4 }),
        }),
      ),
      message(Message.ClickedMusicButton()),
      model(({ musicSetting }) => {
        expect(musicSetting).toBe('Off')
      }),
      Command.expectExact(
        CueMusic({ mood: 'Silence', level: 'Full', stinger: 'None' }),
      ),
      resolveCue('Silence'),
    )
  })

  test('unmuting on the Victory screen does not replay the stinger', () => {
    story(
      update,
      given(
        modifyFields(victoryScreen(AudioState.Ready()), {
          soundSetting: () => 'Muted',
        }),
      ),
      pressKey('KeyM'),
      model(({ soundSetting }) => {
        expect(soundSetting).toBe('On')
      }),
      Command.expectNone(),
    )
  })
})
