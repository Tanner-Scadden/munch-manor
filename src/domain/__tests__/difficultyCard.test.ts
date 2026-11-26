import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { DifficultyCard } from '#domain/clientSchema.ts'
import {
  CardEvent,
  difficultyCardMachine,
  stepDifficultyCard,
} from '#domain/difficultyCard.ts'
import { RunMode } from '#world/schema/worldSchema.ts'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(difficultyCardMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

const asking = DifficultyCard.Asking({
  mode: RunMode.Campaign(),
  tutorial: 'Tutorial',
})

describe('the first-run difficulty question', () => {
  test('each state answers only the events it means to', () => {
    expect(registered()).toEqual([
      'Asking/Chose',
      'Asking/PickedTutorial',
      'Asking/Remembered',
      'Asking/WentBack',
      'Unseen/Asked',
      'Unseen/Remembered',
    ])
    expect(Machine.definition(difficultyCardMachine).anyState).toEqual([])
  })

  test('a card once seen is never asked again', () => {
    expect(
      stepDifficultyCard(
        DifficultyCard.Seen,
        CardEvent.Asked({ mode: RunMode.Campaign() }),
      ),
    ).toBe(DifficultyCard.Seen)
    expect(stepDifficultyCard(DifficultyCard.Seen, CardEvent.WentBack)).toBe(
      DifficultyCard.Seen,
    )
  })

  test('picking the tutorial choice already picked changes nothing', () => {
    expect(
      stepDifficultyCard(
        asking,
        CardEvent.PickedTutorial({ tutorial: 'Tutorial' }),
      ),
    ).toBe(asking)
    expect(
      stepDifficultyCard(
        asking,
        CardEvent.PickedTutorial({ tutorial: 'Skip' }),
      ),
    ).toEqual(
      DifficultyCard.Asking({ mode: RunMode.Campaign(), tutorial: 'Skip' }),
    )
  })

  test('backing out of the question asks it again next time', () => {
    expect(stepDifficultyCard(asking, CardEvent.WentBack)).toBe(
      DifficultyCard.Unseen,
    )
  })
})
