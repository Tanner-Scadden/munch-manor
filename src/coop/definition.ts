import { Schema } from 'effect'
import { Block } from 'foldkit'

import type { Appearance } from '../model'
import type { SavedBoughtCosmetics } from '../playerData'
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
// through it, so their names belong to co-op (`Coop/RequestRoom`). Its
// operations are the parent's requests, each a local Message that runs
// through co-op's update and may tell the parent something.
const CoopKey = Symbol('Coop')
export const CoopBlock = Block.make('Coop', {
  key: CoopKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  effects: { services: [CoopNet] },
  Model,
  Message,
  OutMessage,
  operations: {
    requestOpen: { message: Message.RequestedOpen, outMessage: OutMessage },
    requestBoughtHero: {
      message: Message.RequestedBoughtHero,
      outMessage: OutMessage,
    },
    requestPressKey: {
      message: Message.RequestedPressKey,
      outMessage: OutMessage,
    },
    requestReleaseKey: {
      message: Message.RequestedReleaseKey,
      outMessage: OutMessage,
    },
    requestTickRoom: {
      message: Message.RequestedTickRoom,
      outMessage: OutMessage,
    },
    requestPressAction: {
      message: Message.RequestedPressAction,
      outMessage: OutMessage,
    },
    requestToggleReady: {
      message: Message.RequestedToggleReady,
      outMessage: OutMessage,
    },
    requestLeave: { message: Message.RequestedLeave, outMessage: OutMessage },
    requestKeepTracers: {
      message: Message.RequestedKeepTracers,
      outMessage: OutMessage,
    },
  },
})

// NOTE: Commands are made through the Block itself
// (`CoopBlock.makeCommand(...)`): exported alone, makeCommand is a
// two-argument function with no pipeable form.
export const { makeComposition, makeSubscriptions } = CoopBlock
