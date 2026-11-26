import { Function, Schema } from 'effect'

import type { Model } from '../../src/app/model'
import type { Player } from '../../src/world/schema/worldSchema'

type Lead = Readonly<{ player: Player }>

const isRootLead = (model: object): model is Lead =>
  'player' in model && 'shop' in model

export const leadOf = (model: Model): Lead =>
  isRootLead(model) ? model : model.seats[0]

const AtCounter = Schema.Struct({
  shop: Schema.TaggedStruct('Browsing', {}),
})

export const isLeadAtCounter = (model: Model): boolean =>
  Schema.is(AtCounter)(leadOf(model))

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
