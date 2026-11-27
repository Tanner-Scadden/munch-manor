import { Array, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import { type Model, Phase, type Zombie } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { sceneShapes } from '#app/views/layers.ts'
import { rattlesShapes } from '#features/rattles/rattlesSpot.ts'
import { playerShapes } from '#render/bodies/playerView.ts'
import {
  zombieHealthBarShapes,
  zombieShapes,
} from '#render/bodies/zombieView.ts'
import { type Drawable, depthSortedShapes } from '#render/depth.ts'
import * as Draw from '#render/draw.ts'
import { doorwaysOf, isBehindWall } from '#render/room/doorways.ts'
import { jsonOf, zombieOf } from '#test/testing.ts'
import {
  type Level,
  MANOR,
  PARLOUR,
  RATTLES_BOX,
  openExit,
} from '#world/level/arena.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'

const marker = (id: number): Draw.Shape =>
  Draw.Rect({ x: id, y: 0, width: 1, height: 1, fill: '#fff' })

const fightingModel = (
  player: Readonly<{ x: number; y: number }>,
  zombies: ReadonlyArray<Zombie>,
): Model =>
  modifyFocus(
    UiStruct.evolve(initialModel, {
      phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
      zombies: () => zombies,
    }),
    { player: current => ({ ...current, ...player }) },
  )

const worldShapesOf = (current: Model): ReadonlyArray<Draw.Shape> =>
  Option.match(Array.head(sceneShapes(current)), {
    onNone: () => [],
    onSome: world => (world._tag === 'Group' ? world.shapes : []),
  })

const indexOf = (
  shapes: ReadonlyArray<Draw.Shape>,
  shape: Draw.Shape,
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
          current.pacing.loneMs,
        )(zombie),
      ),
    ),
  )

const trunkIndex = (current: Model): number =>
  indexOf(
    worldShapesOf(current),
    Option.getOrThrow(Array.last(rattlesShapes('Dozing', current.elapsedMs))),
  )

const NORTH_DOOR_X = MANOR.doors.North.center.x

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
    const behindTrunk = zombieOf(
      'Shambler',
      1,
      RATTLES_BOX.left + 6,
      RATTLES_BOX.top - 10,
    )
    const current = fightingModel(
      { x: RATTLES_BOX.right - 4, y: RATTLES_BOX.top - 8 },
      [behindTrunk],
    )
    const trunk = trunkIndex(current)
    expect(trunk).toBeGreaterThanOrEqual(0)
    expect(playerIndex(current)).toBeLessThan(trunk)
    expect(zombieIndex(current, behindTrunk)).toBeLessThan(trunk)
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

  test('only doorways in a top wall count, an opened exit included', () => {
    const spans = (level: Level) => doorwaysOf(level)
    expect(spans(PARLOUR)).toEqual([{ row: 1, first: 21, last: 22 }])
    expect(spans(openExit(PARLOUR, 'Kitchen'))).toEqual([
      { row: 1, first: 6, last: 7 },
      { row: 1, first: 21, last: 22 },
    ])
    expect(spans(MANOR)).toEqual([{ row: 1, first: 27, last: 28 }])
    expect(spans(openExit(MANOR, 'Kitchen'))).toEqual([
      { row: -14, first: 12, last: 13 },
      { row: 1, first: 6, last: 7 },
      { row: 1, first: 27, last: 28 },
    ])
  })

  test('a zombie up in the open kitchen is not behind the parlour wall', () => {
    const kitchen = openExit(MANOR, 'Kitchen')
    expect(isBehindWall(kitchen)(70, 15)).toBe(true)
    expect(isBehindWall(kitchen)(70, -40)).toBe(false)
    expect(isBehindWall(kitchen)(130, -135)).toBe(true)
  })
})
