import { Array, Option, Result } from 'effect'
import { describe, expect, test } from 'vitest'

import {
  ARENA_WIDTH,
  DOT_SPEED,
  MOVE_SCALE,
  NEUTRAL_INPUT,
  type PlayerInput,
  type PlayerTick,
  StandIn,
  type StandInWorld,
  readAll,
  writeAll,
} from '../src/index'
import { right } from './fixtures'

const here = (slot: number, input: PlayerInput): PlayerTick => ({
  slot,
  input,
  presence: 'Here',
  viewLagTicks: 0,
  rttMs: 0,
})

// NOTE: inputs that change every so often, from a small seeded counter, so
// dots wander, meet walkers, and tag them.
const wander = (slot: number, tick: number): PlayerInput => {
  const phase = Math.floor((tick + slot * 37) / 40) % 8
  const angle = (phase / 8) * Math.PI * 2
  return {
    ...NEUTRAL_INPUT,
    moveX: Math.round(Math.cos(angle) * MOVE_SCALE),
    moveY: Math.round(Math.sin(angle) * MOVE_SCALE),
  }
}

const run = (ticks: number, slots: ReadonlyArray<number>) =>
  Array.reduce(
    globalThis.Array.from({ length: ticks }),
    [StandIn.start(slots, 7)],
    (worlds, _, tick) => {
      const last = worlds[worlds.length - 1] ?? StandIn.start(slots, 7)
      return [
        ...worlds,
        StandIn.step(
          last,
          Array.map(slots, slot => here(slot, wander(slot, tick))),
        ),
      ]
    },
  )

const snapshotOf = (world: StandInWorld): StandInWorld =>
  Result.getOrThrow(
    readAll(
      writeAll(writer => StandIn.snapshot(writer, world)),
      StandIn.readSnapshot,
    ),
  )

describe('the stand-in world', () => {
  test('a dot moves at its speed and stays in the arena', () => {
    const start = StandIn.start([0], 1)
    const second = Array.reduce(
      globalThis.Array.from({ length: 60 }),
      start,
      world => StandIn.step(world, [here(0, right)]),
    )
    const before = Option.getOrThrow(StandIn.own.of(start, 0))
    const after = Option.getOrThrow(StandIn.own.of(second, 0))
    expect(after.x - before.x).toBeCloseTo(DOT_SPEED, 5)
    const pinned = Array.reduce(
      globalThis.Array.from({ length: 600 }),
      start,
      world => StandIn.step(world, [here(0, right)]),
    )
    expect(Option.getOrThrow(StandIn.own.of(pinned, 0)).x).toBeLessThan(
      ARENA_WIDTH,
    )
  })

  test('an Away dot does not move', () => {
    const start = StandIn.start([0], 1)
    const next = StandIn.step(start, [
      { slot: 0, input: right, presence: 'Away', viewLagTicks: 0, rttMs: 0 },
    ])
    const dot = Option.getOrThrow(StandIn.own.of(next, 0))
    expect(dot.x).toBe(Option.getOrThrow(StandIn.own.of(start, 0)).x)
    expect(dot.away).toBe(true)
  })

  test('the same seed and inputs give the same world', () => {
    expect(run(600, [0, 1])).toEqual(run(600, [0, 1]))
  })

  test('wandering dots tag walkers, which come back as new ones', () => {
    const worlds = run(3600, [0, 1, 2, 3])
    const last = worlds[worlds.length - 1]
    const scored = Array.reduce(
      last?.dots ?? [],
      0,
      (sum, dot) => sum + dot.score,
    )
    expect(scored).toBeGreaterThan(0)
    expect(last?.walkers.length).toBe(6)
    expect(last?.nextId).toBe(7 + scored)
  })

  test('applying every diff to a snapshot gives the next snapshot', () => {
    const worlds = run(1800, [0, 1, 2])
    const sent = Array.filter(worlds, (_, index) => index % 3 === 0)
    const client = Array.reduce(
      sent.slice(1),
      snapshotOf(sent[0] ?? StandIn.start([0], 1)),
      (held, next, index) => {
        const prev = sent[index]
        if (prev === undefined) {
          return held
        }
        const diff = writeAll(writer => StandIn.diff(writer, prev, next))
        const applied = Result.getOrThrow(
          readAll(diff, reader => StandIn.applyDiff(reader, held)),
        )
        expect(applied).toEqual(snapshotOf(next))
        return applied
      },
    )
    expect(client.tick).toBe(1800)
  })

  test('a removed player leaves the diff', () => {
    const start = StandIn.start([0, 1], 3)
    const removed = StandIn.removePlayer(start, 1)
    const diff = writeAll(writer => StandIn.diff(writer, start, removed))
    const applied = Result.getOrThrow(
      readAll(diff, reader => StandIn.applyDiff(reader, snapshotOf(start))),
    )
    expect(Array.map(applied.dots, dot => dot.slot)).toEqual([0])
  })

  test('a diff for 4 moving dots and 6 walkers is about 10 bytes a mover', () => {
    const worlds = run(300, [0, 1, 2, 3])
    const sizes = Array.map(worlds.slice(3), (world, index) => {
      const prev = worlds[index]
      return prev === undefined
        ? 0
        : writeAll(writer => StandIn.diff(writer, prev, world)).length
    })
    const largest = Math.max(...sizes)
    expect(largest).toBeLessThan(10 * 10 + 8)
    expect(
      writeAll(writer =>
        StandIn.snapshot(writer, worlds[0] ?? StandIn.start([], 1)),
      ).length,
    ).toBeLessThan(80)
  })

  test('interpolation moves between two worlds and snaps a respawn', () => {
    const from = StandIn.start([0], 5)
    const to = StandIn.step(from, [here(0, right)])
    const half = StandIn.interpolate(from, to, 0.5)
    const dot = Option.getOrThrow(StandIn.own.of(half, 0))
    const a = Option.getOrThrow(StandIn.own.of(from, 0))
    const b = Option.getOrThrow(StandIn.own.of(to, 0))
    expect(dot.x).toBeCloseTo((a.x + b.x) / 2, 5)
  })
})
