import { Function } from 'effect'

// NOTE: an update function that runs only when the Model its `$` holds
// passes, and otherwise leaves it as it is, in place of a ternary with the
// bare Model in one branch (munch/no-conditional-step). Any component's
// update uses it, so it names no Model: `$` is Effect UI's update `$`, read
// here only for its Model.
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
    ($: $): Result | Model =>
      // NOTE: the one place the pattern the rule fails is written out.
      // oxlint-disable-next-line munch/no-conditional-step
      isDue($.model) ? step($) : $.model,
)
