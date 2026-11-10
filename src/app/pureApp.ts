// The game's update as a plain synchronous function, for the tools that
// replay the game (the balance bot, the determinism tools, the audit
// harness, the sprite atlas), the whole start Model the tests' named Models
// build on (`initialModel`), and the root's Subscriptions for a Scene to emit
// from. Tests drive the root through Block-aware Stories and Scenes over
// `APPLICATION` (src/test/testing.ts), never through this update
// (munch/no-plain-story).
// The app itself never imports this module: the Program takes the Block and
// its Layer (src/app/entry.ts).

import { Effect, Function } from 'effect'
import { Story } from 'foldkit'

import { layer } from './block'
import { ApplicationBlock } from './definition'
import type { Model } from './model'

// NOTE: acquiring the root's graph builds no handler Layer and starts no
// Command, Subscription, or Mount, so it needs no service and runs
// synchronously. Its init, update, and view are pure, and stay usable after
// the acquisition's scope closes.
const application = Effect.runSync(
  Story.withBlock({ block: ApplicationBlock, layer }, Function.identity),
)

export const { update, subscriptions } = application

// NOTE: the whole Model a fresh game starts with, every child's field
// included. src/app/model.ts's `initialModel` holds only the root's own fields.
export const initialModel: Model = application.init().model
