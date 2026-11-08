import { type Option, Schema } from 'effect'
import { Block } from 'foldkit'

import type { SavedSeenUnlocks } from '../../shared/playerData'
import type {
  ShopChatter,
  TrapHint,
  World,
} from '../../world/schema/worldSchema'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { Model } from './model'

// NOTE: what the shop draws, all of it the root's: the World (the focused
// seat's wallet, guns, traps, and shop, the level, the run's stats),
// Rattles' chatter, the trap hint, and the unlocks seen (a fridge prize in
// the guide is ??? until it is pulled).
export type ShopScene = World &
  Readonly<{
    shopChatter: ShopChatter
    trapHint: TrapHint
    seenUnlocks: SavedSeenUnlocks
  }>

// NOTE: the scene is a function, so Foldkit never walks the whole World as
// data on each frame (it checks a data view input for nested functions),
// and the view reads it only while the dialog shows. None while the shop
// is shut (`isShopShut`): the root then draws it from a cache, which a
// scene of the frame would miss.
export type ViewInputs = Readonly<{
  scene: () => Option.Option<ShopScene>
}>

// NOTE: the shop dialog's public contract. The root opens and closes it as
// the World's shop says, hands it the keys at the counter, and answers a
// row picked, focused, or a tab chosen by changing the World; a close goes
// up as Closed for the root to judge. Opening and closing are its Dialog's
// own operations, answered through the Dialog's fold, so both declare the
// OutMessage.
const ShopKey = Symbol('Shop')
export const ShopBlock = Block.make('Shop', {
  key: ShopKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedOpen: { outMessage: OutMessage },
    RequestedClose: { outMessage: OutMessage },
  },
})

// NOTE: Commands and OutMessage folds are made through the Block itself
// (`ShopBlock.makeCommand(...)`): exported alone, each is a two-argument
// function with no pipeable form.
export const {
  makeComposition,
  makeNoopStep,
  makeOutMessageStep,
  makeRequiredFieldBinding,
  makeStep,
} = ShopBlock
