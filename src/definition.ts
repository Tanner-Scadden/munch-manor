import { Schema } from 'effect'
import { Block } from 'foldkit'

import { CoopNet } from './coop/net'
import { InstallPrompt } from './install'
import { Message } from './message'
import { Model } from './model'
import { PlayerStore } from './store'

// NOTE: the root's public contract. Commands, Subscriptions, the audio
// resource, Steps, and Bindings are authored through it, so their names and
// Message types belong to the application (see "Blocks and Bindings" in
// AGENTS.md). Its implementation Layer is `layer` in src/block.ts.
const ApplicationKey = Symbol('Application')
export const ApplicationBlock = Block.make('Application', {
  key: ApplicationKey,
  InitArgs: Schema.Tuple([]),
  view: { kind: 'Document' },
  effects: { services: [PlayerStore, InstallPrompt, CoopNet] },
  Model,
  Message,
})

// NOTE: a Command and an OutMessage fold are made through the Block itself
// (`ApplicationBlock.makeCommand(...)`): exported alone, each is a
// two-argument function with no pipeable form.
export const {
  makeComposition,
  makeManagedResources,
  makeNoopStep,
  makeRequiredFieldBinding,
  makeResource,
  makeStep,
  makeSubscriptions,
} = ApplicationBlock
