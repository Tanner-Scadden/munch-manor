import type { Component, Mount, View } from '@effect/ui'
import { Html } from '@effect/ui/html'

import { Message } from './message.ts'
import { Model } from './model.ts'

export const ApplicationDef = Html.component({
  name: 'Application',
  model: Model,
  message: Message,
  restore: false,
})

export type ApplicationViewBuilder = Html.H<Message>
export type ApplicationHtml = View.Content<Message>

export type ApplicationMount = Mount.Issued<
  Message | Component.Noop,
  never,
  Element,
  never
>
