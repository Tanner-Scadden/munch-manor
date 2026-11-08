// The difficulty sim test: 20 seconds of a wave on each difficulty, played
// twice. It takes about a second, so it runs in `bun run test:full` and CI,
// not in `bun run test`. The difficulty rules are in
// difficulty.story.test.ts.
import { Array, Effect, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Difficulty, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { SURFACE, playedThrough, startedRun } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { focusOf } from '../../party/party'

const REPLAYED: ReadonlyArray<Difficulty> = ['Easy', 'Hard', 'Nightmare']

const startedOn = (chosen: Difficulty) =>
  startedRun(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
      difficulty: () => ({ chosen, nightmare: 'Unlocked' as const }),
    }),
  )

const skipBreak = (started: Model): Model =>
  modifyFields(started, {
    phase: phase =>
      Phase.match(phase, {
        Ready: () => phase,
        Preparation: preparation =>
          modifyFields(preparation, { remainingMs: () => 0 }),
        Wave: () => phase,
        Paused: () => phase,
        Victory: () => phase,
        GameOver: () => phase,
      }),
  })

const FRAMES = Array.makeBy(600, () => Message.TickedFrame({ deltaTime: 33 }))

const playFor = (difficulty: Difficulty) =>
  Effect.flatMap(startedOn(difficulty), started =>
    playedThrough(skipBreak(started), FRAMES),
  )

describe('the multipliers', () => {
  it.effect('the same seed on the same difficulty plays out the same', () =>
    Effect.gen(function* () {
      yield* Effect.forEach(REPLAYED, difficulty =>
        Effect.gen(function* () {
          const first = yield* playFor(difficulty)
          const second = yield* playFor(difficulty)
          expect(first.zombies.length).toBeGreaterThan(0)
          expect(second.zombies).toEqual(first.zombies)
          expect(focusOf(second).player).toEqual(focusOf(first).player)
          expect(second.rngState).toBe(first.rngState)
        }),
      )
      const easy = yield* playFor('Easy')
      const hard = yield* playFor('Hard')
      expect(Array.map(easy.zombies, ({ speed }) => speed)).not.toEqual(
        Array.map(hard.zombies, ({ speed }) => speed),
      )
    }),
  )
})
