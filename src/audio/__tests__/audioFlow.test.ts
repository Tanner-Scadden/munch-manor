import { Array } from 'effect'
import { Machine } from 'effect-machine'
import { describe, expect, test } from 'vitest'

import { AudioState } from '../../domain/clientSchema'
import { AudioEvent, audioMachine, stepAudio } from '../audioFlow'

const registered = (): ReadonlyArray<string> =>
  Array.sort(
    Array.flatMap(Machine.definition(audioMachine).states, state =>
      Array.map(
        state.transitions,
        transition => `${state.tag}/${transition.event}`,
      ),
    ),
    (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0),
  )

describe('the audio engine', () => {
  test('each state answers only the result it waits for', () => {
    expect(registered()).toEqual([
      'Locked/Unlocked',
      'Ready/WentQuiet',
      'Suspended/Resumed',
      'Unlocking/FailedToGetEngine',
      'Unlocking/GotEngine',
    ])
    expect(Machine.definition(audioMachine).anyState).toEqual([])
  })

  test('a late engine or resume after the engine failed changes nothing', () => {
    expect(stepAudio(AudioState.Unavailable, AudioEvent.GotEngine)).toBe(
      AudioState.Unavailable,
    )
    expect(stepAudio(AudioState.Unavailable, AudioEvent.Resumed)).toBe(
      AudioState.Unavailable,
    )
  })

  test('a resume before the engine is in hand is dropped', () => {
    expect(stepAudio(AudioState.Unlocking, AudioEvent.Resumed)).toBe(
      AudioState.Unlocking,
    )
    expect(stepAudio(AudioState.Locked, AudioEvent.GotEngine)).toBe(
      AudioState.Locked,
    )
  })

  test('the engine goes quiet and comes back', () => {
    const quiet = stepAudio(AudioState.Ready, AudioEvent.WentQuiet)
    expect(quiet).toBe(AudioState.Suspended)
    expect(stepAudio(quiet, AudioEvent.Resumed)).toBe(AudioState.Ready)
  })
})
