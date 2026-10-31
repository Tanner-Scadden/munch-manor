import { makeModifyFieldsFor } from 'foldkit/struct'

import { World } from './worldSchema'

export { World }

// NOTE: the client Model holds the World's fields beside its own, so a
// step on the World hands back the client's Model with them replaced.
export const withWorld = <M extends World>(
  model: M,
  step: (world: World) => World,
): M => ({ ...model, ...step(model) })

// NOTE: a rule that changes only World fields, typed over any Model that
// holds them, so single player and the room share it and each gets its own
// type back.
export const modifyWorldFields = makeModifyFieldsFor<World>()
