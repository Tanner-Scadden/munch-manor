import { Array } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  KITCHEN_TOP_ROW,
  type Level,
  MANOR_SPEC,
  type Tile,
  doorSpawnPoint,
  isInsideRoomAt,
  isOpenBlock,
  isWalkableTile,
  levelFor,
  moveCircle,
  resolveCircle,
  tileCenter,
} from './arena'
import { DOOR_HALF_WIDTH_PX, TILE_SIZE } from './constants'
import type { DoorId, Vector } from './model'
import {
  type Clearance,
  UNREACHED_DISTANCE,
  flowFieldToward,
  playerDistancePx,
  steerToward,
} from './pathing'
import { PARLOUR_SPOT } from './testing'
import { ZOMBIE_KINDS } from './zombies'

// NOTE: the manor in both states a run sees it, boarded and open, with the
// spots the player can stand in each: the parlour always, the kitchen once
// it is open.
const KITCHEN_SPOT: Vector = { x: 100, y: -80 }
const FRIDGE_SPOT: Vector = { x: 180, y: -104 }

type Case = Readonly<{
  name: string
  level: Level
  players: ReadonlyArray<Vector>
}>

const CASES: ReadonlyArray<Case> = [
  {
    name: 'kitchen boarded',
    level: levelFor(MANOR_SPEC),
    players: [PARLOUR_SPOT],
  },
  {
    name: 'kitchen open',
    level: levelFor(MANOR_SPEC, ['Kitchen']),
    players: [PARLOUR_SPOT, KITCHEN_SPOT, FRIDGE_SPOT],
  },
]

const CLEARANCES: ReadonlyArray<Clearance> = ['Narrow', 'Wide']

const everyTile = (level: Level): ReadonlyArray<Tile> =>
  Array.flatMap(Array.range(level.topRow, level.topRow + level.rows - 1), row =>
    Array.map(Array.range(0, level.columns - 1), column => ({
      column,
      row,
    })),
  )

// NOTE: where a zombie of each clearance can stand: any walkable tile for a
// narrow one, and a tile in some open two by two block for a wide one.
const canStandOn = (
  level: Level,
  clearance: Clearance,
  { column, row }: Tile,
): boolean =>
  clearance === 'Narrow'
    ? isWalkableTile(level, column, row)
    : isOpenBlock(level, column, row) ||
      isOpenBlock(level, column - 1, row) ||
      isOpenBlock(level, column, row - 1) ||
      isOpenBlock(level, column - 1, row - 1)

// NOTE: the widest a spawn strays from its door's middle: the door's half
// width less the smallest zombie's radius, as spawnAt in waves.ts clamps it.
const SPAWN_ROOM_PX =
  DOOR_HALF_WIDTH_PX -
  Math.min(...Array.map(Object.values(ZOMBIE_KINDS), ({ radius }) => radius))

const SPAWN_OFFSETS = [-SPAWN_ROOM_PX, 0, SPAWN_ROOM_PX]

// NOTE: the yard's commas start east of the kitchen's east wall.
const YARD_FIRST_COLUMN = 20

const isYard = ({ row, column }: Tile): boolean =>
  row < 0 && row >= KITCHEN_TOP_ROW && column >= YARD_FIRST_COLUMN

describe('the flow field reaches every zombie', () => {
  Array.forEach(CASES, ({ name, level, players }) =>
    Array.forEach(CLEARANCES, clearance =>
      Array.forEach(players, player => {
        const field = flowFieldToward(level, player, clearance, [])

        test(`${name}, ${clearance}, player at ${player.x},${player.y}: every spawn point reaches the player`, () => {
          const unreached = Array.filter(
            Array.flatMap(level.doorIds, door =>
              Array.map(SPAWN_OFFSETS, offset => ({ door, offset })),
            ),
            ({ door, offset }) =>
              playerDistancePx(
                level,
                field,
                doorSpawnPoint(level, door, offset),
              ) >=
              UNREACHED_DISTANCE * TILE_SIZE,
          )
          expect(unreached).toEqual([])
        })

        test(`${name}, ${clearance}, player at ${player.x},${player.y}: every tile a zombie stands on reaches the player, the yard too`, () => {
          const standable = Array.filter(everyTile(level), tile =>
            canStandOn(level, clearance, tile),
          )
          const unreached = Array.filter(
            standable,
            tile =>
              playerDistancePx(level, field, tileCenter(tile)) >=
              UNREACHED_DISTANCE * TILE_SIZE,
          )
          expect(Array.some(standable, isYard)).toBe(true)
          expect(unreached).toEqual([])
        })
      }),
    ),
  )
})

