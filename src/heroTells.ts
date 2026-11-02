import { Array, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import {
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
  PLAYER_FOOT_OFFSET,
} from './constants'
import { vectorLength } from './geometry'
import type { Model, Particle, TellWatch } from './model'
import {
  angleOf,
  chain,
  coin,
  dustPuff,
  playerGround,
  smokePuff,
  spark,
  sparks,
} from './particleBursts'
import { keepNewest } from './particles'
import { isCoop, isStanding, playersOf } from './party'
import type { SeatedPlayer } from './party'
import { type Calling } from './playerData'
import { type Seeded, generateMany, nextRandom } from './prng'
import { isNearStall } from './shop'
import { trapCenter } from './traps'
import { heldWeapon } from './weapons'
import { GameEvent, type Vector } from './worldSchema'

// What each hero shows the whole crew while it plays (decided with the owner
// on 2026-11-01, see "Heroes" in GAME_DESIGN.md): the Track Star kicks up
// dust as he runs, the Handyman throws sparks off a trap he mends (with a
// tink), the Line Cook lets off steam while he holds the Pressure Cooker, and
// the Penny Pincher glints a coin when a kill pays him. YOU shows nothing.
//
// All of it is cosmetic. It reads the World each seat already has (position
// and intent, the held gun, the traps' health, the money earned) and the
// frame's events, and spends only the client's own cosmetic stream, so the
// room's World, its wire, and the game's determinism are untouched, and a
// teammate's tells come from their seat like their other particles do. What
// changed since the last frame is read against `tellWatch`.

const RUN_PUFFS_PER_SECOND = 8
const STEAM_WISPS_PER_SECOND = 1.6
const REPAIR_SPARKS = 6
const GLINT_SPARKS = 2
const GLINT_HEIGHT_PX = 16
const MS_PER_SECOND = 1000

type Spawn = Seeded<ReadonlyArray<Particle>>

// NOTE: a draw that comes up once in a while: about `perSecond` times a
// second over a run of frames, with no clock of its own.
const isDrawn = (
  state: number,
  perSecond: number,
  deltaMs: number,
): readonly [state: number, isHit: boolean] => {
  const draw = nextRandom(state)
  return [draw.nextState, draw.value < (perSecond * deltaMs) / MS_PER_SECOND]
}

const runDust =
  ({ player, intent }: SeatedPlayer, deltaMs: number) =>
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
  ({ player }: SeatedPlayer, deltaMs: number) =>
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
  ({ player }: SeatedPlayer) =>
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

// WHAT CHANGED

// NOTE: where traps were mended since the last frame, if a Handyman stood at
// the counter to do it (he mends for free; the room says nothing about who
// bought, so a crew with a Handyman at the stall takes the credit).
export const mendedSpots = (
  model: Model,
  watch: TellWatch,
): ReadonlyArray<Vector> => {
  const isHandymanAtStall = Array.some(
    playersOf(model),
    ({ player, seat }) =>
      player.calling === 'Handyman' && isStanding(seat) && isNearStall(player),
  )
  if (!isHandymanAtStall) {
    return []
  }
  const level = levelOf(model)
  return pipe(
    model.traps,
    Array.filter(trap =>
      Array.some(watch.traps, seen => seen.id === trap.id && seen.hp < trap.hp),
    ),
    Array.map(trap => trapCenter(level, trap)),
  )
}

const isKillPaid = (model: Model, { slot, wallet }: SeatedPlayer): boolean =>
  Array.some(model.frameEvents, GameEvent.isAnyOf(['ZombieKilled'])) &&
  Array.some(
    model.tellWatch.earned,
    seen => seen.slot === slot && seen.earned < wallet.earned,
  )

const watchOf = (model: Model): TellWatch => ({
  traps: Array.map(model.traps, ({ id, hp }) => ({ id, hp })),
  earned: Array.map(playersOf(model), ({ slot, wallet }) => ({
    slot,
    earned: wallet.earned,
  })),
})

// FRAME

type Batch = (state: number) => Spawn

type Tell = (
  model: Model,
  seat: SeatedPlayer,
  deltaMs: number,
) => ReadonlyArray<Batch>

// NOTE: each hero's tell for a seat on its feet, a record over the heroes so
// a new one fails typecheck until it says what it shows (YOU: nothing).
const TELLS: Readonly<Record<Calling, Tell>> = {
  You: () => [],
  Handyman: () => [],
  TrackStar: (_model, seat, deltaMs) => [runDust(seat, deltaMs)],
  PennyPincher: (model, seat) => (isKillPaid(model, seat) ? [glint(seat)] : []),
  LineCook: (_model, seat, deltaMs) => [steam(seat, deltaMs)],
}

// NOTE: the frame's tells, after its ticks: each seat's by its hero, the
// repairs, then what the frame saw of the World kept to be read against
// next time. It runs on frames with no tick too, so a repair made between
// frames shows once and is not seen again.
export const advanceTells = (model: Model, worldMs: number): Model =>
  isPlainCrew(model) ? model : tellsAfter(model, worldMs)

// NOTE: a run of only YOU has no tell, and nothing to watch, so most runs
// pay nothing here each frame.
const isPlainCrew = (model: Model): boolean =>
  isCoop(model)
    ? Array.every(playersOf(model), ({ player }) => player.calling === 'You')
    : model.player.calling === 'You'

const tellsAfter = (model: Model, worldMs: number): Model => {
  const batches = [
    ...Array.flatMap(playersOf(model), seat =>
      isStanding(seat.seat)
        ? TELLS[seat.player.calling](model, seat, worldMs)
        : [],
    ),
    ...Array.map(mendedSpots(model, model.tellWatch), spot =>
      sparks(spot, REPAIR_SPARKS),
    ),
  ]
  const [cosmeticRngState, particles] = chain(model.cosmeticRngState, batches)
  return modifyFields(model, {
    particles: current =>
      Array.isReadonlyArrayEmpty(particles)
        ? current
        : keepNewest([...current, ...particles], PARTICLE_MAX),
    cosmeticRngState: () => cosmeticRngState,
    tellWatch: () => watchOf(model),
  })
}
