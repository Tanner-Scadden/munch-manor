import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

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

// The finale (docs/ESCAPE_PLAN.md, "The finale"; LORE.md, "The house gets
// hungrier"): once the list is done, the house presses harder and Uncle
// Chunk comes through the front door at the start of the next wave: the
// run's last fight, his health that wave's (src/world/zombies/boss.ts,
// `bossHp`) times the finale's own scale for the difficulty and the crew.
// He is no thing on the list. When he falls, his big key bursts out of him
// and flies into the front door's lock (owner, 2026-11-10: "a big key that
// is dropped that unlocks the front door on death"), and the door swings
// open as it lands, with no clock and nothing to pick up. A player who
// steps out through it is Out: safe outside, out of the fight. The run is
// an escape once no one stands in the house and one at least is out: a
// downed teammate is carried out with the crew. What is left of the wave
// chases the crew to the door. Endless has no list, so its finale never
// leaves Hunting.

// RULES

type FinaleRules = Readonly<{
  keyFlightMs: number
  chunkHealthScale: Readonly<Record<Difficulty, number>>
  chunkCrewScale: ReadonlyArray<number>
  hungryCountScale: number
  doorReachPx: number
}>

// NOTE: his big key flies to the lock in under a second, so the door is
// open almost the moment he falls. His health is the wave's boss health
// times `chunkHealthScale` (owner, 2026-11-10: "make the uncle zombie
// soooooo much more hard"), so the fight runs a minute or two on Double
// Dare, and times `chunkCrewScale` by the players in the run, since a crew
// shoots him together (the wave's own co-op toughness rides in already).
// Once the list is done every wave rolled holds a quarter more zombies. A player steps out
// within a few pixels of the door's inside face, anywhere along its width.
// Uncle Chunk comes at the start of the wave after the list is done, on
// every difficulty, whether it was done in a break or mid-wave (owner,
// 2026-11-10: a wave floor held him back with nothing on screen to say
// why, and a Triple Dare player who had found everything waited for him).
export const FINALE_RULES: FinaleRules = {
  keyFlightMs: 0.9 * MS_PER_SECOND,
  chunkHealthScale: { Easy: 3, Normal: 3.5, Hard: 1.5, Nightmare: 1.25 },
  chunkCrewScale: [1, 1.6, 2.1, 2.6],
  hungryCountScale: 1.25,
  doorReachPx: PLAYER_RADIUS + 4,
}

// READING

// NOTE: the house is hungrier from the moment the list is done to the end:
// Uncle Chunk's wave and the walk out. On Triple Dog
// Dare it is hungrier from the first thing found (docs/ESCAPE_PLAN.md,
// layer 12, the difficulty dial). The music stampedes then
// (src/app/update/music.ts).
export const isHouseHungry = (world: World): boolean =>
  !Finale.isAnyOf(['Hunting'])(world.dare.finale) ||
  (world.difficulty.chosen === 'Nightmare' && dareItemsFoundOf(world) > 0)

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

// NOTE: how far his big key has flown to the lock, 0 to 1: 0 before he
// falls, 1 once the door is open. What the key's flight draws.
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

// NOTE: Uncle Chunk in the house: his body among the zombies, or his fight
// begun. The kitchen's back door shuts for good then (../kitchen/backDoor.ts).
export const hasChunkInHouse = (world: World): boolean =>
  Array.some(world.zombies, isBoss) || !Boss.isAnyOf(['Absent'])(world.boss)

// NOTE: Uncle Chunk is due at the front door once the list is done, at the
// start of the next wave (the only place `summonAtFrontDoor` runs), until
// he has come and fallen (the finale moves on then).
const isChunkDue = (world: World): boolean =>
  Finale.isAnyOf(['Summoned'])(world.dare.finale) &&
  Phase.isAnyOf(['Wave'])(world.phase) &&
  !hasChunkInHouse(world)

// NOTE: his health for a crew of `crew` on `difficulty` at a wave of these
// spawns: the wave's boss health, times the finale's scale for the
// difficulty and the crew. The balance model reads it too.
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
  chunkHpFor({
    difficulty: world.difficulty.chosen,
    crew: playerCountOf(world),
    spawns,
  })

// SUMMONING

// NOTE: at a wave's start, with Uncle Chunk due, he waits at the front door
// and comes in at once, with his finale health. Called by the wave's start
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
              hp: chunkHp(world, spawns),
              guestHpScale: wavePlanHpScale(spawns),
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

// NOTE: the frame Uncle Chunk starts to die, his big key bursts out of him
// where he falls and flies for the front door's lock. Hit-stop's slow
// motion is his fall's own (src/world/step/hitStop.ts); the burst's chime,
// coins, and shake are the client's, off BigKeyBurst.
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

// NOTE: the key in the air; it lands in the lock and the door swings open,
// in a break or a wave alike.
const flyKey = (
  world: World,
  flight: typeof Finale.KeyFlying.Type,
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
    Summoned: () => burstKeyWhereChunkFalls(world),
    KeyFlying: flight => flyKey(world, flight, worldMs),
    Open: () => escapeWhenOut(forEachSeat(world, stepOutFor)),
  })
})
