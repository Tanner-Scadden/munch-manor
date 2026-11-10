import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { MS_PER_SECOND, PLAYER_RADIUS } from '../../shared/constants'
import { type Level, levelOf } from '../level/arena'
import {
  forEachSeat,
  isOut,
  isStanding,
  modifySeatRecord,
  playersOf,
  seatStateAt,
} from '../party/party'
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
import { bossHp } from '../zombies/boss'
import { isBoss } from '../zombies/zombies'
import { dropHat, isDareListDone, isHatDropped, isHatFound } from './dare'
import { Finale } from './dareSchema'

// The finale (docs/ESCAPE_PLAN.md, "The finale"; LORE.md, "The house gets
// hungrier"): once the list is done, the house presses harder and Uncle
// Chunk comes through the front door at the start of the next wave, his
// health that wave's (src/world/zombies/boss.ts, `bossHp`, from wave 10's
// tuning along the Endless health curve). He drops his party hat where he
// falls; a player who takes it starts the front door unlocking, its clock
// running only while a wave is on, so the crew holds the hall. Then the door
// swings open, and a player who steps out through it is Out: safe outside,
// out of the fight. The run is an escape once no one stands in the house
// and one at least is out: a downed teammate is carried out with the crew.
// Endless has no list, so its finale never leaves Hunting.

// RULES

type FinaleRules = Readonly<{
  unlockMs: number
  hungryCountScale: number
  doorReachPx: number
}>

// NOTE: starting numbers, to tune with the balance layer. The door takes 45
// seconds of waves to unlock. Once the list is done every wave rolled holds
// a quarter more zombies. A player steps out within a few pixels of the
// door's inside face, anywhere along its width.
export const FINALE_RULES: FinaleRules = {
  unlockMs: 45 * MS_PER_SECOND,
  hungryCountScale: 1.25,
  doorReachPx: PLAYER_RADIUS + 4,
}

// READING

// NOTE: the house is hungrier from the moment the list is done to the end.
const isHouseHungry = (world: World): boolean =>
  !Finale.isAnyOf(['Hunting'])(world.dare.finale)

// NOTE: a wave's spawns, a quarter more of them once the house is hungrier.
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

// NOTE: how far the front door has unlocked, 0 to 1: 0 before the hat is
// taken, 1 once it is open. What the door's art and the dare card draw.
export const unlockShareOf = (world: World): number =>
  Finale.match(world.dare.finale, {
    Hunting: () => 0,
    Summoned: () => 0,
    Unlocking: ({ remainingMs, durationMs }) =>
      durationMs > 0 ? 1 - remainingMs / durationMs : 1,
    Open: () => 1,
  })

export const isFrontDoorOpen = (world: World): boolean =>
  Finale.isAnyOf(['Open'])(world.dare.finale)

const hasChunkInHouse = (world: World): boolean =>
  Array.some(world.zombies, isBoss) || !Boss.isAnyOf(['Absent'])(world.boss)

// NOTE: Uncle Chunk is due at the front door once the list is done, until he
// has come and dropped his hat.
const isChunkDue = (world: World): boolean =>
  Finale.isAnyOf(['Summoned'])(world.dare.finale) &&
  !isHatDropped(world) &&
  !hasChunkInHouse(world)

// SUMMONING

// NOTE: at a wave's start, with Uncle Chunk due, he waits at the front door
// and comes in at once, with that wave's health. Called by the wave's start
// (src/world/waves/waves.ts, `startWaveEarly`).
export const summonAtFrontDoor: {
  (spawns: ReadonlyArray<PlannedSpawn>): (world: World) => World
  (world: World, spawns: ReadonlyArray<PlannedSpawn>): World
} = Function.dual(
  2,
  (world: World, spawns: ReadonlyArray<PlannedSpawn>): World =>
    isChunkDue(world)
      ? modifyFields(world, {
          boss: () =>
            Boss.Waiting({
              door: 'Front',
              waitBelow: spawns.length,
              hp: bossHp(world.difficulty.chosen, spawns),
            }),
        })
      : world,
)

