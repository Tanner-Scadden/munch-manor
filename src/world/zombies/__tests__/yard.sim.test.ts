import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import {
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FIXED_STEP_MS } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  START_SPOT,
  checkModel,
  modelAfter,
  steps,
  ticks,
  westPlank,
  zombieOf,
} from '../../../test/testing'
import { levelOf, openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import { isInsideRoomAt } from '../../level/tileQueries'
import { modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS } from '../zombies'

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

const crowd: ReadonlyArray<Zombie> = Array.map(
  [
    zombieOf('Tank', 1, 320, -150),
    ...Array.makeBy(20, index =>
      zombieOf(
        'Shambler',
        index + 2,
        305 + (index % 5) * 7,
        -170 + Math.floor(index / 5) * 13,
      ),
    ),
  ],
  zombie => UiStruct.evolve(zombie, { speed: () => speedOf(zombie) }),
)

const stuckInTheYard: Model = modifyFocus(
  UiStruct.evolve(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    level: level => openExitIn(level, KITCHEN_EXIT),
    phase: () =>
      Phase.Wave({ wave: 10, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    traps: () => [westPlank],
    zombies: () => crowd,
  }),
  {
    player: player =>
      UiStruct.evolve(player, {
        x: () => START_SPOT.x,
        y: () => START_SPOT.y,
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  },
)

const outside = (current: Model): ReadonlyArray<Zombie> =>
  Array.filter(
    current.zombies,
    zombie => !isInsideRoomAt(levelOf(current), zombie),
  )

describe('a crowd in the yard', () => {
  it.effect(
    'walks through the yard to the north door and into the parlour',
    () =>
      modelAfter(
        stuckInTheYard,
        steps(
          checkModel(current => {
            expect(outside(current)).toHaveLength(crowd.length)
          }),
          ticks(Math.ceil((SECONDS * 1000) / FRAME_MS), FRAME_MS),
          checkModel(current => {
            expect(current.zombies).toHaveLength(crowd.length)
            expect(
              Array.map(outside(current), ({ id, x, y }) => ({ id, x, y })),
            ).toEqual([])
          }),
        ),
      ),
  )
})
