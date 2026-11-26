import { Function, Result } from 'effect'

import { UiStruct } from '@effect/ui'

import { notePress } from '../../platform/recording'
import { leadSeatOf } from '../../world/party/party'
import { withWorld } from '../../world/schema/world'
import {
  type ActionRefusal,
  type PlayerSlot,
  type SeatAction,
  applySeatAction,
  trySeatAction,
} from '../../world/step/stepWorld'
import type { Model } from '../model'

const pressed = (model: Model, slot: PlayerSlot, action: SeatAction): Model =>
  UiStruct.evolve(model, { recorder: notePress(slot, action) })

export const actAsLead: {
  (action: SeatAction): (model: Model) => Model
  (model: Model, action: SeatAction): Model
} = Function.dual(2, (model: Model, action: SeatAction): Model => {
  const { slot } = leadSeatOf(model)
  return pressed(
    withWorld(model, world => applySeatAction(world, slot, action)),
    slot,
    action,
  )
})

export const tryAsLead: {
  (action: SeatAction): (model: Model) => Result.Result<Model, ActionRefusal>
  (model: Model, action: SeatAction): Result.Result<Model, ActionRefusal>
} = Function.dual(
  2,
  (model: Model, action: SeatAction): Result.Result<Model, ActionRefusal> =>
    Result.map(trySeatAction(model, leadSeatOf(model).slot, action), world =>
      pressed(
        withWorld(model, () => world),
        leadSeatOf(model).slot,
        action,
      ),
    ),
)
