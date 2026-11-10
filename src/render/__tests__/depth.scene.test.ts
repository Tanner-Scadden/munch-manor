import { Array, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { sceneShapes } from '../../app/layers'
import { type Model, Phase, type Zombie } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { rattlesShapes } from '../../features/rattles/rattlesSpot'
import { jsonOf, zombieOf } from '../../test/testing'
import {
  type Level,
  MANOR,
  PARLOUR,
  RATTLES_BOX,
  levelOf,
  openExit,
} from '../../world/level/arena'
import { focusOf, modifyFocus } from '../../world/party/party'
import { type Drawable, depthSortedShapes } from '../depth'
import { isBehindWall, occludersOf } from '../occluders'
import { playerShapes } from '../playerView'
import { zombieHealthBarShapes, zombieShapes } from '../zombieView'

const marker = (id: number): Canvas.Shape =>
  Canvas.Rect({ x: id, y: 0, width: 1, height: 1, fill: '#fff' })

const fightingModel = (
  player: Readonly<{ x: number; y: number }>,
  zombies: ReadonlyArray<Zombie>,
): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
      zombies: () => zombies,
    }),
    { player: current => ({ ...current, ...player }) },
  )

const worldShapesOf = (current: Model): ReadonlyArray<Canvas.Shape> =>
  Option.match(Array.head(sceneShapes(current)), {
    onNone: () => [],
    onSome: world => (world._tag === 'Group' ? world.shapes : []),
  })

const indexOf = (
  shapes: ReadonlyArray<Canvas.Shape>,
  shape: Canvas.Shape,
): number => {
  const wanted = jsonOf(shape)
  return Option.getOrElse(
    Array.findFirstIndex(shapes, candidate => jsonOf(candidate) === wanted),
    () => -1,
  )
}

const playerIndex = (current: Model): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(Array.head(playerShapes(current))),
  )

const zombieIndex = (current: Model, zombie: Zombie): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(
      Array.last(
        zombieShapes(
          focusOf(current).player,
          current.elapsedMs,
          current.boss,
        )(zombie),
      ),
    ),
  )

// NOTE: Rattles' trunk, the last shape of his spot, never moves; he dozes
// through a wave.
const trunkIndex = (current: Model): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(Array.last(rattlesShapes('Dozing', current.elapsedMs))),
  )

const NORTH_DOOR_X = MANOR.doors.North.center.x

const lintelIndex = (current: Model): number =>
  pipe(
    occludersOf(levelOf(current)),
    Array.findFirst(
      ({ left, right }) => NORTH_DOOR_X >= left && NORTH_DOOR_X < right,
    ),
    Option.flatMap(({ shapes }) => Array.head(shapes)),
    Option.match({
      onNone: () => -1,
      onSome: shape => indexOf(worldShapesOf(current), shape),
    }),
  )

const hasHealthBar = (current: Model, zombie: Zombie): boolean =>
  Option.match(Array.head(zombieHealthBarShapes(zombie)), {
    onNone: () => false,
    onSome: bar => indexOf(worldShapesOf(current), bar) >= 0,
  })

