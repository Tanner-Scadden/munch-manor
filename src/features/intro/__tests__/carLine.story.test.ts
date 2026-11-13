import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase, RunMode } from '../../../app/model'
import { WriteSave } from '../../../app/update/save'
import { PlayerChange } from '../../../platform/playerSync'
import { FIXED_STEP_MS } from '../../../shared/constants'
import type { RunEnding } from '../../../shared/playerData'
import {
  DISTANT_SPAWN,
  escaping,
  lastHeart,
  readyAfterRead,
  readyModel,
  withDareThings,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  checkPendingArgs,
  tick,
  writeSave,
} from '../../../test/testing'
import { DareThingState } from '../../../world/dare/dareSchema'
import { FRIEND_LINES } from '../../../world/names'
import { QUICK_DEATH_WAVE } from '../carLine'

// Your friends in the car (src/features/intro/carLine.ts): how a run ends
// is noted on the frame it ends, and the next intro opens with a line from
// the friends for that ending, never the one they said last.

const inWave = (wave: number): Model =>
  modifyFields(readyAfterRead, {
    mode: () => RunMode.Campaign(),
    phase: () => Phase.Wave({ wave, elapsedMs: 4000, spawns: [] }),
  })

// NOTE: wave 10, the list done, the front door open, and the player on
// its sill: the next frame walks out.
const walkingOut: Model = escaping(
  withDareThings(
    modifyFields(readyAfterRead, {
      mode: () => RunMode.Campaign(),
      phase: () =>
        Phase.Wave({ wave: 10, elapsedMs: 4000, spawns: [DISTANT_SPAWN] }),
    }),
    Array.map(
      ['SilverSpoon', 'MusicBox', 'FamilyPortrait'] as const,
      (kind, id) => ({ id, kind, state: DareThingState.Found({ slot: 0 }) }),
    ),
  ),
)

const endingAfter = (model: Model) =>
  Story.story(
    APPLICATION,
    Story.given(model),
    tick(FIXED_STEP_MS),
    writeSave(),
  ).pipe(Effect.map(({ lastRunEnding }) => lastRunEnding))

const lineOf = (model: Model): Option.Option<string> => model.maybeCarLine

const isLineFor = (ending: RunEnding, model: Model): boolean =>
  Option.exists(lineOf(model), line =>
    Array.contains(FRIEND_LINES[ending], line),
  )

// NOTE: RETRY from an end screen, `model` with its run ended so.
const retriedAfter = (model: Model) =>
  Story.story(
    APPLICATION,
    Story.given(model),
    Story.message(Message.ClickedRetryButton()),
  )

const onEndScreen = (ending: RunEnding, wave: number): Model =>
  modifyFields(readyModel, {
    mode: () => RunMode.Campaign(),
    phase: () => Phase.GameOver({ wave }),
    screenMs: () => 60_000,
    lastRunEnding: () => ending,
  })

describe('how the last run ended', () => {
  it.effect('a death past the first waves is Munched', () =>
    Effect.map(endingAfter(lastHeart(inWave(QUICK_DEATH_WAVE + 1))), ending =>
      expect(ending).toBe('Munched'),
    ),
  )

  it.effect('a death on the first waves is MunchedEarly', () =>
    Effect.map(endingAfter(lastHeart(inWave(QUICK_DEATH_WAVE))), ending =>
      expect(ending).toBe('MunchedEarly'),
    ),
  )

  it.effect('walking out the front door is Escaped', () =>
    Effect.map(endingAfter(walkingOut), ending =>
      expect(ending).toBe('Escaped'),
    ),
  )

  it.effect('is saved, and synced as its own change', () =>
    Story.story(
      APPLICATION,
      Story.given(lastHeart(inWave(6))),
      tick(FIXED_STEP_MS),
      checkPendingArgs(Story.Command.argsOf(WriteSave))(writes => {
        expect(Array.map(writes, ({ save }) => save.lastRun)).toContain(
          'Munched',
        )
        expect(Array.flatMap(writes, ({ changes }) => changes)).toContainEqual(
          PlayerChange.EndedRun({ lastRun: 'Munched' }),
        )
      }),
      writeSave(),
    ),
  )
})

describe('the friends in the car', () => {
  it.effect('the very first run opens on a line about the dare', () =>
    Effect.map(
      Story.story(
        APPLICATION,
        Story.given(onEndScreen('NoRunYet', 5)),
        Story.message(Message.ClickedRetryButton()),
      ),
      after => {
        expect(after.phase._tag).toBe('Arriving')
        expect(isLineFor('NoRunYet', after)).toBe(true)
      },
    ),
  )

  it.effect('a line for each ending', () =>
    Effect.forEach(
      ['Munched', 'MunchedEarly', 'Escaped', 'LeftEarly'] as const,
      ending =>
        Effect.map(retriedAfter(onEndScreen(ending, 5)), after => {
          expect(after.phase._tag).toBe('Arriving')
          expect(isLineFor(ending, after)).toBe(true)
        }),
      { discard: true },
    ),
  )

  it.effect('never says the line it said last', () =>
    Effect.forEach(
      Array.range(0, 9),
      seed => {
        const last =
          FRIEND_LINES.Munched[seed % FRIEND_LINES.Munched.length] ?? ''
        return Effect.map(
          retriedAfter(
            modifyFields(onEndScreen('Munched', 5), {
              rngState: () => seed * 7919,
              maybeCarLine: () => Option.some(last),
            }),
          ),
          after => {
            expect(isLineFor('Munched', after)).toBe(true)
            expect(lineOf(after)).not.toEqual(Option.some(last))
          },
        )
      },
      { discard: true },
    ),
  )
})
