// Co-op's update and view as plain synchronous functions, for the
// co-op tests' named Models and Steps, as src/app/pureApp.ts is for the root.
// The app never imports this module: the root's Layer provides co-op's.

import { Effect, Function } from 'effect'
import { Story } from 'foldkit'

import { CoopBlock } from './block'
import { CoopLayer } from './layer'

// NOTE: acquiring co-op's graph alone builds no handler Layer and starts
// nothing, so it runs synchronously, and its pure functions stay usable
// after the acquisition's scope closes.
const coop = Effect.runSync(
  Story.withBlock({ block: CoopBlock, layer: CoopLayer }, Function.identity),
)

export const { update, view } = coop

// NOTE: co-op's whole start Model, its hero picker's field included.
export const initialModel = coop.init().model
