import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { BeatMyRun, type FriendsDare, type OwnPicks } from '#domain/beatLink.ts'
import { BeatEvent, beatMachine, stepBeat } from '#domain/machines/beatMyRun.ts'
import { noModifiers } from '#world/run/modifiers.ts'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(beatMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

const DARE: FriendsDare = {
  seed: 1,
  mode: 'Campaign',
  difficulty: 'Hard',
  modifiers: noModifiers,
  dareMark: 0,
  easyBreakSeconds: 0,
  pool: [],
  hero: 'Handyman',
  outcome: 'Munched',
  wave: 3,
  found: [],
  runSeconds: 100,
}

const OWN: OwnPicks = {
  mode: 'Campaign',
  difficulty: 'Normal',
  modifiers: noModifiers,
  dareMark: 0,
  easyBreakSeconds: 0,
  bots: [],
}

const OTHER_OWN: OwnPicks = { ...OWN, difficulty: 'Easy' }

describe("a friend's dare", () => {
  test('each state answers only the events it means to', () => {
    expect(registered()).toEqual([
      'None/Offered',
      'Offered/Dismissed',
      'Offered/Offered',
      'Offered/Took',
      'Taken/Dismissed',
      'Taken/Offered',
      'Taken/Released',
    ])
    expect(Machine.definition(beatMachine).anyState).toEqual([])
  })

  test('taking a dare already taken keeps the first own picks', () => {
    const taken = stepBeat(
      BeatMyRun.Offered({ dare: DARE }),
      BeatEvent.Took({ own: OWN }),
    )
    expect(stepBeat(taken, BeatEvent.Took({ own: OTHER_OWN }))).toBe(taken)
  })

  test('nothing to take, release, or dismiss with no dare', () => {
    expect(stepBeat(BeatMyRun.None, BeatEvent.Took({ own: OWN }))).toBe(
      BeatMyRun.None,
    )
    expect(stepBeat(BeatMyRun.None, BeatEvent.Released)).toBe(BeatMyRun.None)
    expect(stepBeat(BeatMyRun.None, BeatEvent.Dismissed)).toBe(BeatMyRun.None)
  })

  test('a released dare is offered again', () => {
    expect(
      stepBeat(BeatMyRun.Taken({ dare: DARE, own: OWN }), BeatEvent.Released),
    ).toEqual(BeatMyRun.Offered({ dare: DARE }))
  })
})
