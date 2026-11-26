import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { Loading } from '#domain/clientSchema.ts'
import {
  LoadEvent,
  loadMachine,
  stepLoading,
} from '#domain/machines/loadFlow.ts'

const registered = (): ReadonlyArray<string> =>
  Array.flatMap(Machine.definition(loadMachine).states, state =>
    Array.map(
      state.transitions,
      transition => `${state.tag}/${transition.event}`,
    ),
  )

const waiting = Loading.Loading({ pending: ['Save', 'Fonts'] })

describe('the loading splash', () => {
  test('only a load still waiting takes a finished step', () => {
    expect(registered()).toEqual(['Loading/Finished'])
    expect(Machine.definition(loadMachine).anyState).toEqual([])
  })

  test('a step finished twice, or one not waited on, changes nothing', () => {
    const saved = stepLoading(waiting, LoadEvent.Finished({ step: 'Save' }))
    expect(saved).toEqual(Loading.Loading({ pending: ['Fonts'] }))
    expect(stepLoading(saved, LoadEvent.Finished({ step: 'Save' }))).toBe(saved)
    expect(stepLoading(waiting, LoadEvent.Finished({ step: 'Sprites' }))).toBe(
      waiting,
    )
  })

  test('the last step loads the game, and a late one after it is dropped', () => {
    const loaded = stepLoading(
      Loading.Loading({ pending: ['Fonts'] }),
      LoadEvent.Finished({ step: 'Fonts' }),
    )
    expect(loaded).toBe(Loading.Loaded)
    expect(stepLoading(loaded, LoadEvent.Finished({ step: 'Save' }))).toBe(
      Loading.Loaded,
    )
  })
})
