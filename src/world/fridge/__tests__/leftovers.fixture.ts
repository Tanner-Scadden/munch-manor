import { Array } from 'effect'

import type { Model } from '../../../app/model'
import { focusSlotOf } from '../../party/party'
import { offersOf } from '../../shop/purchase'

export const isFridgeOffered = (current: Model): boolean =>
  Array.some(
    offersOf(current, focusSlotOf(current)),
    ({ target }) => target._tag === 'Fridge',
  )
