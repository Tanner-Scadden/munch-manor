import { UiStruct } from '@effect/ui'

export const evolveFor = <Base extends object>() => {
  function evolveSubtype<M extends Base>(
    model: M,
    fields: UiStruct.EvolveFields<Base>,
  ): M
  function evolveSubtype(
    model: Base,
    fields: UiStruct.EvolveFields<Base>,
  ): Base {
    return UiStruct.evolve(model, fields)
  }
  return evolveSubtype
}