// THE STEP

const setFinale = (world: World, finale: Finale): World =>
  modifyWorldFields(world, {
    dare: dare => modifyFields(dare, { finale: () => finale }),
  })

const frontDoorOf = (level: Level): Vector => level.doors.Front.center

const withEvent = (world: World, event: GameEvent): World =>
  modifyWorldFields(world, { frameEvents: Array.append(event) })

// NOTE: his hat falls where Uncle Chunk does, the frame he starts to die.
const dropHatWhereChunkFalls = (world: World): World =>
  Option.match(
    Array.findFirst(
      world.zombies,
      zombie => isBoss(zombie) && ZombieState.isAnyOf(['Dying'])(zombie.state),
    ),
    {
      onNone: () => world,
      onSome: chunk => dropHat(world, chunk),
    },
  )

const startUnlocking = (world: World): World =>
  withEvent(
    setFinale(
      world,
      Finale.Unlocking({
        remainingMs: FINALE_RULES.unlockMs,
        durationMs: FINALE_RULES.unlockMs,
      }),
    ),
    GameEvent.FrontDoorUnlocking(frontDoorOf(levelOf(world))),
  )

const countDownUnlock = (
  world: World,
  remainingMs: number,
  durationMs: number,
  worldMs: number,
): World => {
  if (!Phase.isAnyOf(['Wave'])(world.phase)) {
    return world
  }
  return remainingMs > worldMs
    ? setFinale(
        world,
        Finale.Unlocking({ remainingMs: remainingMs - worldMs, durationMs }),
      )
    : withEvent(
        setFinale(world, Finale.Open()),
        GameEvent.FrontDoorOpened(frontDoorOf(levelOf(world))),
      )
}

// NOTE: a point at the front door's inside face, along its width, close
// enough to step out through it.
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

// NOTE: the middle of the sill just inside the front door: where a player
// (or a bot) walks to step out.
export const frontDoorSillOf = (level: Level): Vector => {
  const { box } = level.thresholds.Front
  return {
    x: (box.left + box.right) / 2,
    y: box.top - FINALE_RULES.doorReachPx / 2,
  }
}

// NOTE: a standing player at the sill steps out: Out, safe and out of the
// fight (src/world/schema/worldSchema.ts, Life), drawn as waiting outside.
const stepOutFor = (world: World, slot: PlayerSlot): World => {
  const { seat, player } = seatStateAt(world, slot)
  return isStanding(seat) && isAtFrontDoor(levelOf(world), player)
    ? withEvent(
        modifySeatRecord(world, slot, out =>
          modifyFields(out, { life: () => Life.Out() }),
        ),
        GameEvent.SteppedOut({ x: player.x, y: player.y, slot }),
      )
    : world
}

// NOTE: the walk out. The crew is out once no player still stands in the
// house and one at least has stepped out: the downed go out with them, so a
// crew whose last ones in go down after a teammate stepped out escapes too
// (src/world/waves/waves.ts, endWhenDefeated, for a fall the same tick).
export const isCrewOut = (world: World): boolean => {
  const seats = Array.map(playersOf(world), ({ seat }) => seat)
  return Array.some(seats, isOut) && !Array.some(seats, isStanding)
}

const escapeWhenOut = (world: World): World =>
  isCrewOut(world)
    ? modifyFields(world, {
        phase: () => Phase.Escaped({ wave: roundWaveOf(world.phase) }),
      })
    : world

// NOTE: one tick of the finale, in a break or a wave of a run with a list.
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
    Summoned: () => {
      if (isHatFound(world)) {
        return startUnlocking(world)
      }
      return isHatDropped(world) ? world : dropHatWhereChunkFalls(world)
    },
    Unlocking: ({ remainingMs, durationMs }) =>
      countDownUnlock(world, remainingMs, durationMs, worldMs),
    Open: () => escapeWhenOut(forEachSeat(world, stepOutFor)),
  })
})
