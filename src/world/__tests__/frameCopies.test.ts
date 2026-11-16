// The frame's copies of the Model and the World held to a budget by
// count, not by time. A step that writes a field copies the whole Model
// (118 fields) or World (39), so the fields a frame leaves with a new
// reference count the copies it could not skip. A field rewritten with a
// value equal to the one it had (a list rebuilt with the same elements, a
// record made again with the same numbers) is a copy made for nothing:
// none is allowed, and the steps after see identity and skip their own.
import { Array, Effect, Record, Result } from 'effect'
import { Story } from 'foldkit'

import { describe, expect, it } from '@effect/vitest'

import type { Model } from '../../app/model'
import { DareHintCall } from '../../domain/clientSchema'
import {
  armedBreak,
  hidingSpotIn,
  quietWave,
  withActors,
  withDareThings,
} from '../../test/model.fixture'
import {
  APPLICATION,
  FRAME_MS,
  holdFire,
  recordTicks,
  ticks,
  zombieAt,
} from '../../test/testing'
import { DareThingState } from '../dare/dareSchema'
import { levelOf } from '../level/arena'
import { LIBRARY_ROOM_ID } from '../level/plan'
import { focusOf } from '../party/party'

const FRAMES = 240
const CHASE_SPEED = 40

// NOTE: equal by value, field by field, for the test alone (a frame never
// compares deeply).
const isEqualValue = (first: unknown, second: unknown): boolean => {
  if (Object.is(first, second)) {
    return true
  }
  if (
    typeof first !== 'object' ||
    typeof second !== 'object' ||
    first === null ||
    second === null
  ) {
    return false
  }
  const firstFields: Readonly<Record<string, unknown>> = { ...first }
  const secondFields: Readonly<Record<string, unknown>> = { ...second }
  const keys = Record.keys(firstFields)
  return (
    keys.length === Record.keys(secondFields).length &&
    Array.every(keys, key => isEqualValue(firstFields[key], secondFields[key]))
  )
}

type Rewrites = Readonly<{
  // NOTE: every Model field each frame left with a new reference, summed.
  written: number
  // NOTE: the same, of those whose value is equal to the frame before's.
  needless: ReadonlyArray<string>
}>

const rewritesOver = (frames: ReadonlyArray<Model>): Rewrites => {
  const pairs = Array.zip(frames, Array.drop(frames, 1))
  const changed = Array.flatMap(pairs, ([before, after]) => {
    const beforeFields: Readonly<Record<string, unknown>> = { ...before }
    const afterFields: Readonly<Record<string, unknown>> = { ...after }
    return Array.filterMap(Record.keys(afterFields), key =>
      Object.is(beforeFields[key], afterFields[key])
        ? Result.failVoid
        : Result.succeed({
            key,
            isNeedless: isEqualValue(beforeFields[key], afterFields[key]),
          }),
    )
  })
  return {
    written: changed.length,
    needless: Array.dedupe(
      Array.filterMap(changed, ({ key, isNeedless }) =>
        isNeedless ? Result.succeed(key) : Result.failVoid,
      ),
    ),
  }
}

const framesFrom = (
  start: Model,
  isFiring: boolean,
): Effect.Effect<ReadonlyArray<Model>> =>
  Effect.suspend(() => {
    const frames: Array<Model> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...(isFiring ? [holdFire] : []),
      // NOTE: the first frames build what a level keeps, so the count
      // starts after them.
      ...ticks(5, FRAME_MS),
      ...recordTicks(FRAMES, FRAME_MS, frames),
    ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
  })

// NOTE: a wave with a crowd closing in from all round and the player
// firing into it, so zombies walk, bullets fly and land, and keys drop.
const fightingWave = (): Model => {
  const base = quietWave(3)
  const { x, y } = focusOf(base).player
  return withActors(
    base,
    Array.makeBy(12, index => {
      const turn = (index / 12) * Math.PI * 2
      return zombieAt(
        index + 1,
        x + Math.cos(turn) * 150,
        y + Math.sin(turn) * 150,
        { speed: CHASE_SPEED },
      )
    }),
  )
}

// NOTE: the same break with a thing on the dare's list, so Rattles calls
// his hint on the first frame and it stays up through the rest.
const hintedBreak = (): Model => {
  const { x, y } = hidingSpotIn(levelOf(armedBreak), LIBRARY_ROOM_ID)
  return withDareThings(armedBreak, [
    {
      id: 0,
      kind: 'ButlersBell',
      state: DareThingState.Hidden({ x, y, workedMs: 0 }),
    },
  ])
}

describe('the frame copies', () => {
  it.effect('a quiet break writes only what moves', () =>
    Effect.gen(function* () {
      const frames = yield* framesFrom(armedBreak, false)
      const { written, needless } = rewritesOver(frames)
      expect(needless).toEqual([])
      // NOTE: the break clock, the World's clock, and the run's stats once
      // a frame, and now and then the seat and a cosmetic: 886 fields over
      // 240 frames (3,107 before the copies were cut, 1,125 while the idle
      // clock counted up each frame).
      expect(written).toBeLessThanOrEqual(890)
    }),
  )

  it.effect(
    "a break with Rattles' hint up writes no more than a quiet one",
    () =>
      Effect.gen(function* () {
        const frames = yield* framesFrom(hintedBreak(), false)
        const { written, needless } = rewritesOver(frames)
        expect(
          Array.every(frames, ({ dareHint }) =>
            DareHintCall.isAnyOf(['Calling'])(dareHint.call),
          ),
        ).toBe(true)
        expect(needless).toEqual([])
        // NOTE: the hint keeps the time it ends, so a frame of it writes
        // nothing (it counted down each frame before: 1,125 fields).
        expect(written).toBeLessThanOrEqual(890)
      }),
  )

  it.effect('a wave under fire writes nothing it had already', () =>
    Effect.gen(function* () {
      const frames = yield* framesFrom(fightingWave(), true)
      const { written, needless } = rewritesOver(frames)
      expect(
        Array.some(frames, ({ bullets }) =>
          Array.isReadonlyArrayNonEmpty(bullets),
        ),
      ).toBe(true)
      expect(needless).toEqual([])
      // NOTE: 2125 fields over 240 frames (3,459 before the copies were cut).
      // What is left moves every tick (the zombies, the bullets, the clocks,
      // the stats, the particles).
      expect(written).toBeLessThanOrEqual(2125)
    }),
  )
})