// NOTE: a zombie walked by steering alone, no other zombies, until it is in
// the house. The yard spots are where seed 31677's wave 10 boss and its crowd
// paced forever, between the yard's top right and the space past it.
const STEPS = 3000
const STEP_PX = 0.6

const stepsIntoTheHouse = (
  level: Level,
  start: Vector,
  player: Vector,
  clearance: Clearance,
  radius: number,
  barricaded: ReadonlyArray<DoorId>,
): number => {
  const field = flowFieldToward(level, player, clearance, [])
  const walk = (position: Vector, steps: number): number => {
    if (isInsideRoomAt(level, position) || steps >= STEPS) {
      return steps
    }
    const heading = steerToward(
      level,
      field,
      position,
      player,
      radius - 1,
      clearance,
      barricaded,
    )
    return walk(
      moveCircle(
        level,
        position,
        { x: heading.x * STEP_PX, y: heading.y * STEP_PX },
        radius,
      ),
      steps + 1,
    )
  }
  return walk(resolveCircle(level, start, radius), 0)
}

const YARD_STARTS: ReadonlyArray<Vector> = [
  { x: 320, y: -150 },
  { x: 305, y: -120 },
  { x: 315, y: -155 },
  { x: 330, y: -165 },
  { x: 300, y: -100 },
  { x: 205, y: -140 },
  { x: 250, y: -60 },
  { x: 330, y: 50 },
]

const BARRICADE_SETS: ReadonlyArray<ReadonlyArray<DoorId>> = [
  [],
  ['West'],
  ['North'],
  ['East', 'South'],
  ['Back', 'Window'],
]

describe('a zombie in the yard', () => {
  Array.forEach(CASES, ({ name, level, players }) =>
    Array.forEach(BARRICADE_SETS, barricaded =>
      test(`${name}, planks on ${barricaded.join(' and ') || 'no door'}: gets into the house from every spot`, () => {
        const stuck = Array.flatMap(players, player =>
          Array.flatMap(
            [
              { clearance: 'Narrow' as const, radius: 4.5 },
              { clearance: 'Wide' as const, radius: 8 },
            ],
            ({ clearance, radius }) =>
              Array.filter(
                YARD_STARTS,
                start =>
                  stepsIntoTheHouse(
                    level,
                    start,
                    player,
                    clearance,
                    radius,
                    barricaded,
                  ) >= STEPS,
              ),
          ),
        )
        expect(stuck).toEqual([])
      }),
    ),
  )
})

// NOTE: past the map's edge, where a big knockback (the Clang Pan's) can
// throw a zombie: below the parlour's bottom right corner and above the
// kitchen's top left. With nothing boarded, steering once walked it straight
// at the nearest door, into the house's corner, where it stuck.
const PAST_THE_EDGE: ReadonlyArray<Vector> = [
  { x: 315, y: 185 },
  { x: 325, y: 192 },
  { x: 5, y: -155 },
  { x: -6, y: -160 },
]

describe('a zombie knocked past the map edge', () => {
  Array.forEach(CASES, ({ name, level, players }) =>
    Array.forEach(BARRICADE_SETS, barricaded =>
      test(`${name}, planks on ${barricaded.join(' and ') || 'no door'}: walks back into the house`, () => {
        const stuck = Array.flatMap(players, player =>
          Array.filter(
            PAST_THE_EDGE,
            start =>
              stepsIntoTheHouse(
                level,
                start,
                player,
                'Narrow',
                4.5,
                barricaded,
              ) >= STEPS,
          ),
        )
        expect(stuck).toEqual([])
      }),
    ),
  )
})
