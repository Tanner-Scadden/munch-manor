import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Difficulty, type Model, Phase } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { SURFACE, playedThrough, startedRun } from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'
import { focusOf } from '#world/party/party.ts'

const REPLAYED: ReadonlyArray<Difficulty> = ['Easy', 'Hard', 'Nightmare']

const startedOn = (chosen: Difficulty) =>
  startedRun(
    UiStruct.evolve(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
      difficulty: () => ({ chosen, nightmare: 'Unlocked' as const }),
    }),
  )

const skipBreak = (started: Model): Model =>
  UiStruct.evolve(started, {
    phase: phase =>
      Phase.match(phase, {
        Ready: () => phase,
        Arriving: () => phase,
        Preparation: preparation =>
          UiStruct.evolve(preparation, { remainingMs: () => 0 }),
        Wave: () => phase,
        Paused: () => phase,
        Escaped: () => phase,
        LeftEarly: () => phase,
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
