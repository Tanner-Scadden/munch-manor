import { Function, Result } from 'effect'
import { modifyFields } from 'foldkit/struct'

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

// Single player's presses as its own seat's actions. The rule of each
// action lives once, in src/world/step/stepWorld.ts, where the co-op room applies it
// too; a handler here keeps only its client checks in front (the menus,
// the new zombie card) and its cues around it (sounds, chatter, the dropped
// clip, focus).

// NOTE: a recorded run (src/platform/recording.ts) keeps the press as the
// action, so a replay applies it by the same rule.
const pressed = (model: Model, slot: PlayerSlot, action: SeatAction): Model =>
  modifyFields(model, { recorder: notePress(slot, action) })

// NOTE: the Model with the action applied to its lead seat, or as it was.
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

// NOTE: the same, with why nothing changed, for the cues of a refusal.
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
