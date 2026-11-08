// What the fridge's Story and sim tests share
// (leftovers.story.test.ts, leftovers.sim.test.ts).

import { Array } from 'effect'

import type { Model } from '../../../app/model'
import { focusSlotOf } from '../../party/party'
import { offersOf } from '../../shop/purchase'

// NOTE: whether the hold to buy offers the fridge to the focused player.
export const isFridgeOffered = (current: Model): boolean =>
  Array.some(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Fridge',
  )
