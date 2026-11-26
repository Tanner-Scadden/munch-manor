import { Array, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  chain,
  dustPuff,
  playerGround,
  woodBits,
} from '#render/particles/particleBursts.ts'
import { keepNewest } from '#render/particles/particles.ts'
import {
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
} from '#shared/constants.ts'
import { generateMany } from '#shared/prng.ts'
import { seatStateAt } from '#world/party/party.ts'

import { freshBeats, nextActionWatch, strikesBetween } from './actionPose.ts'

const SET_DUST_PUFFS = 5
const HAMMER_SPLINTERS = 2

type Batch = Parameters<typeof chain>[1][number]

const setDust = (model: Model, slot: number): Batch => {
  const { player } = seatStateAt(model, slot)
  return state =>
    generateMany(
      state,
      SET_DUST_PUFFS,
      dustPuff(
        playerGround(player.x, player.y),
        -Math.PI / 2,
        Math.PI * 2,
        DUST_SPEED_MIN,
      )(DUST_SPEED_MAX),
    )
}

export const advanceActions = (model: Model): Model => {
  const actionWatch = nextActionWatch(model, model.cosmetics.actionWatch)
  const batches: ReadonlyArray<Batch> = [
    ...pipe(
      freshBeats(model.cosmetics.actionWatch, actionWatch),
      Array.filter(({ payoff }) => payoff === 'SetTrap'),
      Array.map(({ slot }) => setDust(model, slot)),
    ),
    ...pipe(
      strikesBetween(model.cosmetics.actionWatch, actionWatch),
      Array.filter(({ motion }) => motion === 'Hammer'),
      Array.map(({ x, y }) => woodBits('Splinter', { x, y }, HAMMER_SPLINTERS)),
    ),
  ]
  if (Array.isReadonlyArrayEmpty(batches)) {
    return UiStruct.evolve(model, {
      cosmetics: UiStruct.evolve({ actionWatch: () => actionWatch }),
    })
  }
  const [cosmeticRngState, particles] = chain(
    model.cosmetics.cosmeticRngState,
    batches,
  )
  return UiStruct.evolve(model, {
    cosmetics: UiStruct.evolve({
      actionWatch: () => actionWatch,
      cosmeticRngState: () => cosmeticRngState,
      particles: current =>
        keepNewest([...current, ...particles], PARTICLE_MAX),
    }),
  })
}
