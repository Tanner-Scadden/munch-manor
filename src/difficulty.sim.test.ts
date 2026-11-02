// The difficulty sim test: 20 seconds of a wave on each difficulty, played
// twice. It takes about a second, so it runs in `bun run test:full` and CI,
// not in `bun run test`. The difficulty rules are in
// difficulty.story.test.ts.
import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { update } from './main'
import { Message } from './message'
import { type Difficulty, type Model, Phase, initialModel } from './model'
import { SURFACE, startedRunOf } from './testing'
import { asVeteran } from './veteran'

const REPLAYED: ReadonlyArray<Difficulty> = ['Easy', 'Hard', 'Nightmare']

const startedOn = (chosen: Difficulty): Model =>
  startedRunOf(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
      difficulty: () => ({ chosen, nightmare: 'Unlocked' as const }),
    }),
  )

describe('the multipliers', () => {
  test('the same seed on the same difficulty plays out the same', () => {
    const playFor = (difficulty: Difficulty): Model =>
      Array.reduce(
        Array.makeBy(600, () => Message.TickedFrame({ deltaTime: 33 })),
        modifyFields(startedOn(difficulty), {
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
        }),
        (current, frame) => update(current, frame).model,
      )
    Array.forEach(REPLAYED, difficulty => {
      const first = playFor(difficulty)
      const second = playFor(difficulty)
      expect(first.zombies.length).toBeGreaterThan(0)
      expect(second.zombies).toEqual(first.zombies)
      expect(second.player).toEqual(first.player)
      expect(second.rngState).toBe(first.rngState)
    })
    const easySpeeds = Array.map(playFor('Easy').zombies, ({ speed }) => speed)
    const hardSpeeds = Array.map(playFor('Hard').zombies, ({ speed }) => speed)
    expect(easySpeeds).not.toEqual(hardSpeeds)
  })
})
