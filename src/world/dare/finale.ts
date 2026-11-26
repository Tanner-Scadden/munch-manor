import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { MS_PER_SECOND, PLAYER_RADIUS } from '../../shared/constants'
import type { Difficulty } from '../../shared/playerData'
import { type Level, levelOf } from '../level/arena'
import {
  forEachSeat,
  isOut,
  isStanding,
  modifySeatRecord,
  playerCountOf,
  playersOf,
  seatStateAt,
} from '../party/party'
import { chunkHealthScaleOf } from '../run/dareLadder'
import { spreadSpawns } from '../run/difficulty'
import { type World, modifyWorldFields } from '../schema/world'
import {
  Boss,
  GameEvent,
  Life,
  Phase,
  type PlannedSpawn,
  type PlayerSlot,
  type Vector,
  ZombieState,
  roundWaveOf,
} from '../schema/worldSchema'
import { bossHp, wavePlanHpScale } from '../zombies/boss'
import { isBoss } from '../zombies/zombies'
import { dareItemsFoundOf, isDareListDone } from './dare'
import { Finale } from './dareSchema'

type FinaleRules = Readonly<{
  keyFlightMs: number
  chunkHealthScale: Readonly<Record<Difficulty, number>>
  chunkCrewScale: ReadonlyArray<number>
  hungryCountScale: number
  doorReachPx: number
}>

export const FINALE_RULES: FinaleRules = {
  keyFlightMs: 0.9 * MS_PER_SECOND,
  chunkHealthScale: { Easy: 3, Normal: 3.5, Hard: 1.5, Nightmare: 1.25 },
  chunkCrewScale: [1, 1.6, 2.1, 2.6],
  hungryCountScale: 1.25,
  doorReachPx: PLAYER_RADIUS + 4,
}

export const isHouseHungry = (world: World): boolean =>
  !Finale.isAnyOf(['Hunting'])(world.dare.finale) ||
  (world.difficulty.chosen === 'Nightmare' && dareItemsFoundOf(world) > 0)

