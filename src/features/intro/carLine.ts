import { Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { pickLine } from '#shared/prng.ts'
import type { RunEnding } from '#shared/records/playerData.ts'
import { FRIEND_LINES } from '#world/names.ts'
import { isArriving } from '#world/run/arrival.ts'
import { Phase } from '#world/schema/worldSchema.ts'

export const QUICK_DEATH_WAVE = 2

const maybeEndingOf = (phase: Phase): Option.Option<RunEnding> =>
  Phase.matchOrElse(
    phase,
    {
      GameOver: ({ wave }): Option.Option<RunEnding> =>
        Option.some(wave <= QUICK_DEATH_WAVE ? 'MunchedEarly' : 'Munched'),
      Escaped: (): Option.Option<RunEnding> => Option.some('Escaped'),
      LeftEarly: (): Option.Option<RunEnding> => Option.some('LeftEarly'),
    },
    () => Option.none(),
  )

export const noteRunEnding: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  Option.isNone(maybeEndingOf(before.phase))
    ? Option.match(maybeEndingOf(after.phase), {
        onNone: () => after,
        onSome: ending =>
          ending === after.lastRunEnding
            ? after
            : UiStruct.evolve(after, { lastRunEnding: () => ending }),
      })
    : after,
)

const lastLineOf = (model: Model): string =>
  Option.getOrElse(model.maybeCarLine, () => '')

export const pickCarLine: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (isArriving(before.phase) || !isArriving(after.phase)) {
    return after
  }
  const [state, line] = pickLine(
    after.cosmetics.cosmeticRngState,
    FRIEND_LINES[after.lastRunEnding],
    lastLineOf(after),
  )
  return UiStruct.evolve(after, {
    maybeCarLine: () => Option.some(line),
    cosmetics: UiStruct.evolve({ cosmeticRngState: () => state }),
  })
})
