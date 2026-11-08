import { Function } from 'effect'
import { makeModifyFieldsFor } from 'foldkit/struct'

import { World } from './worldSchema'

export { World }

// NOTE: the client Model holds the World's fields beside its own, so a
// step on the World hands back the client's Model with them replaced.
export const withWorld: {
  <M extends World>(step: (world: World) => World): (model: M) => M
  <M extends World>(model: M, step: (world: World) => World): M
} = Function.dual(
  2,
  <M extends World>(model: M, step: (world: World) => World): M => ({
    ...model,
    ...step(model),
  }),
)

// NOTE: a rule that changes only World fields, typed over any Model that
// holds them, so single player and the room share it and each gets its own
// type back.
const modifyWorld = makeModifyFieldsFor<World>()

type WorldTransforms = Parameters<typeof modifyWorld>[1]

export const modifyWorldFields: {
  (transforms: WorldTransforms): <M extends World>(model: M) => M
  <M extends World>(model: M, transforms: WorldTransforms): M
} = Function.dual(2, modifyWorld)
