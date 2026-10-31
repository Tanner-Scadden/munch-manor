import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { isInsideRoomAt, levelOf, openExitIn } from './arena'
import { FIXED_STEP_MS } from './constants'
import { KITCHEN_EXIT } from './exits'
import { update } from './main'
import {
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { PARLOUR_SPOT, ticks, westPlank, zombieOf } from './testing'
import { ZOMBIE_KINDS } from './zombies'

// NOTE: seed 31677's wave 10 with the fridge on, as the balance bot left it
// at its 20 minute cap: the kitchen open, a Plank Pile on the west door, the
// player in the parlour, and a Tank, a wide walker like the boss, with twenty Groaners out in the
// yard's top right, at x 305 to 334 and y -170 to -117. Their way in is the
// parlour's north door, at the yard's foot. They paced there forever: out of
// the yard because the planks sent them around, then back in toward the
// north door.
const FRAME_MS = FIXED_STEP_MS
const SECONDS = 40

const speedOf = (zombie: Zombie): number => ZOMBIE_KINDS[zombie.kind].speedMin

const crowd: ReadonlyArray<Zombie> = [
  zombieOf('Tank', 1, 320, -150),
  ...Array.makeBy(20, index =>
    zombieOf(
      'Shambler',
      index + 2,
      305 + (index % 5) * 7,
      -170 + Math.floor(index / 5) * 13,
    ),
  ),
].map(zombie => modifyFields(zombie, { speed: () => speedOf(zombie) }))

const stuckInTheYard: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  level: level => openExitIn(level, KITCHEN_EXIT),
  phase: () => Phase.Wave({ wave: 10, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  traps: () => [westPlank],
  zombies: () => crowd,
  player: player =>
    modifyFields(player, {
      x: () => PARLOUR_SPOT.x,
      y: () => PARLOUR_SPOT.y,
      invulnerability: () =>
        Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
    }),
})

const outside = (current: Model): ReadonlyArray<Zombie> =>
  Array.filter(
    current.zombies,
    zombie => !isInsideRoomAt(levelOf(current), zombie),
  )

describe('a crowd in the yard', () => {
  test('walks through the yard to the north door and into the parlour', () => {
    story(
      update,
      given(stuckInTheYard),
      model(current => {
        expect(outside(current)).toHaveLength(crowd.length)
      }),
      ...ticks(Math.ceil((SECONDS * 1000) / FRAME_MS), FRAME_MS),
      model(current => {
        expect(current.zombies).toHaveLength(crowd.length)
        expect(
          Array.map(outside(current), ({ id, x, y }) => ({ id, x, y })),
        ).toEqual([])
      }),
    )
  })
})
