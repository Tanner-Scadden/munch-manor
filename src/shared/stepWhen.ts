import { Function } from 'effect'

export const stepWhen: {
  <Model, $ extends { readonly model: Model }, Result>(
    step: ($: $) => Result,
  ): (isDue: (model: Model) => boolean) => ($: $) => Result | Model
  <Model, $ extends { readonly model: Model }, Result>(
    isDue: (model: Model) => boolean,
    step: ($: $) => Result,
  ): ($: $) => Result | Model
} = Function.dual(
  2,
  <Model, $ extends { readonly model: Model }, Result>(
    isDue: (model: Model) => boolean,
    step: ($: $) => Result,
  ) =>
    ($: $): Result | Model => {
      const run: ($: $) => Result | Model = isDue($.model)
        ? step
        : current => current.model
      return run($)
    },
)
