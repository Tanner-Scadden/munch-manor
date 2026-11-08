import { Schema } from 'effect'
import { Block } from 'foldkit'

import type { Appearance } from '../model'
import type { SavedBoughtCosmetics } from '../playerData'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { Model } from './model'
import { CoopNet } from './net'

// NOTE: what the root hands co-op's view each frame.
export type ViewInputs = Readonly<{
  look: Appearance
  isKeyboard: boolean
  isRunCardUp: boolean
  bought: SavedBoughtCosmetics
  bones: number
}>

// NOTE: co-op's public contract. Its Commands and Subscriptions are authored
// through it, so their names belong to co-op (`Coop/RequestRoom`). The
// parent's requests are its InMessages, each generating a Binding method
// (`RequestedPressKey` is `CoopBinding.requestPressKey({ code })`); those
// that may tell the parent something declare it in `inMessageOutputs`.
const CoopKey = Symbol('Coop')
export const CoopBlock = Block.make('Coop', {
  key: CoopKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  effects: { services: [CoopNet] },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedOpen: { outMessage: OutMessage },
    RequestedBoughtHero: { outMessage: OutMessage },
    RequestedPressKey: { outMessage: OutMessage },
    RequestedTickRoom: { outMessage: OutMessage },
    RequestedToggleReady: { outMessage: OutMessage },
    RequestedLeave: { outMessage: OutMessage },
  },
})

// NOTE: Commands are made through the Block itself
// (`CoopBlock.makeCommand(...)`): exported alone, makeCommand is a
// two-argument function with no pipeable form.
export const { makeComposition, makeSubscriptions } = CoopBlock
