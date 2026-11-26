import { Function } from 'effect'

import { evolveFor } from '../../shared/evolve'
import { World } from './worldSchema'

export { World }

// NOTE: the World's own fields of a Model that holds them, as a World of
// its own. The client Model is far wider (over 160 fields), and engines copy
// an object past 128 fields some twenty times slower (V8 and
// JavaScriptCore alike), so a step that changed the Model itself paid that
// width on every one of its copies. A step on this World copies only its
// fields. One literal, in World's field order, so every World it makes has
// the same shape.
export const worldOf = <M extends World>(model: M): World => ({
  phase: model.phase,
  pacing: model.pacing,
  boss: model.boss,
  frenzyPacks: model.frenzyPacks,
  intensity: model.intensity,
  mode: model.mode,
  difficulty: model.difficulty,
  modifiers: model.modifiers,
  easyBreakSeconds: model.easyBreakSeconds,
  dareMark: model.dareMark,
  zombies: model.zombies,
  bullets: model.bullets,
  lobs: model.lobs,
  nextEntityId: model.nextEntityId,
  elapsedMs: model.elapsedMs,
  frameEvents: model.frameEvents,
  traps: model.traps,
  pickups: model.pickups,
  loot: model.loot,
  level: model.level,
  ovens: model.ovens,
  fridge: model.fridge,
  pantry: model.pantry,
  crates: model.crates,
  keys: model.keys,
  stove: model.stove,
  dare: model.dare,
  dareThings: model.dareThings,
  gasValve: model.gasValve,
  stations: model.stations,
  cases: model.cases,
  rngState: model.rngState,
  hitStop: model.hitStop,
  lessons: model.lessons,
  practice: model.practice,
  debutCard: model.debutCard,
  stats: model.stats,
  party: model.party,
  seats: model.seats,
})

// NOTE: the client Model holds the World's fields beside its own, so a
// step on the World hands back the client's Model with them replaced. The
// step runs on the World alone (worldOf), and its result goes back into the
// Model in one copy.
export const withWorld: {
  <M extends World>(step: (world: World) => World): (model: M) => M
  <M extends World>(model: M, step: (world: World) => World): M
} = Function.dual(
  2,
  <M extends World>(model: M, step: (world: World) => World): M => ({
    ...model,
    ...step(worldOf(model)),
  }),
)

// NOTE: a rule that changes only World fields, typed over any Model that
// holds them, so single player and the room share it and each gets its own
// type back.
const modifyWorld = evolveFor<World>()

type WorldTransforms = Parameters<typeof modifyWorld>[1]

export const modifyWorldFields: {
  (transforms: WorldTransforms): <M extends World>(model: M) => M
  <M extends World>(model: M, transforms: WorldTransforms): M
} = Function.dual(2, modifyWorld)
