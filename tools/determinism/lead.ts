// The seat a scripted run is about, read off a Model of either shape: the
// player fields at the Model's root (before seats by slot) or the first of
// its `seats`. before and after (beforeAfter.ts) copies this harness over the
// base commit, which has the old shape, so it imports nothing from `src` at
// run time and tells the two apart by what the Model holds.

import { Function, Schema } from 'effect'

import type { Model } from '../../src/app/model'
import type { Player } from '../../src/world/schema/worldSchema'

type Lead = Readonly<{ player: Player }>

const isRootLead = (model: object): model is Lead =>
  'player' in model && 'shop' in model

export const leadOf = (model: Model): Lead =>
  isRootLead(model) ? model : model.seats[0]

// NOTE: the lead at Rattles' counter, in a base commit from before the shop
// went (docs/ESCAPE_PLAN.md, layer 7); never, after it.
const AtCounter = Schema.Struct({
  shop: Schema.TaggedStruct('Browsing', {}),
})

export const isLeadAtCounter = (model: Model): boolean =>
  Schema.is(AtCounter)(leadOf(model))

// NOTE: the Model with its lead player changed.
export const withLeadPlayer: {
  (change: (player: Player) => Player): (model: Model) => Model
  (model: Model, change: (player: Player) => Player): Model
} = Function.dual(
  2,
  (model: Model, change: (player: Player) => Player): Model => {
    if (isRootLead(model)) {
      const moved: Model & Lead = { ...model, player: change(model.player) }
      return moved
    }
    return {
      ...model,
      seats: [
        { ...model.seats[0], player: change(model.seats[0].player) },
        ...model.seats.slice(1),
      ],
    }
  },
)