describe('Depth sort', () => {
  test('draws by foot, then by rank, and keeps arrival order for a tie', () => {
    const drawables: ReadonlyArray<Drawable> = [
      { footY: 50, rank: 'Zombie', shapes: [marker(1)] },
      { footY: 20, rank: 'Player', shapes: [marker(2)] },
      { footY: 50, rank: 'Trap', shapes: [marker(3)] },
      { footY: 50, rank: 'Zombie', shapes: [marker(4)] },
      { footY: 49.5, rank: 'Prop', shapes: [marker(5)] },
    ]
    expect(depthSortedShapes(drawables)).toEqual([
      marker(2),
      marker(5),
      marker(3),
      marker(1),
      marker(4),
    ])
  })

  test('a zombie south of the player draws in front and one north draws behind', () => {
    const south = zombieOf('Shambler', 1, 160, 100)
    const north = zombieOf('Shambler', 2, 170, 80)
    const current = fightingModel({ x: 160, y: 90 }, [south, north])
    const player = playerIndex(current)
    expect(player).toBeGreaterThanOrEqual(0)
    expect(zombieIndex(current, north)).toBeLessThan(player)
    expect(zombieIndex(current, south)).toBeGreaterThan(player)
  })

  test('a zombie with lower feet than the player draws in front at the same middle', () => {
    const tank = zombieOf('Tank', 1, 166, 90)
    const current = fightingModel({ x: 160, y: 90 }, [tank])
    expect(zombieIndex(current, tank)).toBeGreaterThan(playerIndex(current))
  })

  test("the player and a zombie behind Rattles' trunk draw under it", () => {
    const behindTrunk = zombieOf('Shambler', 1, RATTLES_BOX.left + 6, 140)
    const current = fightingModel(
      { x: RATTLES_BOX.right - 4, y: RATTLES_BOX.top - 8 },
      [behindTrunk],
    )
    const trunk = trunkIndex(current)
    expect(trunk).toBeGreaterThanOrEqual(0)
    expect(playerIndex(current)).toBeLessThan(trunk)
    expect(zombieIndex(current, behindTrunk)).toBeLessThan(trunk)
  })

  test('a zombie in the north doorway draws under the lintel and one inside draws over it', () => {
    const inDoorway = zombieOf('Shambler', 1, NORTH_DOOR_X - 4, 8)
    const inside = zombieOf('Shambler', 2, NORTH_DOOR_X - 16, 26)
    const current = fightingModel({ x: 160, y: 90 }, [inDoorway, inside])
    const lintel = lintelIndex(current)
    expect(lintel).toBeGreaterThanOrEqual(0)
    expect(zombieIndex(current, inDoorway)).toBeLessThan(lintel)
    expect(zombieIndex(current, inside)).toBeGreaterThan(lintel)
  })

  test('a hurt zombie behind the lintel shows no bar until it steps in', () => {
    const inDoorway = zombieOf('Tank', 1, NORTH_DOOR_X, 8, {
      hp: 10,
      maxHp: 30,
    })
    const inside = zombieOf('Tank', 2, NORTH_DOOR_X, 30, {
      hp: 10,
      maxHp: 30,
    })
    const current = fightingModel({ x: 160, y: 90 }, [inDoorway, inside])
    expect(hasHealthBar(current, inDoorway)).toBe(false)
    expect(hasHealthBar(current, inside)).toBe(true)
  })

  test('only doorways in a top wall get a lintel, an opened exit included', () => {
    const spans = (level: Level) =>
      Array.map(occludersOf(level), ({ floorY, left, right }) => ({
        floorY,
        left,
        right,
      }))
    expect(spans(PARLOUR)).toEqual([{ floorY: 20, left: 190, right: 250 }])
    expect(spans(openExit(PARLOUR, 'Kitchen'))).toEqual([
      { floorY: 20, left: 40, right: 100 },
      { floorY: 20, left: 190, right: 250 },
    ])
    // NOTE: the dining room's north door, cols 27 and 28, and the kitchen's
    // boards and back door once it is open.
    expect(spans(MANOR)).toEqual([{ floorY: 20, left: 250, right: 310 }])
    expect(spans(openExit(MANOR, 'Kitchen'))).toEqual([
      { floorY: -130, left: 100, right: 160 },
      { floorY: 20, left: 40, right: 100 },
      { floorY: 20, left: 250, right: 310 },
    ])
  })

  test('a zombie up in the open kitchen is not behind the parlour wall', () => {
    const kitchen = openExit(MANOR, 'Kitchen')
    expect(isBehindWall(kitchen)(70, 15)).toBe(true)
    expect(isBehindWall(kitchen)(70, -40)).toBe(false)
    expect(isBehindWall(kitchen)(130, -135)).toBe(true)
  })
})
