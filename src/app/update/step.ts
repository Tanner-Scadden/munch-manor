import { Function, type Layer } from 'effect'

import { type Component, UiStruct } from '@effect/ui'

import { releaseAll } from '../../input/input'
import type { Input } from '../../input/inputSchema'
import { refreshIntent } from '../frame'
import type { CommandsLayer } from '../layer'
import type { Message } from '../message'
import type { Model } from '../model'

// NOTE: the Command services the root's Steps may run, read off the Layer
// that supplies them, so a Step can run any root Command and the root
// requires exactly them.
type AppHandlers = Layer.Success<typeof CommandsLayer>

type Tagged<Tag extends Message['_tag']> = (typeof Message.cases)[Tag]['Type']

// NOTE: `$` in the root's update: a Step holding the current Model, as
// Effect UI's `update` hands it. `Cur` is the Message being handled.
export type App$<Cur extends Message = Message> = Component.Update<
  Model,
  Message,
  never,
  {},
  {},
  Cur
>

// NOTE: what a root Step returns: the next Model alone, or a Step with the
// Commands it runs.
type AppStep = Component.Step<Model, Message, never, AppHandlers>
export type UpdateReturn = Model | AppStep

// NOTE: a root Step: an update function over any Message, so `$.combine`
// in any handler can run it (Effect UI, "Building a component").
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

// NOTE: a Step that only changes the Model, from a plain Model function.
export const modelStep =
  (change: (model: Model) => Model): UpdateStep =>
  $ =>
    change($.model)

// NOTE: lets go of every key, button, and stick, as a menu opens over play.
export const releaseInput = modelStep(model => withInput(model, releaseAll))

// NOTE: a Step that puts in a Model already built from the one it was
// handed, so the Steps after it in a `$.combine` start from it.
export const toModel =
  (next: Model): UpdateStep =>
  () =>
    next

// NOTE: Steps run one after another, each from the Model the one before
// returned, as `$.combine` runs them.
export const combine =
  (steps: ReadonlyArray<UpdateStep>): UpdateStep =>
  $ =>
    $.combine(...steps)

// NOTE: a group of the root's handlers, authored beside the Steps it calls
// and spread into the one exhaustive record in src/app/main.ts. Each
// handler's `$` and Message are typed by its tag, as they would be inline.
type Handlers = {
  readonly [Tag in Message['_tag']]?: (
    $: App$<Tagged<Tag>>,
    message: Tagged<Tag>,
  ) => UpdateReturn
}

export const defineHandlers = <const Group extends Handlers>(
  group: Group,
): Group => group
