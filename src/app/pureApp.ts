// The game's init, update, and view as plain synchronous functions, for the
// tests' named Models and Steps and for the tools that replay the game (the
// balance bot, the determinism tools, the audit harness, the sprite atlas).
// The app itself never imports this module: the Program takes the Block and
// its Layer (src/app/entry.ts).

import { Effect, Function } from 'effect'
import { Story } from 'foldkit'
import type { BlockOfBinding } from 'foldkit/block'
import { toParentMessageFor } from 'foldkit/test'

import type { CharacterBlock } from '../features/profile/blocks/look/block'
import { CharacterBinding } from '../features/profile/composition'
import { ProfileBinding } from './bindings'
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

const message = toParentMessageFor(application)
const inProfile = toParentMessageFor(application, ProfileBinding)

type ProfileMessage = BlockOfBinding<typeof ProfileBinding>['Message']['Type']
type CharacterMessage = typeof CharacterBlock.Message.Type

const profile = (profileMessage: ProfileMessage) =>
  message(ProfileBinding, profileMessage)

// NOTE: a child's Message as the root's generated envelope
// (`GotCoopMessage`, `GotShopDialogMessage`, ...), for `Story.message`,
// `update`, and the tools:
// `Child.message(CoopBinding, CoopMessage.ClickedReady())`. A record, since
// the mapper is generic and cannot be made dual. `profile` delivers a
// Profile Message, `inProfile` maps one of its children's (the tabs, the
// Look tab) to the Profile's, and `character` delivers a Look tab Message.
// A Look tab radio group's Message is a grandchild's grandchild: a
// Block-aware Story delivers it with `Story.messageIn([ProfileBinding,
// CharacterBinding, BodyBinding], ...)`.
export const Child = {
  message,
  profile,
  inProfile,
  character: (characterMessage: CharacterMessage) =>
    profile(inProfile(CharacterBinding, characterMessage)),
}
