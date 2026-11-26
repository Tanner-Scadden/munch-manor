import { Array, Effect, Record, Result } from 'effect'

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
  FRAME_MS,
  holdFire,
  modelAfter,
  recordTicks,
  steps,
  ticks,
  zombieAt,
} from '../../test/testing'
import { DareThingState } from '../dare/dareSchema'
import { levelOf } from '../level/arena'
import { LIBRARY_ROOM_ID } from '../level/plan'
import { focusOf } from '../party/party'

const FRAMES = 240
const CHASE_SPEED = 40

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
  written: number
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
    return modelAfter(
      start,
      steps(
        ...(isFiring ? [holdFire] : []),
        ticks(5, FRAME_MS),
        recordTicks(FRAMES, FRAME_MS, frames),
      ),
    ).pipe(Effect.as<ReadonlyArray<Model>>(frames))
  })

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
      expect(written).toBeLessThanOrEqual(2125)
    }),
  )
})
