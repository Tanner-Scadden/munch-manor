import { Schema } from 'effect'
import { Block } from 'foldkit'
import type { Html } from 'foldkit/html'

import type { KillCounts, ZombieKind } from '../../world/schema/worldSchema'
import { InMessage } from './inMessage'
import { Message, OutMessage } from './message'
import { Model } from './model'

// NOTE: what the root hands the Munchopedia's view: the kills by kind (what
// is found, its count and badges), the entries opened (a NEW tag on the
// rest), the unlocks seen (the shop guide's fridge prizes), the screen
// clock (an entry's walk), and the menu panel's Done, a function so it
// keeps sending the root's Message.
export type ViewInputs = Readonly<{
  killsByKind: KillCounts
  openedEntries: ReadonlyArray<ZombieKind>
  seenUnlocks: ReadonlyArray<string>
  screenMs: number
  doneButton: () => Html
}>

// NOTE: the Munchopedia's public contract. The root opens it in its menu
// panel and saves what it reports; it holds the shop guide
// (src/features/guide/) as its child for its Shop page.
const MunchopediaKey = Symbol('Munchopedia')
export const MunchopediaBlock = Block.make('Munchopedia', {
  key: MunchopediaKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Element', Inputs: Block.makeInputContract<ViewInputs>() },
  Model,
  Message,
  InMessage,
  OutMessage,
  inMessageOutputs: {
    RequestedOpen: { outMessage: OutMessage },
  },
})

export const { makeComposition, makeRequiredFieldBinding, makeStep } =
  MunchopediaBlock
