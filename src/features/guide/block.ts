import { Schema } from 'effect'
import { Block } from 'foldkit'
import type { Html } from 'foldkit/html'

import { InMessage } from './inMessage'
import { Message } from './message'
import { GuidePlacement, Model } from './model'

// NOTE: what a parent hands the guide's view: the unlocks seen (a fridge
// prize is ??? until it is pulled), and the buttons that stand after BACK
// in the actions row (the Munchopedia panel's Done; none in the shop). A
// function, so the parent's buttons keep sending the parent's Messages.
export type ViewInputs = Readonly<{
  seenUnlocks: ReadonlyArray<string>
  trailingActions: () => ReadonlyArray<Html>
}>

// NOTE: the shop guide's public contract, bound twice: in Rattles' shop
// dialog (the shop's GuideBinding, src/features/shop/bindings.ts) and on the
// Munchopedia's Shop page (src/features/munchopedia/bindings.ts). Its
// parent opens and closes it; it turns its sections, goes back, and moves
// focus on its own.
const GuideKey = Symbol('Guide')
export const GuideBlock = Block.make('Guide', {
  key: GuideKey,
  InitArgs: Schema.Tuple([GuidePlacement]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
})

export const { makeComposition } = GuideBlock
