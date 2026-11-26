import { UiStruct } from '@effect/ui'

// NOTE: `UiStruct.evolve` over a base shape for a rule typed over every
// Model that holds it (the World's fields in single player's Model and in
// the room's World, a seat), so each caller gets its own type back. evolve
// copies the whole struct with its own keys when a field changes, so the
// subtype comes back whole; the overload says so.
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
