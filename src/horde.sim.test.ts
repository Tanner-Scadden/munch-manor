// The horde sim tests: whole fights and waves replayed frame by frame. They
// take seconds, so they run in `bun run test:full` and CI, not in
// `bun run test`. The kind table, exploders, and spawn tables are in
// horde.story.test.ts.
import { Array, Option, Order, Result, pipe } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, doorSpawnPoint, isSolidAt, nearestDoor } from './arena'
import { DOOR_HALF_WIDTH_PX, FIXED_STEP_MS, PLAYER_RADIUS } from './constants'
import { doorCounts, floorCounts, rollSpawns } from './endlessWaves'
import { update } from './main'
import { Message } from './message'
import {
  type DoorId,
  Invulnerability,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  type ZombieKind,
} from './model'
import { quietWave, withActors } from './model.fixture'
import { blastFrames, holdFire, recordTicks, ticks, zombieOf } from './testing'
import { FINAL_WAVE } from './wavePlans'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2

const withScene = (zombies: ReadonlyArray<Zombie>): Model =>
  withActors(quietWave(1), zombies)

describe('exploders', () => {
  test('a fight with Exploder chains replays identically from the same seed', () => {
    const cluster = [
      ...Array.makeBy(5, index =>
        zombieOf('Exploder', index + 1, 196 + index * 9, 70 + (index % 2) * 6),
      ),
      ...Array.makeBy(4, index =>
        zombieOf('Shambler', index + 10, 200 + index * 10, 84, { speed: 20 }),
      ),
      zombieOf('Runner', 20, 250, 60, { speed: 45 }),
    ]
    const play = (seed: number): ReadonlyArray<Model> => {
      const frames: Array<Model> = []
      story(
        update,
        given(
          modifyFields(withScene(cluster), {
            rngState: () => seed,
            player: player =>
              modifyFields(player, { x: () => 150, y: () => 72 }),
          }),
        ),
        holdFire,
        ...recordTicks(300, FRAME_MS, frames),
      )
      return frames
    }

    const first = play(4242)
    expect(play(4242)).toEqual(first)
    expect(play(777)).not.toEqual(first)
    const bursts = blastFrames(first)
    expect(bursts.length).toBeGreaterThanOrEqual(2)
    expect(new Set(Array.map(bursts, ({ elapsedMs }) => elapsedMs)).size).toBe(
      bursts.length,
    )
  })
})

describe('spawn tables', () => {
  test('the preview matches the kinds that come out of each door and the floor', () => {
    const seed = 1357
    const wave = FINAL_WAVE
    const [rngState, spawns] = rollSpawns(seed, wave)
    const seen = new Map<
      number,
      Readonly<{ kind: ZombieKind; door: DoorId | 'Floor' }>
    >()
    const preparation = Phase.Preparation({
      wave,
      remainingMs: 5000,
      durationMs: 5000,
      spawns,
    })

    story(
      update,
      given(
        modifyFields(quietWave(1), {
          phase: () => preparation,
          rngState: () => rngState,
          player: player =>
            modifyFields(player, {
              hp: () => 1e6,
              invulnerability: () =>
                Invulnerability.Invulnerable({
                  remainingMs: 1e9,
                  durationMs: 1e9,
                }),
            }),
        }),
      ),
      message(Message.PressedKey({ code: 'Enter' })),
      ...Array.flatMap(ticks(4000, 50), frame => [
        frame,
        model((current: Model) => {
          Array.forEach(current.zombies, zombie => {
            if (!seen.has(zombie.id)) {
              seen.set(zombie.id, {
                kind: zombie.kind,
                door: ZombieAction.isAnyOf(['Burrowed'])(zombie.action)
                  ? 'Floor'
                  : nearestDoor(PARLOUR, zombie).id,
              })
            }
          })
        }),
      ]),
    )

    const arrivals = Array.fromIterable(seen.values())
    expect(arrivals).toHaveLength(spawns.length)
    const arrivedCounts = Array.filterMap(PARLOUR.doorIds, door => {
      const atDoor = Array.filter(arrivals, arrival => arrival.door === door)
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
      Array.map(doorCounts(spawns, []), ({ door, kinds }) => ({ door, kinds })),
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
  })
})

describe('tank pathing', () => {
  const TANK_TEST_SPEED = 40
  const TANK_REACH = ZOMBIE_KINDS.Tank.radius + PLAYER_RADIUS + 1
  const underThePiano = { x: 20, y: 48 }
  const roomCenter = { x: CENTER_X, y: CENTER_Y }

  const tankRun = (
    door: DoorId,
    offset: number,
    target: Readonly<{ x: number; y: number }>,
  ): ReadonlyArray<Model> => {
    const start = doorSpawnPoint(PARLOUR, door, offset)
    const frames: Array<Model> = []
    story(
      update,
      given(
        modifyFields(
          withScene([
            zombieOf('Tank', 1, start.x, start.y, { speed: TANK_TEST_SPEED }),
          ]),
          {
            player: player =>
              modifyFields(player, {
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
      ),
      ...recordTicks(400, 50, frames),
    )
    return frames
  }

  const closestApproach = (frames: ReadonlyArray<Model>): number =>
    pipe(
      frames,
      Array.flatMap(({ zombies, player }) =>
        Array.map(zombies, zombie =>
          Math.hypot(zombie.x - player.x, zombie.y - player.y),
        ),
      ),
      Array.sort(Order.Number),
      Array.head,
      Option.getOrElse(() => Infinity),
    )

  const tankHitsWall = (frames: ReadonlyArray<Model>): boolean =>
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
          point => isSolidAt(PARLOUR, point),
        )
      }),
    )

  test('a Tank fits through every doorway at the edge of its spawn spread and reaches the player', () => {
    const room = DOOR_HALF_WIDTH_PX - ZOMBIE_KINDS.Tank.radius
    Array.forEach(PARLOUR.doorIds, door => {
      Array.forEach([-room, room], offset => {
        Array.forEach([underThePiano, roomCenter], target => {
          const frames = tankRun(door, offset, target)
          const label = `${door} ${offset} ${target.x},${target.y}`
          expect(closestApproach(frames), label).toBeLessThanOrEqual(TANK_REACH)
          expect(tankHitsWall(frames), label).toBe(false)
        })
      })
    })
  })
})
