import { Function } from 'effect'

import { ApplicationNoDeps } from './block'
import type { Message } from './message'
import type { Model } from './model'

const updateOf = (model: Model, message: Message) =>
  ApplicationNoDeps.update(model, message, {})

export const update: {
  (message: Message): (model: Model) => ReturnType<typeof updateOf>
  (model: Model, message: Message): ReturnType<typeof updateOf>
} = Function.dual(2, updateOf)

export { subscriptions } from './subscriptions'

export const initialModel: Model = ApplicationNoDeps.init({}).model
