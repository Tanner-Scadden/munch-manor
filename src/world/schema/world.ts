import { Function } from 'effect'

import { evolveFor } from '#shared/evolve.ts'

import { World } from './worldSchema.ts'

export { World }

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

const modifyWorld = evolveFor<World>()

type WorldTransforms = Parameters<typeof modifyWorld>[1]

export const modifyWorldFields: {
  (transforms: WorldTransforms): <M extends World>(model: M) => M
  <M extends World>(model: M, transforms: WorldTransforms): M
} = Function.dual(2, modifyWorld)
