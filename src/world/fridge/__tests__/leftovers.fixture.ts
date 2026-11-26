import { Array } from 'effect'

import type { Model } from '#app/model.ts'
import { focusSlotOf } from '#world/party/party.ts'
import { offersOf } from '#world/shop/purchase.ts'

export const isFridgeOffered = (current: Model): boolean =>
  Array.some(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Fridge',
  )
