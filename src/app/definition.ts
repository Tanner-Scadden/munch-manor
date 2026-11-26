import type { Component, Mount, View } from '@effect/ui'
import { Html } from '@effect/ui/html'

import { Message } from './message'
import { Model } from './model'

// NOTE: the root component's definition: its name and Schemas, with the HTML
// vocabulary. Steps, view fragments, and the view are typed against it, and
// `ApplicationNoDeps` in src/app/block.ts finishes it with `make`, since
// typing them against the finished component would be circular. A run
// lives in the Model and the save, not in the browser's history, so nothing
// is restored on a back navigation.
export const ApplicationDef = Html.component({
  name: 'Application',
  model: Model,
  message: Message,
  restore: false,
})

// NOTE: the root's `h` and what a view over it returns, for the features'
// views that send the root's Messages.
export type ApplicationViewBuilder = Html.H<Message>
export type ApplicationHtml = View.Content<Message>

// NOTE: a root Mount a screen or feature puts on an element it draws, handed
// in by the root's view (SHARE's, the help card's press), since nothing
// below `app/` imports a Mount of the root's.
export type ApplicationMount = Mount.Issued<
  Message | Component.Noop,
  never,
  Element,
  never
>
