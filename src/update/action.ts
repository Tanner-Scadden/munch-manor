import { Function, Result } from 'effect'

import type { Model } from '../model'
import { leadSeatOf } from '../party'
import {
  type ActionRefusal,
  type SeatAction,
  applySeatAction,
  trySeatAction,
} from '../stepWorld'
import { withWorld } from '../world'

// Single player's presses as its own seat's actions. The rule of each
// action lives once, in src/stepWorld.ts, where the co-op room applies it
// too; a handler here keeps only its client checks in front (the menus,
// the new zombie card) and its cues around it (sounds, chatter, the dropped
// clip, focus).

// NOTE: the Model with the action applied to its lead seat, or as it was.
export const actAsLead: {
  (action: SeatAction): (model: Model) => Model
  (model: Model, action: SeatAction): Model
} = Function.dual(2, (model: Model, action: SeatAction): Model =>
  withWorld(model, world =>
    applySeatAction(world, leadSeatOf(world).slot, action),
  ),
)

// NOTE: the same, with why nothing changed, for the cues of a refusal.
export const tryAsLead: {
  (action: SeatAction): (model: Model) => Result.Result<Model, ActionRefusal>
  (model: Model, action: SeatAction): Result.Result<Model, ActionRefusal>
} = Function.dual(
  2,
  (model: Model, action: SeatAction): Result.Result<Model, ActionRefusal> =>
    Result.map(trySeatAction(model, leadSeatOf(model).slot, action), world =>
      withWorld(model, () => world),
    ),
)
