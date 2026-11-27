import { Function, type Layer } from 'effect'

import { type Component, UiStruct } from '@effect/ui'

import type { CommandsLayer } from '#app/commands.ts'
import { refreshIntent } from '#app/frame/frame.ts'
import type { Message } from '#app/message.ts'
import type { Model } from '#app/model.ts'
import { releaseAll } from '#input/input.ts'
import type { Input } from '#input/inputSchema.ts'

type AppHandlers = Layer.Success<typeof CommandsLayer>

type Tagged<Tag extends Message['_tag']> = (typeof Message.cases)[Tag]['Type']

export type App$<Cur extends Message = Message> = Component.Update<
  Model,
  Message,
  never,
  {},
  {},
  Cur
>

type AppStep = Component.Step<Model, Message, never, AppHandlers>
export type UpdateReturn = Model | AppStep

export type UpdateStep = ($: App$) => UpdateReturn

export const withInput: {
  (toNextInput: (input: Input) => Input): (model: Model) => Model
  (model: Model, toNextInput: (input: Input) => Input): Model
} = Function.dual(
  2,
  (model: Model, toNextInput: (input: Input) => Input): Model =>
    refreshIntent(UiStruct.evolve(model, { input: toNextInput })),
)

export const unchanged: UpdateStep = $ => $.model

export const modelStep =
  (change: (model: Model) => Model): UpdateStep =>
  $ =>
    change($.model)

export const releaseInput = modelStep(model => withInput(model, releaseAll))

export const toModel =
  (next: Model): UpdateStep =>
  () =>
    next

export const combine =
  (steps: ReadonlyArray<UpdateStep>): UpdateStep =>
  $ =>
    $.combine(...steps)

type Handlers = {
  readonly [Tag in Message['_tag']]?: (
    $: App$<Tagged<Tag>>,
    message: Tagged<Tag>,
  ) => UpdateReturn
}

export const defineHandlers = <const Group extends Handlers>(
  group: Group,
): Group => group
