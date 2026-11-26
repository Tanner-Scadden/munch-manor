import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import {
  ResetEvent,
  TutorialReset,
  resetMachine,
  stepReset,
} from '../resetFlow'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(resetMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

describe("the Profile's tutorial reset", () => {
  test('each state answers only the events it means to', () => {
    expect(registered()).toEqual([
      'Asking/Cancelled',
      'Asking/Confirmed',
      'Asking/LeftTab',
      'Done/Asked',
      'Done/LeftTab',
      'Idle/Asked',
    ])
    expect(Machine.definition(resetMachine).anyState).toEqual([])
  })

  test('a confirm or cancel with no question up changes nothing', () => {
    expect(stepReset(TutorialReset.Idle, ResetEvent.Confirmed)).toBe(
      TutorialReset.Idle,
    )
    expect(stepReset(TutorialReset.Done, ResetEvent.Cancelled)).toBe(
      TutorialReset.Done,
    )
  })

  test('the question asked again after a reset', () => {
    expect(stepReset(TutorialReset.Done, ResetEvent.Asked)).toBe(
      TutorialReset.Asking,
    )
  })
})
