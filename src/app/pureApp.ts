// The game's update as a plain synchronous function, for the tools that
// replay the game (the balance bot, the determinism tools, the audit
// harness, the sprite atlas), the whole start Model the tests' named Models
// build on (`initialModel`), and the root's Subscriptions. Tests drive the
// root through Stories and Scenes over the root component, never through
// this update (munch/no-plain-story).
// The app itself never imports this module: the page mounts the component
// (src/app/entry.ts).

import { Function } from 'effect'

import { ApplicationNoDeps } from './block'
import type { Message } from './message'
import type { Model } from './model'

// NOTE: Effect UI's component carries its update as a plain function of the
// Model and a Message: it runs no Command, Subscription, or Mount, and hands
// back the next Model with the Commands it issued (`.model`, `.commands`),
// so a tool reads `update(model, message).model` as it did.
const updateOf = (model: Model, message: Message) =>
  ApplicationNoDeps.update(model, message, {})

export const update: {
  (message: Message): (model: Model) => ReturnType<typeof updateOf>
  (model: Model, message: Message): ReturnType<typeof updateOf>
} = Function.dual(2, updateOf)

export { subscriptions } from './subscriptions'

// NOTE: the whole Model a fresh game starts with, as init leaves it.
export const initialModel: Model = ApplicationNoDeps.init({}).model
