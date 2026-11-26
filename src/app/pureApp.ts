import { Function } from 'effect'

import { ApplicationNoDeps } from './block.ts'
import type { Message } from './message.ts'
import type { Model } from './model.ts'

const updateOf = (model: Model, message: Message) =>
  ApplicationNoDeps.update(model, message, {})

export const update: {
  (message: Message): (model: Model) => ReturnType<typeof updateOf>
  (model: Model, message: Message): ReturnType<typeof updateOf>
} = Function.dual(2, updateOf)

export { subscriptions } from './subscriptions.ts'

export const initialModel: Model = ApplicationNoDeps.init({}).model
