import { Function } from 'effect'
// NOTE: a Step that runs only when the Model it is given passes, and
// otherwise leaves it as it is, in place of a ternary with `{ model }` in
// one branch (munch/no-conditional-step). Any Block's update uses it, so
// it names no Model. Inside `makeStep`, pick between Steps with
// `cond ? step : unchanged` instead.
export const stepWhen: {
  <Model, Result>(
    step: (model: Model) => Result,
  ): (
    isDue: (model: Model) => boolean,
  ) => (model: Model) => Result | Readonly<{ model: Model }>
  <Model, Result>(
    isDue: (model: Model) => boolean,
    step: (model: Model) => Result,
  ): (model: Model) => Result | Readonly<{ model: Model }>
} = Function.dual(
  2,
  <Model, Result>(
    isDue: (model: Model) => boolean,
    step: (model: Model) => Result,
  ) =>
    (model: Model): Result | Readonly<{ model: Model }> =>
      // NOTE: the one place the pattern the rule fails is written out.
      // oxlint-disable-next-line munch/no-conditional-step
      isDue(model) ? step(model) : { model },
)
