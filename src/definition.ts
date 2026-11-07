import { Block } from 'foldkit'

import { Message } from './message'
import { Model } from './model'

// NOTE: the root's contract. Commands, Subscriptions, the audio resource,
// Steps, and Bindings are authored through it, so their names and Message
// types belong to the application (see "Blocks and Bindings" in AGENTS.md).
export const ApplicationDefinition = Block.makeDefinition('Application', {
  Model,
  Message,
})

// NOTE: a Command and an OutMessage fold are made through the definition
// itself (`ApplicationDefinition.makeCommand(...)`): exported alone, each is a
// two-argument function with no pipeable form.
export const {
  makeBinding,
  makeComposition,
  makeManagedResources,
  makeNoopStep,
  makeResource,
  makeStep,
  makeSubscriptions,
} = ApplicationDefinition
