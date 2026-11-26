import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import type { DeathTip } from '../../../domain/clientSchema'
import { DEATH_TIPS } from '../../../world/names'
import { diesOnWave7, ended } from './rank.fixture'

const tipOf = (model: Model): Option.Option<DeathTip> =>
  model.endCard.maybeDeathTip

describe("Rattles' death tip", () => {
  it.effect('is about the zombie that landed the last bite', () =>
    Effect.gen(function* () {
      const after = yield* ended(diesOnWave7)
      expect(Option.map(tipOf(after), ({ kind }) => kind)).toEqual(
        Option.some('Runner'),
      )
      expect(
        Option.exists(tipOf(after), ({ line }) =>
          Array.contains(DEATH_TIPS.Runner, line),
        ),
      ).toBe(true)
    }),
  )

  it.effect('never says the line it said last', () =>
    Effect.forEach(
      Array.range(0, 7),
      seed => {
        const last = DEATH_TIPS.Runner[seed % DEATH_TIPS.Runner.length] ?? ''
        return Effect.map(
          ended(
            UiStruct.evolve(diesOnWave7, {
              endCard: UiStruct.evolve({
                maybeDeathTip: () =>
                  Option.some({ kind: 'Runner' as const, line: last }),
              }),
              cosmetics: UiStruct.evolve({
                cosmeticRngState: () => seed * 7919,
              }),
            }),
          ),
          after => {
            expect(Option.map(tipOf(after), ({ line }) => line)).not.toEqual(
              Option.some(last),
            )
          },
        )
      },
      { discard: true },
    ),
  )

  it.effect('keeps quiet once the player has escaped on the difficulty', () =>
    Effect.gen(function* () {
      const escaped = yield* ended(
        UiStruct.evolve(diesOnWave7, {
          bonuses: bonuses => ({ ...bonuses, escapedOn: ['Normal'] }),
        }),
      )
      expect(tipOf(escaped)).toEqual(Option.none())
      const won = yield* ended(
        UiStruct.evolve(diesOnWave7, {
          bests: bests =>
            UiStruct.evolve(bests, {
              byDifficulty: byDifficulty =>
                UiStruct.evolve(byDifficulty, {
                  Normal: normal =>
                    UiStruct.evolve(normal, {
                      maybeFastestWinMs: () => Option.some(600_000),
                    }),
                }),
            }),
        }),
      )
      expect(tipOf(won)).toEqual(Option.none())
    }),
  )
})
