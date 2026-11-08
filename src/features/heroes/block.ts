import { Schema } from 'effect'
import { Block } from 'foldkit'

import type {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { Model } from './model'

// NOTE: where the picker stands. `Panel` is inside the solo lobby's Dialog,
// which draws the title; `Overlay` is over co-op's lobby, with its own head.
type PickerLayout = 'Panel' | 'Overlay'

// NOTE: what a parent hands the picker's view: the look its cards wear, the
// hero worn, the rank and the heroes bought (each card's standing), the
// Bones (the balance and BUY), the unlocks that wear a NEW badge, and where
// it stands.
export type ViewInputs = Readonly<{
  look: Appearance
  chosen: Calling
  rank: number
  bought: SavedBoughtCosmetics
  bones: number
  fresh: ReadonlyArray<string>
  layout: PickerLayout
}>

// NOTE: the hero picker's public contract, bound twice: in the solo lobby
// (src/features/lobby/composition.ts) and in co-op's lobby
// (src/features/coop/bindings.ts). Its parent opens and closes it and
// answers its taps through the InMessages; only a key that closes it tells
// the parent.
const HeroPickerKey = Symbol('HeroPicker')
export const HeroPickerBlock = Block.make('HeroPicker', {
  key: HeroPickerKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedPressKey: { outMessage: OutMessage },
  },
})

export const { makeComposition } = HeroPickerBlock
