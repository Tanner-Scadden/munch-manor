import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { modifySeatRecord, seatStateAt } from './party'
import type { World } from './world'
import {
  type DownedLife,
  GameEvent,
  Life,
  type PlayerSlot,
  type Seat,
  type SeatState,
} from './worldSchema'

// The MEDIC call (MULTIPLAYER.md, "Life", with the owner on 2026-11-02): a
// player who goes down shouts MEDIC! at once, and while still downed can
// shout again once the last shout cools down. A shout is the downed life's
// `callMs` back at 0, so every client sees it in the World: the bubble over
// the body, the teammates' edge badge, and the bots answering it. The tick
// sounds it as a MedicCalled event. A revive pays off with SAVED!, or
// CLUTCH! when the bleed was nearly out.

export const MEDIC_RULES = {
  cooldownMs: 4000,
  freshMs: 1500,
  clutchBleedMs: 3000,
} as const

// NOTE: the downed life a fall starts with: a full bleed bar and a shout
// for the next tick.
export const fallenLife = (bleedMs: number): DownedLife =>
  Life.Downed({ bleedMs, reviveMs: 0, callMs: 0 })

const maybeDownedLifeOf = (seat: Seat): Option.Option<DownedLife> =>
  Life.isAnyOf(['Downed'])(seat.life) ? Option.some(seat.life) : Option.none()

// NOTE: a shout still ringing: the bubble shows, the edge badge pulses, and
// the bots answer it first.
export const isCallFresh = (seat: Seat): boolean =>
  Option.exists(
    maybeDownedLifeOf(seat),
    ({ callMs }) => callMs < MEDIC_RULES.freshMs,
  )

// NOTE: a downed player whose last shout has cooled down can shout again.
const canCallMedic = (seat: Seat): boolean =>
  Option.exists(
    maybeDownedLifeOf(seat),
    ({ callMs }) => callMs >= MEDIC_RULES.cooldownMs,
  )

// NOTE: the CallMedic seat action's rule (src/stepWorld.ts): the shout,
// or none.
export const shoutMedic: {
  (slot: PlayerSlot): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot): Option.Option<World>
} = Function.dual(2, (world: World, slot: PlayerSlot): Option.Option<World> =>
  canCallMedic(seatStateAt(world, slot).seat)
    ? Option.some(
        modifySeatRecord(world, slot, seat =>
          modifyFields(seat, {
            life: life =>
              Life.isAnyOf(['Downed'])(life)
                ? Life.Downed({ ...life, callMs: 0 })
                : life,
          }),
        ),
      )
    : Option.none(),
)

// NOTE: in the tick, before the bleed moves on: a shout at 0 is heard.
export const sounded: {
  (slot: PlayerSlot, life: DownedLife): (world: World) => World
  (world: World, slot: PlayerSlot, life: DownedLife): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, life: DownedLife): World => {
    if (life.callMs > 0) {
      return world
    }
    const { player } = seatStateAt(world, slot)
    return modifyFields(world, {
      frameEvents: Array.append(
        GameEvent.MedicCalled({ x: player.x, y: player.y }),
      ),
    })
  },
)

// NOTE: SAVED! over the first reviver, CLUTCH! when the bleed had under
// MEDIC_RULES.clutchBleedMs left.
export const saved: {
  (
    revivers: Array.NonEmptyReadonlyArray<SeatState>,
    life: DownedLife,
  ): (world: World) => World
  (
    world: World,
    revivers: Array.NonEmptyReadonlyArray<SeatState>,
    life: DownedLife,
  ): World
} = Function.dual(
  3,
  (
    world: World,
    revivers: Array.NonEmptyReadonlyArray<SeatState>,
    life: DownedLife,
  ): World => {
    const { player } = Array.headNonEmpty(revivers)
    return modifyFields(world, {
      frameEvents: Array.append(
        GameEvent.TeammateSaved({
          x: player.x,
          y: player.y,
          clutch: life.bleedMs < MEDIC_RULES.clutchBleedMs,
        }),
      ),
    })
  },
)
