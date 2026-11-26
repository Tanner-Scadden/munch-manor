import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { World } from '#world/schema/world.ts'
import {
  type DownedLife,
  GameEvent,
  Life,
  type PlayerSlot,
  type Seat,
  type SeatState,
} from '#world/schema/worldSchema.ts'

import { modifySeatRecord, seatStateAt } from './party.ts'

export const MEDIC_RULES = {
  cooldownMs: 4000,
  freshMs: 1500,
  clutchBleedMs: 3000,
} as const

export const fallenLife = (bleedMs: number): DownedLife =>
  Life.Downed({ bleedMs, reviveMs: 0, callMs: 0 })

const maybeDownedLifeOf = (seat: Seat): Option.Option<DownedLife> =>
  Life.isAnyOf(['Downed'])(seat.life) ? Option.some(seat.life) : Option.none()

export const isCallFresh = (seat: Seat): boolean =>
  Option.exists(
    maybeDownedLifeOf(seat),
    ({ callMs }) => callMs < MEDIC_RULES.freshMs,
  )

const canCallMedic = (seat: Seat): boolean =>
  Option.exists(
    maybeDownedLifeOf(seat),
    ({ callMs }) => callMs >= MEDIC_RULES.cooldownMs,
  )

export const shoutMedic: {
  (slot: PlayerSlot): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot): Option.Option<World>
} = Function.dual(2, (world: World, slot: PlayerSlot): Option.Option<World> =>
  canCallMedic(seatStateAt(world, slot).seat)
    ? Option.some(
        modifySeatRecord(world, slot, seat =>
          UiStruct.evolve(seat, {
            life: life =>
              Life.isAnyOf(['Downed'])(life)
                ? Life.Downed({ ...life, callMs: 0 })
                : life,
          }),
        ),
      )
    : Option.none(),
)

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
    return UiStruct.evolve(world, {
      frameEvents: Array.append(
        GameEvent.MedicCalled({ x: player.x, y: player.y }),
      ),
    })
  },
)

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
    return UiStruct.evolve(world, {
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
