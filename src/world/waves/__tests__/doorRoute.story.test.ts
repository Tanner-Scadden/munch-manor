import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  BreakClock,
  type DoorId,
  Frenzy,
  Invulnerability,
  type Model,
  Phase,
  type PlannedSpawn,
  Trap,
  type Zombie,
  ZombieAction,
  ZombieState,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  checkModel,
  modelAfter,
  send,
  steps,
  ticks,
} from '../../../test/testing'
import { TRAPS, trapBox } from '../../gear/traps'
import { MANOR, levelOf } from '../../level/arena'
import { distanceToBox } from '../../level/tileGrid'
import { isInsideRoomAt, nearestDoor } from '../../level/tileQueries'
import { modifyFocus } from '../../party/party'
import { drawSurfacingSpot } from '../../zombies/crawler'
import { doorCounts } from '../endlessWaves'

const FRAME_MS = 50

const spawnAt = (
  door: DoorId,
  pack: number,
  atMs = 0,
  formation: PlannedSpawn['formation'] = 'Squad',
): PlannedSpawn => ({
  atMs,
  kind: 'Shambler',
  door,
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation,
})

const DISTANT_SPAWN = spawnAt('North', 999, 1e9)

const plank = (id: number, door: DoorId, hp = TRAPS.Barricade.hp): Trap =>
  Trap.Barricade({ id, door, hp, maxHp: TRAPS.Barricade.hp, hitRemainingMs: 0 })

const base: Model = modifyFocus(
  UiStruct.evolve(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  }),
  {
    player: player =>
      UiStruct.evolve(player, {
        invulnerability: () =>
          Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
      }),
  },
)

const fighting = (
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
): Model =>
  UiStruct.evolve(base, {
    phase: () =>
      Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [...spawns, DISTANT_SPAWN] }),
    traps: () => traps,
  })

const doorsOf = (current: Model): ReadonlyArray<DoorId> =>
  Array.map(current.zombies, zombie => nearestDoor(MANOR, zombie).id)

const previewDoors = (current: Model): ReadonlyArray<DoorId> =>
  Phase.match(current.phase, {
    Ready: () => [],
    Arriving: () => [],
    Preparation: ({ spawns }) =>
      Array.map(
        doorCounts(spawns, current.traps, levelOf(current).doorIds),
        ({ door }) => door,
      ),
    Wave: () => [],
    Paused: () => [],
    Escaped: () => [],
    LeftEarly: () => [],
    GameOver: () => [],
  })

