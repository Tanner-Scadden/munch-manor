import { Array, Effect, Option, Order, Result, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import {
  BreakClock,
  type DoorId,
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from '#app/model.ts'
import {
  DOOR_HALF_WIDTH_PX,
  FIXED_STEP_MS,
  PLAYER_RADIUS,
} from '#shared/constants.ts'
import { quietWave, withActors } from '#test/model.fixture.ts'
import {
  blastFrames,
  checkModel,
  holdFire,
  modelAfter,
  recordTicks,
  send,
  steps,
  tick,
  zombieOf,
} from '#test/testing.ts'
import {
  type Level,
  PARLOUR,
  START_LEVEL,
  startingLevel,
} from '#world/level/arena.ts'
import {
  doorSpawnPoint,
  isSolidAt,
  nearestDoor,
} from '#world/level/tileQueries.ts'
import { modifyFocus } from '#world/party/party.ts'
import type { LevelState } from '#world/schema/entitySchema.ts'
import { roundWaveOf } from '#world/schema/worldSchema.ts'
import {
  doorCounts,
  floorCounts,
  rollSpawns,
} from '#world/waves/endlessWaves.ts'
import { FINAL_WAVE } from '#world/waves/wavePlans.ts'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from '#world/zombies/zombies.ts'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = START_LEVEL.start.x
const CENTER_Y = START_LEVEL.start.y

const withScene = (zombies: ReadonlyArray<Zombie>): Model =>
  withActors(quietWave(1), zombies)

describe('exploders', () => {
  it.effect(
    'a fight with Exploder chains replays identically from the same seed',
    () =>
      Effect.gen(function* () {
        const cluster = [
          ...Array.makeBy(5, index =>
            zombieOf(
              'Exploder',
              index + 1,
              196 + index * 9,
              70 + (index % 2) * 6,
            ),
          ),
          ...Array.makeBy(4, index =>
            zombieOf('Shambler', index + 10, 200 + index * 10, 84, {
              speed: 20,
            }),
          ),
          zombieOf('Runner', 20, 250, 60, { speed: 45 }),
        ]
        const play = (seed: number) =>
          Effect.suspend(() => {
            const frames: Array<Model> = []
            return modelAfter(
              modifyFocus(
                UiStruct.evolve(withScene(cluster), { rngState: () => seed }),
                {
                  player: player =>
                    UiStruct.evolve(player, { x: () => 150, y: () => 72 }),
                },
              ),
              steps(holdFire, recordTicks(300, FRAME_MS, frames)),
            ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
          })

        const first = yield* play(4242)
        const again = yield* play(4242)
        const other = yield* play(777)
        expect(again).toEqual(first)
        expect(other).not.toEqual(first)
        const bursts = blastFrames(first)
        expect(bursts.length).toBeGreaterThanOrEqual(2)
        expect(
          new Set(Array.map(bursts, ({ elapsedMs }) => elapsedMs)).size,
        ).toBe(bursts.length)
      }),
  )
})

describe('spawn tables', () => {
  it.effect(
    'the preview matches the kinds that come out of each door and the floor',
    () =>
      Effect.gen(function* () {
        const seed = 1357
        const wave = FINAL_WAVE
        const [rngState, spawns] = rollSpawns(seed, wave)
        const seen = new Map<
          number,
          Readonly<{ kind: ZombieKind; door: DoorId | 'Floor' }>
        >()
        const preparation = Phase.Preparation({
          clock: BreakClock.Counting(),
          wave,
          remainingMs: 5000,
          durationMs: 5000,
          spawns,
        })

        yield* modelAfter(
          modifyFocus(
            UiStruct.evolve(quietWave(1), {
              phase: () => preparation,
              rngState: () => rngState,
            }),
            {
              player: player =>
                UiStruct.evolve(player, {
                  hp: () => 1e6,
                  invulnerability: () =>
                    Invulnerability.Invulnerable({
                      remainingMs: 1e9,
                      durationMs: 1e9,
                    }),
                }),
            },
          ),
          steps(
            send(Message.PressedKey({ code: 'Enter' })),
            ...Array.makeBy(4000, () =>
              steps(
                tick(50),
                checkModel((current: Model) => {
                  Array.forEach(current.zombies, zombie => {
                    if (
                      roundWaveOf(current.phase) === wave &&
                      !seen.has(zombie.id)
                    ) {
                      seen.set(zombie.id, {
                        kind: zombie.kind,
                        door: ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
                          ? 'Floor'
                          : nearestDoor(PARLOUR, zombie).id,
                      })
                    }
                  })
                }),
              ),
            ),
          ),
        )

        const arrivals = Array.fromIterable(seen.values())
        expect(arrivals).toHaveLength(spawns.length)
        const arrivedCounts = Array.filterMap(PARLOUR.doorIds, door => {
          const atDoor = Array.filter(
            arrivals,
            arrival => arrival.door === door,
          )
          const kinds = Array.filterMap(ZOMBIE_KIND_ORDER, kind => {
            const count = Array.filter(
              atDoor,
              arrival => arrival.kind === kind,
            ).length
            return count > 0 ? Result.succeed({ kind, count }) : Result.failVoid
          })
          return Array.isReadonlyArrayEmpty(kinds)
            ? Result.failVoid
            : Result.succeed({ door, kinds })
        })
        expect(arrivedCounts).toEqual(
          Array.map(doorCounts(spawns, []), ({ door, kinds }) => ({
            door,
            kinds,
          })),
        )
        const fromTheFloor = Array.filterMap(ZOMBIE_KIND_ORDER, kind => {
          const count = Array.filter(
            arrivals,
            arrival => arrival.door === 'Floor' && arrival.kind === kind,
          ).length
          return count > 0 ? Result.succeed({ kind, count }) : Result.failVoid
        })
        expect(fromTheFloor).toEqual(floorCounts(spawns))
        expect(Array.isReadonlyArrayEmpty(fromTheFloor)).toBe(false)
      }),
  )
})

describe('tank pathing', () => {
  const TANK_TEST_SPEED = 40
  const TANK_REACH = ZOMBIE_KINDS.Tank.radius + PLAYER_RADIUS + 1
  const ROOMS: ReadonlyArray<
    Readonly<{
      state: LevelState
      level: Level
      targets: ReadonlyArray<Readonly<{ x: number; y: number }>>
    }>
  > = [
    {
      state: { ...startingLevel, id: 'Parlour' },
      level: PARLOUR,
      targets: [{ x: 20, y: 48 }, PARLOUR.start],
    },
    {
      state: startingLevel,
      level: START_LEVEL,
      targets: [
        { x: 20, y: 50 },
        { x: CENTER_X, y: CENTER_Y },
      ],
    },
  ]

  const tankRun = (
    state: LevelState,
    level: Level,
    door: DoorId,
    offset: number,
    target: Readonly<{ x: number; y: number }>,
  ) =>
    Effect.suspend(() => {
      const start = doorSpawnPoint(level, door, offset)
      const frames: Array<Model> = []
      return modelAfter(
        modifyFocus(
          UiStruct.evolve(
            withScene([
              zombieOf('Tank', 1, start.x, start.y, {
                speed: TANK_TEST_SPEED,
              }),
            ]),
            { level: () => state },
          ),
          {
            player: player =>
              UiStruct.evolve(player, {
                x: () => target.x,
                y: () => target.y,
                invulnerability: () =>
                  Invulnerability.Invulnerable({
                    remainingMs: 1e9,
                    durationMs: 1e9,
                  }),
              }),
          },
        ),
        recordTicks(400, 50, frames),
      ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
    })

  const closestApproach = (frames: ReadonlyArray<Model>): number =>
    pipe(
      frames,
      Array.flatMap(({ zombies, seats: [{ player }] }) =>
        Array.map(zombies, zombie =>
          Math.hypot(zombie.x - player.x, zombie.y - player.y),
        ),
      ),
      Array.sort(Order.Number),
      Array.head,
      Option.getOrElse(() => Infinity),
    )

  const tankHitsWall = (level: Level, frames: ReadonlyArray<Model>): boolean =>
    Array.some(frames, ({ zombies }) =>
      Array.some(zombies, ({ x, y }) => {
        const inset = ZOMBIE_KINDS.Tank.radius - 0.5
        return Array.some(
          [
            { x: x - inset, y },
            { x: x + inset, y },
            { x, y: y - inset },
            { x, y: y + inset },
          ],
          point => isSolidAt(level, point),
        )
      }),
    )

  it.effect(
    'a Tank fits through every doorway at the edge of its spawn spread and reaches the player',
    () => {
      const room = DOOR_HALF_WIDTH_PX - ZOMBIE_KINDS.Tank.radius
      const runs = Array.flatMap(ROOMS, ({ state, level, targets }) =>
        Array.flatMap(level.doorIds, door =>
          Array.flatMap([-room, room], offset =>
            Array.map(targets, target => ({
              state,
              level,
              door,
              offset,
              target,
            })),
          ),
        ),
      )
      return Effect.forEach(
        runs,
        ({ state, level, door, offset, target }) =>
          Effect.map(tankRun(state, level, door, offset, target), frames => {
            const label = `${state.id} ${door} ${offset} ${target.x},${target.y}`
            expect(closestApproach(frames), label).toBeLessThanOrEqual(
              TANK_REACH,
            )
            expect(tankHitsWall(level, frames), label).toBe(false)
          }),
        { discard: true },
      )
    },
  )
})
