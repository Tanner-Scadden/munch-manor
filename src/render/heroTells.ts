import { Array, Function, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../app/model'
import {
  DUST_SPEED_MAX,
  DUST_SPEED_MIN,
  PARTICLE_MAX,
  PLAYER_FOOT_OFFSET,
} from '../shared/constants'
import type { Calling } from '../shared/playerData'
import { type Seeded, generateMany, nextRandom } from '../shared/prng'
import { maybeMendingTrap, trapCenter } from '../world/gear/traps'
import { heldWeapon } from '../world/gear/weapons'
import { levelOf } from '../world/level/arena'
import { focusOf, isCoop, isStanding, playersOf } from '../world/party/party'
import { type SeatState, type Vector } from '../world/schema/worldSchema'
import { vectorLength } from '../world/step/geometry'
import {
  angleOf,
  chain,
  coin,
  dustPuff,
  playerGround,
  smokePuff,
  spark,
  sparks,
} from './particles/particleBursts'
import { keepNewest } from './particles/particles'
import type { Particle, TellWatch } from './renderSchema'

// What each hero shows the whole crew while it plays (decided with the owner
// on 2026-11-01, see "Heroes" in GAME_DESIGN.md): the Track Star kicks up
// dust as he runs, the Handyman throws sparks off a trap as he mends it
// (with a tink), the Line Cook lets off steam while he holds the Pressure Cooker, and
// the Penny Pincher glints a coin when a kill pays him. YOU shows nothing.
//
// All of it is cosmetic. It reads the World each seat already has (position
// and intent, the held gun, the traps' health, the keys found) and the
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

// WHAT CHANGED

const MEND_MARKS = 3

const markOf = (hp: number, maxHp: number): number =>
  Math.floor((MEND_MARKS * hp) / maxHp)

// NOTE: where a trap a Handyman is mending (src/world/gear/traps.ts) passed
// a third of its health since the last frame. Anyone's mend ends with the
// World's own TrapMended sparks; the Handyman's throws some on the way.
export const mendedSpots: {
  (watch: TellWatch): (model: Model) => ReadonlyArray<Vector>
  (model: Model, watch: TellWatch): ReadonlyArray<Vector>
} = Function.dual(
  2,
  (model: Model, watch: TellWatch): ReadonlyArray<Vector> => {
    const level = levelOf(model)
    return pipe(
      playersOf(model),
      Array.filter(({ player }) => player.calling === 'Handyman'),
      Array.map(({ seat }) => maybeMendingTrap(model, seat.slot)),
      Array.getSomes,
      Array.filter(trap =>
        // NOTE: at most 8 traps (2 a kind alone, 1 a kind a seat in co-op).
        // oxlint-disable-next-line munch/no-nested-scan
        Array.some(
          watch.traps,
          seen =>
            seen.id === trap.id &&
            markOf(seen.hp, trap.maxHp) < markOf(trap.hp, trap.maxHp),
        ),
      ),
      Array.dedupeWith((first, second) => first.id === second.id),
      Array.map(trap => trapCenter(level, trap)),
    )
  },
)

// NOTE: the seat's kills found keys since the last frame
// (src/world/keys/keys.ts).
const isKeyFound = (model: Model, { seat }: SeatState): boolean =>
  Array.some(
    model.tellWatch.keysFound,
    seen => seen.slot === seat.slot && seen.keysFound < seat.keysFound,
  )

const watchOf = (model: Model): TellWatch => ({
  traps: Array.map(model.traps, ({ id, hp }) => ({ id, hp })),
  keysFound: Array.map(playersOf(model), ({ seat }) => ({
    slot: seat.slot,
    keysFound: seat.keysFound,
  })),
})

// FRAME

type Batch = (state: number) => Spawn

type Tell = (
  model: Model,
  seat: SeatState,
  deltaMs: number,
) => ReadonlyArray<Batch>

// NOTE: each hero's tell for a seat on its feet, a record over the heroes so
// a new one fails typecheck until it says what it shows (YOU: nothing).
const TELLS: Readonly<Record<Calling, Tell>> = {
  You: () => [],
  Handyman: () => [],
  TrackStar: (_model, seat, deltaMs) => [runDust(seat, deltaMs)],
  PennyPincher: (model, seat) => (isKeyFound(model, seat) ? [glint(seat)] : []),
  LineCook: (_model, seat, deltaMs) => [steam(seat, deltaMs)],
}

// NOTE: the frame's tells, after its ticks: each seat's by its hero, the
// repairs, then what the frame saw of the World kept to be read against
// next time. It runs on frames with no tick too, so a repair made between
// frames shows once and is not seen again.
export const advanceTells: {
  (worldMs: number): (model: Model) => Model
  (model: Model, worldMs: number): Model
} = Function.dual(2, (model: Model, worldMs: number): Model =>
  isPlainCrew(model) ? model : tellsAfter(model, worldMs),
)

// NOTE: a run of only YOU has no tell, and nothing to watch, so most runs
// pay nothing here each frame.
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