export const hungrierSpawns: {
  (
    spawns: ReadonlyArray<PlannedSpawn>,
  ): (world: World) => ReadonlyArray<PlannedSpawn>
  (
    world: World,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn>
} = Function.dual(
  2,
  (
    world: World,
    spawns: ReadonlyArray<PlannedSpawn>,
  ): ReadonlyArray<PlannedSpawn> =>
    isHouseHungry(world)
      ? spreadSpawns({
          spawns,
          countScale: FINALE_RULES.hungryCountScale,
          healthScale: 1,
        })
      : spawns,
)

export const keyFlightShareOf = (world: World): number =>
  Finale.match(world.dare.finale, {
    Hunting: () => 0,
    Summoned: () => 0,
    KeyFlying: ({ remainingMs, durationMs }) =>
      durationMs > 0 ? 1 - remainingMs / durationMs : 1,
    Open: () => 1,
  })

export const isFrontDoorOpen = (world: World): boolean =>
  Finale.isAnyOf(['Open'])(world.dare.finale)

export const hasChunkInHouse = (world: World): boolean =>
  Array.some(world.zombies, isBoss) || !Boss.isAnyOf(['Absent'])(world.boss)

const isChunkDue = (world: World): boolean =>
  Finale.isAnyOf(['Summoned'])(world.dare.finale) &&
  Phase.isAnyOf(['Wave'])(world.phase) &&
  !hasChunkInHouse(world)

export const chunkHpFor = ({
  difficulty,
  crew,
  spawns,
}: Readonly<{
  difficulty: Difficulty
  crew: number
  spawns: ReadonlyArray<PlannedSpawn>
}>): number =>
  Math.round(
    bossHp(difficulty, spawns) *
      FINALE_RULES.chunkHealthScale[difficulty] *
      Option.getOrElse(
        Option.orElse(Array.get(FINALE_RULES.chunkCrewScale, crew - 1), () =>
          Array.last(FINALE_RULES.chunkCrewScale),
        ),
        () => 1,
      ),
  )

const chunkHp = (world: World, spawns: ReadonlyArray<PlannedSpawn>): number =>
  Math.round(
    chunkHpFor({
      difficulty: world.difficulty.chosen,
      crew: playerCountOf(world),
      spawns,
    }) * chunkHealthScaleOf(world.dareMark),
  )

export const summonAtFrontDoor: {
  (spawns: ReadonlyArray<PlannedSpawn>): (world: World) => World
  (world: World, spawns: ReadonlyArray<PlannedSpawn>): World
} = Function.dual(
  2,
  (world: World, spawns: ReadonlyArray<PlannedSpawn>): World =>
    isChunkDue(world)
      ? UiStruct.evolve(world, {
          boss: () =>
            Boss.Waiting({
              door: 'Front',
              waitBelow: spawns.length,
              hp: chunkHp(world, spawns),
              guestHpScale: wavePlanHpScale(spawns),
            }),
        })
      : world,
)

const setFinale = (world: World, finale: Finale): World =>
  modifyWorldFields(world, {
    dare: dare => UiStruct.evolve(dare, { finale: () => finale }),
  })

const frontDoorOf = (level: Level): Vector => level.doors.Front.center

const withEvent = (world: World, event: GameEvent): World =>
  modifyWorldFields(world, { frameEvents: Array.append(event) })

const burstKeyWhereChunkFalls = (world: World): World =>
  Option.match(
    Array.findFirst(
      world.zombies,
      zombie => isBoss(zombie) && ZombieState.isAnyOf(['Dying'])(zombie.state),
    ),
    {
      onNone: () => world,
      onSome: chunk =>
        withEvent(
          setFinale(
            world,
            Finale.KeyFlying({
              from: { x: chunk.x, y: chunk.y },
              remainingMs: FINALE_RULES.keyFlightMs,
              durationMs: FINALE_RULES.keyFlightMs,
            }),
          ),
          GameEvent.BigKeyBurst({ x: chunk.x, y: chunk.y }),
        ),
    },
  )

const flyKey = (
  world: World,
  flight: typeof Finale.cases.KeyFlying.Type,
  worldMs: number,
): World =>
  flight.remainingMs > worldMs
    ? setFinale(
        world,
        Finale.KeyFlying({
          ...flight,
          remainingMs: flight.remainingMs - worldMs,
        }),
      )
    : withEvent(
        setFinale(world, Finale.Open()),
        GameEvent.FrontDoorOpened(frontDoorOf(levelOf(world))),
      )

export const isAtFrontDoor: {
  (point: Vector): (level: Level) => boolean
  (level: Level, point: Vector): boolean
} = Function.dual(2, (level: Level, point: Vector): boolean => {
  const { box } = level.thresholds.Front
  return (
    point.x >= box.left &&
    point.x <= box.right &&
    point.y >= box.top - FINALE_RULES.doorReachPx &&
    point.y <= box.bottom
  )
})

export const frontDoorSillOf = (level: Level): Vector => {
  const { box } = level.thresholds.Front
  return {
    x: (box.left + box.right) / 2,
    y: box.top - FINALE_RULES.doorReachPx / 2,
  }
}

const stepOutFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  return isStanding(seat) && isAtFrontDoor(levelOf(world), player)
    ? withEvent(
        modifySeatRecord(world, slot, out =>
          UiStruct.evolve(out, { life: () => Life.Out() }),
        ),
        GameEvent.SteppedOut({ x: player.x, y: player.y, slot }),
      )
    : world
}

export const isCrewOut = (world: World): boolean => {
  const seats = Array.map(playersOf(world), ({ seat }) => seat)
  return Array.some(seats, isOut) && !Array.some(seats, isStanding)
}

const escapeWhenOut = (world: World): World =>
  isCrewOut(world)
    ? UiStruct.evolve(world, {
        phase: () => Phase.Escaped({ wave: roundWaveOf(world.phase) }),
      })
    : world

export const advanceFinale: {
  (worldMs: number): (world: World) => World
  (world: World, worldMs: number): World
} = Function.dual(2, (world: World, worldMs: number): World => {
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)) {
    return world
  }
  return Finale.match(world.dare.finale, {
    Hunting: () =>
      isDareListDone(world) ? setFinale(world, Finale.Summoned()) : world,
    Summoned: () => burstKeyWhereChunkFalls(world),
    KeyFlying: flight => flyKey(world, flight, worldMs),
    Open: () => escapeWhenOut(forEachSeat(world, stepOutFor)),
  })
})
