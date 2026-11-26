import { Array, Function, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
  PLAYER_FOOT_OFFSET,
} from '#shared/constants.ts'
import type { Calling } from '#shared/playerData.ts'
import { type Seeded, generateMany, nextRandom } from '#shared/prng.ts'
import { maybeMendingTrap, trapCenter } from '#world/gear/traps.ts'
import { heldWeapon } from '#world/gear/weapons.ts'
import { levelOf } from '#world/level/arena.ts'
import { focusOf, isCoop, isStanding, playersOf } from '#world/party/party.ts'
import { type SeatState, type Vector } from '#world/schema/worldSchema.ts'
import { vectorLength } from '#world/step/geometry.ts'

import {
  angleOf,
  chain,
  coin,
  dustPuff,
  playerGround,
  smokePuff,
  spark,
  sparks,
} from './particles/particleBursts.ts'
import { keepNewest } from './particles/particles.ts'
import type { Particle, TellWatch } from './renderSchema.ts'

const RUN_PUFFS_PER_SECOND = 8
const STEAM_WISPS_PER_SECOND = 1.6
const REPAIR_SPARKS = 6
const GLINT_SPARKS = 2
const GLINT_HEIGHT_PX = 16
const MS_PER_SECOND = 1000

type Spawn = Seeded<ReadonlyArray<Particle>>

const isDrawn = (
  state: number,
  perSecond: number,
  deltaMs: number,
): readonly [state: number, isHit: boolean] => {
  const draw = nextRandom(state)
  return [draw.nextState, draw.value < (perSecond * deltaMs) / MS_PER_SECOND]
}

const runDust =
  ({ player, intent }: SeatState, deltaMs: number) =>
  (state: number): Spawn => {
    const [next, isPuff] = isDrawn(state, RUN_PUFFS_PER_SECOND, deltaMs)
    return isPuff && vectorLength(intent.move) > 0
      ? generateMany(
          next,
          1,
          dustPuff(
            playerGround(player.x, player.y),
            angleOf(intent.move) + Math.PI,
            Math.PI / 2,
            DUST_SPEED_MIN,
          )(DUST_SPEED_MAX),
        )
      : [next, []]
  }

const steam =
  ({ player }: SeatState, deltaMs: number) =>
  (state: number): Spawn => {
    const [next, isWisp] = isDrawn(state, STEAM_WISPS_PER_SECOND, deltaMs)
    return isWisp &&
      player.wield === 'Gun' &&
      heldWeapon(player.arsenal) === 'Cooker'
      ? generateMany(
          next,
          1,
          smokePuff({
            x: player.x + player.facing.x * 6,
            y: player.y + PLAYER_FOOT_OFFSET,
          }),
        )
      : [next, []]
  }

const glint =
  ({ player }: SeatState) =>
  (state: number): Spawn =>
    chain(state, [
      drawState =>
        generateMany(drawState, 1, coin(playerGround(player.x, player.y))),
      drawState =>
        generateMany(
          drawState,
          GLINT_SPARKS,
          spark(playerGround(player.x, player.y), GLINT_HEIGHT_PX),
        ),
    ])

const MEND_MARKS = 3

const markOf = (hp: number, maxHp: number): number =>
  Math.floor((MEND_MARKS * hp) / maxHp)

export const mendedSpots: {
  (watch: TellWatch): (model: Model) => ReadonlyArray<Vector>
  (model: Model, watch: TellWatch): ReadonlyArray<Vector>
} = Function.dual(
  2,
  (model: Model, watch: TellWatch): ReadonlyArray<Vector> => {
    const mending = pipe(
      playersOf(model),
      Array.filter(({ player }) => player.calling === 'Handyman'),
      Array.map(({ seat }) => maybeMendingTrap(model, seat.slot)),
      Array.getSomes,
    )
    if (Array.isReadonlyArrayEmpty(mending)) {
      return []
    }
    const seenById = new Map<number, Array<TellWatch['traps'][number]>>()
    for (const seen of watch.traps) {
      const same = seenById.get(seen.id)
      if (same === undefined) {
        seenById.set(seen.id, [seen])
      } else {
        same.push(seen)
      }
    }
    const level = levelOf(model)
    return pipe(
      mending,
      Array.filter(trap =>
        Array.some(
          seenById.get(trap.id) ?? [],
          seen => markOf(seen.hp, trap.maxHp) < markOf(trap.hp, trap.maxHp),
        ),
      ),
      Array.dedupeWith((first, second) => first.id === second.id),
      Array.map(trap => trapCenter(level, trap)),
    )
  },
)

const isKeyFound = (model: Model, { seat }: SeatState): boolean =>
  Array.some(
    model.cosmetics.tellWatch.keysFound,
    seen => seen.slot === seat.slot && seen.keysFound < seat.keysFound,
  )

const watchOf = (model: Model): TellWatch => ({
  traps: Array.map(model.traps, ({ id, hp }) => ({ id, hp })),
  keysFound: Array.map(playersOf(model), ({ seat }) => ({
    slot: seat.slot,
    keysFound: seat.keysFound,
  })),
})

type Batch = (state: number) => Spawn

type Tell = (
  model: Model,
  seat: SeatState,
  deltaMs: number,
) => ReadonlyArray<Batch>

const TELLS: Readonly<Record<Calling, Tell>> = {
  You: () => [],
  Handyman: () => [],
  TrackStar: (_model, seat, deltaMs) => [runDust(seat, deltaMs)],
  PennyPincher: (model, seat) => (isKeyFound(model, seat) ? [glint(seat)] : []),
  LineCook: (_model, seat, deltaMs) => [steam(seat, deltaMs)],
}

export const advanceTells: {
  (worldMs: number): (model: Model) => Model
  (model: Model, worldMs: number): Model
} = Function.dual(2, (model: Model, worldMs: number): Model =>
  isPlainCrew(model) ? model : tellsAfter(model, worldMs),
)

const isPlainCrew = (model: Model): boolean =>
  isCoop(model)
    ? Array.every(playersOf(model), ({ player }) => player.calling === 'You')
    : focusOf(model).player.calling === 'You'

const tellsAfter = (model: Model, worldMs: number): Model => {
  const batches = [
    ...Array.flatMap(playersOf(model), seat =>
      isStanding(seat.seat)
        ? TELLS[seat.player.calling](model, seat, worldMs)
        : [],
    ),
    ...Array.map(mendedSpots(model, model.cosmetics.tellWatch), spot =>
      sparks(spot, REPAIR_SPARKS),
    ),
  ]
  const [cosmeticRngState, particles] = chain(
    model.cosmetics.cosmeticRngState,
    batches,
  )
  return UiStruct.evolve(model, {
    cosmetics: UiStruct.evolve({
      particles: current =>
        Array.isReadonlyArrayEmpty(particles)
          ? current
          : keepNewest([...current, ...particles], PARTICLE_MAX),
      cosmeticRngState: () => cosmeticRngState,
      tellWatch: () => watchOf(model),
    }),
  })
}
