// The game's init, update, and view as plain synchronous functions, for the
// tools that replay the game (the balance bot, the determinism tools, the
// audit harness, the sprite atlas) and the tests' named Models
// (`initialModel`). Tests drive the root through Block-aware Stories and
// Scenes over `APPLICATION` (src/test/testing.ts), not through this update.
// The app itself never imports this module: the Program takes the Block and
// its Layer (src/app/entry.ts).

import { Effect, Function } from 'effect'
import { Story } from 'foldkit'
import { toParentMessageFor } from 'foldkit/test'

import { ShopDialogBinding } from './bindings'
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

export const { init, update, view, subscriptions } = application

// NOTE: the whole Model a fresh game starts with, every child's field
// included. src/app/model.ts's `initialModel` holds only the root's own fields.
export const initialModel: Model = init().model

// NOTE: for the tools that play the game without a Story (the balance bot
// buys at Rattles' counter and closes his dialog): `inRoot` makes a child's
// Message the root's generated envelope,
// `Envelope.inRoot(ShopDialogBinding, message)`, and `inShop` one of the
// shop dialog's own children's the shop's,
// `Envelope.inShop(DialogBinding, message)`. A record, since the mappers
// are generic and cannot be made dual. Tests never build an envelope: a
// Story delivers a child's Message with `Story.messageIn(Binding, ...)`, a
// grandchild's by its Binding path (AGENTS.md "Tests drive the root
// through Block-aware Stories and Scenes").
export const Envelope = {
  inRoot: toParentMessageFor(application),
  inShop: toParentMessageFor(application, ShopDialogBinding),
}