describe('boarded doors are no spawn points', () => {
  it.effect(
    'a pack due at a boarded door comes through the next open door clockwise',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          fighting([spawnAt('North', 1)], [plank(1, 'North')]),
          steps(
            ticks(2, FRAME_MS),
            checkModel(current => {
              expect(doorsOf(current)).toEqual(['East'])
            }),
          ),
        )
        yield* modelAfter(
          fighting(
            [spawnAt('North', 1)],
            [plank(1, 'North'), plank(2, 'East')],
          ),
          steps(
            ticks(2, FRAME_MS),
            checkModel(current => {
              expect(doorsOf(current)).toEqual(['South'])
            }),
          ),
        )
      }),
  )

  it.effect('a pincer keeps to two different open doors', () =>
    Effect.gen(function* () {
      const pincer = [
        spawnAt('North', 10, 0, 'Pincer'),
        spawnAt('South', 11, 0, 'Pincer'),
      ]
      yield* modelAfter(
        fighting(pincer, [plank(1, 'North'), plank(2, 'South')]),
        steps(
          ticks(2, FRAME_MS),
          checkModel(current => {
            expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
              'East',
              'West',
            ])
          }),
        ),
      )
      yield* modelAfter(
        fighting(pincer, [plank(1, 'North'), plank(2, 'East')]),
        steps(
          ticks(2, FRAME_MS),
          checkModel(current => {
            expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
              'South',
              'West',
            ])
          }),
        ),
      )
    }),
  )

  it.effect('the later pack of a pincer avoids the door its mate took', () =>
    modelAfter(
      fighting(
        [spawnAt('North', 10, 0, 'Pincer'), spawnAt('East', 11, 0, 'Pincer')],
        [plank(1, 'North')],
      ),
      steps(
        ticks(2, FRAME_MS),
        checkModel(current => {
          expect(Array.sort(doorsOf(current), stringOrder)).toEqual([
            'East',
            'South',
          ])
        }),
      ),
    ),
  )

  it.effect(
    'a plank that breaks mid-wave opens its door for the later packs',
    () => {
      const chewer: Zombie = {
        id: 500,
        kind: 'Tank',
        x: MANOR.doors.North.center.x,
        y: 31,
        speed: 12,
        hp: 999,
        maxHp: 999,
        knockback: { x: 0, y: 0 },
        hitRemainingMs: 0,
        state: ZombieState.Walking(),
        action: ZombieAction.Roaming(),
        frenzy: Frenzy.Calm(),
      }
      return modelAfter(
        UiStruct.evolve(
          fighting(
            [spawnAt('North', 1), spawnAt('North', 2, 7000)],
            [plank(1, 'North')],
          ),
          { zombies: () => [chewer] },
        ),
        steps(
          ticks(2, FRAME_MS),
          checkModel(current => {
            expect(doorsOf(current)).toEqual(['North', 'East'])
            expect(current.traps).toHaveLength(1)
          }),
          ticks(200, FRAME_MS),
          checkModel(current => {
            expect(current.traps).toEqual([])
            expect(Array.drop(doorsOf(current), 2)).toEqual(['North'])
          }),
        ),
      )
    },
  )
})

const preparing: Model = modifyFocus(
  UiStruct.evolve(base, {
    phase: () =>
      Phase.Preparation({
        clock: BreakClock.Counting(),
        wave: 3,
        remainingMs: 15_000,
        durationMs: PREPARATION_MS,
        spawns: [spawnAt('North', 1), spawnAt('North', 1), spawnAt('West', 2)],
      }),
  }),
  {
    trapStock: () => ({ Barricade: 1, Turret: 0 }),
    selectedTrap: () => 'Barricade',
    player: player =>
      UiStruct.evolve(player, {
        x: () => MANOR.doors.North.center.x,
        y: () => 27,
      }),
  },
)

describe('the door preview follows the planks', () => {
  it.effect(
    'a plank moves its door count, live, and a broken one moves it back',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          preparing,
          steps(
            checkModel(current => {
              expect(previewDoors(current)).toEqual(['North', 'West'])
            }),
            send(Message.PressedKey({ code: 'KeyT' })),
            checkModel(current => {
              expect(current.traps).toHaveLength(1)
              expect(previewDoors(current)).toEqual(['West', 'East'])
            }),
          ),
        )
        yield* modelAfter(
          UiStruct.evolve(preparing, { traps: () => [plank(1, 'North', 0)] }),
          steps(
            checkModel(current => {
              expect(previewDoors(current)).toEqual(['West', 'East'])
            }),
            send(Message.TickedFrame({ deltaTime: FRAME_MS })),
            checkModel(current => {
              expect(current.traps).toEqual([])
              expect(previewDoors(current)).toEqual(['North', 'West'])
            }),
          ),
        )
      }),
  )
})

describe('Ankle Biters and boarded doors', () => {
  test('an Ankle Biter never comes up beside or behind a boarded doorway', () => {
    const traps = [plank(1, 'West'), plank(2, 'North')]
    Array.forEach(
      Array.makeBy(60, index => index * 7919 + 1),
      state => {
        const [, spot] = drawSurfacingSpot(
          MANOR,
          state,
          { x: 160, y: 95 },
          traps,
        )
        expect(isInsideRoomAt(MANOR, spot)).toBe(true)
        Array.forEach(traps, trap => {
          expect(distanceToBox(spot, trapBox(MANOR, trap))).toBeGreaterThan(0)
        })
      },
    )
  })
})

const stringOrder = (first: string, second: string): -1 | 0 | 1 =>
  first < second ? -1 : first > second ? 1 : 0
