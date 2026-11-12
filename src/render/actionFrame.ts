import { Array, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import {
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
} from '../shared/constants'
import { generateMany } from '../shared/prng'
import { seatStateAt } from '../world/party/party'
import { freshBeats, nextActionWatch, strikesBetween } from './actionPose'
import {
  chain,
  dustPuff,
  playerGround,
  woodBits,
} from './particles/particleBursts'
import { keepNewest } from './particles/particles'

// The hands-on actions' frame (src/render/actionPose.ts): the watch read
// on to the next frame, a puff of dust where a trap was just set down, and
// splinters off a board each time a hammer lands. Only the client's
// cosmetic stream is spent, so the World and its wire never see any of it.

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

// NOTE: after the frame's ticks: the payoffs that began and the blows that
// landed against what the watch saw last frame, their dust and splinters,
// then the new watch. A frame with no tick changes nothing but the watch.
export const advanceActions = (model: Model): Model => {
  const actionWatch = nextActionWatch(model, model.actionWatch)
  const after = modifyFields(model, { actionWatch: () => actionWatch })
  const batches: ReadonlyArray<Batch> = [
    ...pipe(
      freshBeats(model.actionWatch, actionWatch),
      Array.filter(({ payoff }) => payoff === 'SetTrap'),
      Array.map(({ slot }) => setDust(model, slot)),
    ),
    ...pipe(
      strikesBetween(model.actionWatch, actionWatch),
      Array.filter(({ motion }) => motion === 'Hammer'),
      Array.map(({ x, y }) => woodBits('Splinter', { x, y }, HAMMER_SPLINTERS)),
    ),
  ]
  if (Array.isReadonlyArrayEmpty(batches)) {
    return after
  }
  const [cosmeticRngState, particles] = chain(model.cosmeticRngState, batches)
  return modifyFields(after, {
    cosmeticRngState: () => cosmeticRngState,
    particles: current => keepNewest([...current, ...particles], PARTICLE_MAX),
  })
}
