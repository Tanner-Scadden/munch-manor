import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model, Phase, RunMode } from '#app/model.ts'
import { WriteSave } from '#app/update/save.ts'
import { QUICK_DEATH_WAVE } from '#features/intro/carLine.ts'
import { PlayerChange } from '#platform/save/playerSync.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import type { RunEnding } from '#shared/records/playerData.ts'
import {
  DISTANT_SPAWN,
  escaping,
  lastHeart,
  readyAfterRead,
  readyModel,
  withDareThings,
} from '#test/model.fixture.ts'
import {
  checkPendingArgs,
  modelAfter,
  send,
  steps,
  storyOf,
  tick,
  writeSave,
} from '#test/testing.ts'
import { DareThingState } from '#world/dare/dareSchema.ts'
import { FRIEND_LINES } from '#world/names.ts'

const inWave = (wave: number): Model =>
  UiStruct.evolve(readyAfterRead, {
    mode: () => RunMode.Campaign(),
    phase: () => Phase.Wave({ wave, elapsedMs: 4000, spawns: [] }),
  })

const walkingOut: Model = escaping(
  withDareThings(
    UiStruct.evolve(readyAfterRead, {
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
  Effect.map(
    modelAfter(model, steps(tick(FIXED_STEP_MS), writeSave)),
    ({ lastRunEnding }) => lastRunEnding,
  )

const lineOf = (model: Model): Option.Option<string> => model.maybeCarLine

const isLineFor = (ending: RunEnding, model: Model): boolean =>
  Option.exists(lineOf(model), line =>
    Array.contains(FRIEND_LINES[ending], line),
  )

const retriedAfter = (model: Model) =>
  modelAfter(model, send(Message.ClickedRetryButton()))

const onEndScreen = (ending: RunEnding, wave: number): Model =>
  UiStruct.evolve(readyModel, {
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
    Effect.gen(function* () {
      const s = yield* storyOf(lastHeart(inWave(6)))
      s.pipe(
        tick(FIXED_STEP_MS),
        checkPendingArgs(WriteSave)(writes => {
          expect(Array.map(writes, ({ save }) => save.lastRun)).toContain(
            'Munched',
          )
          expect(
            Array.flatMap(writes, ({ changes }) => changes),
          ).toContainEqual(PlayerChange.EndedRun({ lastRun: 'Munched' }))
        }),
        writeSave,
      )
    }),
  )
})

describe('the friends in the car', () => {
  it.effect('the very first run opens on a line about the dare', () =>
    Effect.map(retriedAfter(onEndScreen('NoRunYet', 5)), after => {
      expect(after.phase._tag).toBe('Arriving')
      expect(isLineFor('NoRunYet', after)).toBe(true)
    }),
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
            UiStruct.evolve(onEndScreen('Munched', 5), {
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
