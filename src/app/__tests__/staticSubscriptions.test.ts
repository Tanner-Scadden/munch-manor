import { Array, Effect, String } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { type Model } from '#app/model.ts'
import { subscriptions } from '#app/subscriptions.ts'
import { playingModel } from '#test/model.fixture.ts'
import {
  FRAME_MS,
  checkModel,
  settleRunCommands,
  storyOf,
  tick,
} from '#test/testing.ts'

const FRAMES = 30

const STATIC_KEYS = [
  'PlayerSync',
  'Today',
  'InstallOffers',
  'Gamepad',
  'Keyboard',
  'KeyWatch',
  'WindowBlur',
  'PageVisibility',
  'WindowFocus',
  'PageRestores',
  'PointerReleases',
  'FullscreenChanges',
]

describe('the static Subscriptions', () => {
  it.effect('keep their keys through every frame of a wave', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      const first = s.subscriptions
      for (const key of STATIC_KEYS) {
        expect(Array.filter(first, String.includes(key))).toHaveLength(1)
      }
      const keysOf = (keys: ReadonlyArray<string>) =>
        Array.filter(keys, key =>
          Array.some(STATIC_KEYS, name => String.includes(name)(key)),
        )
      for (let frame = 0; frame < FRAMES; frame += 1) {
        s.pipe(tick(FRAME_MS), settleRunCommands)
        expect(keysOf(s.subscriptions)).toEqual(keysOf(first))
      }
      return s.model
    }),
  )

  it.effect('build no list on a frame whose gates stay as they were', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      const lists: Array<ReadonlyArray<unknown>> = []
      const listOf = (model: Model) => subscriptions({ model })
      lists.push(listOf(s.model))
      for (let frame = 0; frame < FRAMES; frame += 1) {
        s.pipe(
          tick(FRAME_MS),
          settleRunCommands,
          checkModel(model => {
            lists.push(listOf(model))
          }),
        )
      }
      for (const list of lists) {
        expect(list).toBe(lists[0])
      }
      return s.model
    }),
  )
})
