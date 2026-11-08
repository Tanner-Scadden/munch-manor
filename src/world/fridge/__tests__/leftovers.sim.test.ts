// The fridge's slam sim test: pull after pull until the door slams, then
// its rest, each pull a Block-aware Story. It takes about half a second, so
// it runs in `bun run test:full` and CI, not in `bun run test`. The fridge's
// rules are in leftovers.story.test.ts.
import { Array, Effect } from 'effect'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { FridgeDoor, type Model } from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { atFridge } from '../../../test/model.fixture'
import {
  FIXED_FRAME,
  FRIDGE_OPEN_TICKS,
  HOLD_TICKS,
  playedThrough,
} from '../../../test/testing'
import { focusOf } from '../../party/party'
import { FRIDGE_RULES } from '../leftovers'
import { isFridgeOffered } from './leftovers.fixture'

const FRAME_MS = FIXED_STEP_MS

// NOTE: `count` fixed-step frames.
const framesOf = (count: number): ReadonlyArray<Message> =>
  Array.makeBy(count, () => FIXED_FRAME)

const pullOnce = (current: Model): Effect.Effect<Model> =>
  playedThrough(current, [
    Message.PressedKey({ code: 'Enter' }),
    ...framesOf(HOLD_TICKS),
    Message.ReleasedKey({ code: 'Enter' }),
    ...framesOf(
      FRIDGE_OPEN_TICKS + Math.ceil(FRIDGE_RULES.offerMs / FRAME_MS) + 2,
    ),
  ])

describe('the fridge slams shut', () => {
  it.effect(
    'it slams after its third or fourth pull, rests, and opens again luckier',
    () =>
      Effect.gen(function* () {
        const unpulled: Array.NonEmptyReadonlyArray<Model> = [atFridge(1000)]
        const pulls = yield* Effect.reduce(
          Array.makeBy(FRIDGE_RULES.maxPulls, index => index),
          () => unpulled,
          (pulled: Array.NonEmptyReadonlyArray<Model>) =>
            FridgeDoor.isAnyOf(['Slammed'])(
              Array.lastNonEmpty(pulled).fridge.door,
            )
              ? Effect.succeed(pulled)
              : pullOnce(Array.lastNonEmpty(pulled)).pipe(
                  Effect.map(next => Array.append(pulled, next)),
                ),
        )
        const slammed = Array.lastNonEmpty(pulls)
        expect(pulls.length - 1).toBeGreaterThanOrEqual(
          FRIDGE_RULES.pullsBeforeSlam,
        )
        expect(pulls.length - 1).toBeLessThanOrEqual(FRIDGE_RULES.maxPulls)
        expect(FridgeDoor.isAnyOf(['Slammed'])(slammed.fridge.door)).toBe(true)
        expect(slammed.fridge.luck).toBe(1)
        expect(slammed.fridge.pulls).toBe(0)
        expect(isFridgeOffered(slammed)).toBe(false)
        expect(focusOf(slammed).wallet.balance).toBeLessThan(1000)
        const rested = yield* playedThrough(
          slammed,
          framesOf(Math.ceil(FRIDGE_RULES.slamMs / FRAME_MS) + 1),
        )
        expect(rested.fridge.door).toEqual(FridgeDoor.Shut())
        expect(isFridgeOffered(rested)).toBe(true)
      }),
  )
})
