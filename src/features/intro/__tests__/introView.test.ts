import { Array, Match, Option } from 'effect'
import { describe, expect, test } from 'vitest'

import { UiStruct } from '@effect/ui'

import { type Model, Phase } from '#app/model.ts'
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '#art/introArt.ts'
import { introFrameAt } from '#features/intro/introBeat.ts'
import { introShapes, widestFriendBubble } from '#features/intro/introView.ts'
import type * as Draw from '#render/draw.ts'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
  type Screen,
} from '#render/screen.ts'
import { readyModel } from '#test/model.fixture.ts'
import { FRIEND_LINES } from '#world/names.ts'
import { ARRIVAL_MS } from '#world/run/arrival.ts'
import type { IntroCut } from '#world/schema/worldSchema.ts'

const arrivingAt = (cut: IntroCut, elapsedMs: number): Model =>
  UiStruct.evolve(readyModel, {
    phase: () => Phase.Arriving({ elapsedMs, cut }),
  })

const EVERY_FRAME_MS = 250

const momentsOf = (cut: IntroCut): ReadonlyArray<number> =>
  Array.makeBy(
    Math.floor(ARRIVAL_MS[cut] / EVERY_FRAME_MS),
    index => index * EVERY_FRAME_MS,
  )

const groupOf = (shape: Draw.Shape | undefined) =>
  Match.value(shape).pipe(
    Match.when({ _tag: 'Group' }, group => group),
    Match.orElse(() => undefined),
  )

const SCREENS: ReadonlyArray<Screen> = [
  LANDSCAPE_SCREEN,
  DEFAULT_PORTRAIT_SCREEN,
]
const CUTS: ReadonlyArray<IntroCut> = ['Full', 'Short']

describe('the intro drawn', () => {
  test('the full cut has every beat, the short one the knock and the slam', () => {
    const beatsOf = (cut: IntroCut) =>
      Array.dedupe(Array.map(momentsOf(cut), ms => introFrameAt(cut, ms).beat))
    expect(beatsOf('Full')).toEqual([
      'Drive',
      'Driveway',
      'Steps',
      'Knock',
      'Coats',
      'Hello',
      'Slam',
    ])
    expect(beatsOf('Short')).toEqual(['Knock', 'Slam'])
  })

  test.each(SCREENS)('covers the $layout screen at every moment', screen => {
    Array.forEach(CUTS, cut =>
      Array.forEach(momentsOf(cut), ms => {
        const outer = groupOf(introShapes(arrivingAt(cut, ms), screen)[0])
        const backdrop = outer?.shapes[0]
        const picture = groupOf(outer?.shapes[1])
        expect(backdrop).toMatchObject({
          _tag: 'Rect',
          x: 0,
          y: 0,
          width: screen.width,
          height: screen.height,
        })
        const scale = picture?.scale?.x ?? 1
        expect(Number.isInteger(scale)).toBe(true)
        expect(picture?.translate?.x).toBeGreaterThanOrEqual(0)
        expect(picture?.translate?.y).toBeGreaterThanOrEqual(0)
        expect(
          (picture?.translate?.x ?? 0) + PICTURE_WIDTH * scale,
        ).toBeLessThanOrEqual(screen.width)
        expect(
          (picture?.translate?.y ?? 0) + PICTURE_HEIGHT * scale,
        ).toBeLessThanOrEqual(screen.height)
      }),
    )
  })

  test("every friends' line fits the picture", () => {
    expect(widestFriendBubble()).toBeLessThanOrEqual(PICTURE_WIDTH - 4)
  })

  const pictureCount = (cut: IntroCut, ms: number, hasLine: boolean) =>
    groupOf(
      groupOf(
        introShapes(
          UiStruct.evolve(arrivingAt(cut, ms), {
            maybeCarLine: () =>
              hasLine ? Option.some(FRIEND_LINES.Munched[0]) : Option.none(),
          }),
          LANDSCAPE_SCREEN,
        )[0],
      )?.shapes[1],
    )?.shapes.length ?? 0

  test("the friends' line: over the car in the drive, over the knock in the short cut", () => {
    expect(pictureCount('Full', 2_000, true)).toBeGreaterThan(
      pictureCount('Full', 2_000, false),
    )
    expect(pictureCount('Short', 600, true)).toBeGreaterThan(
      pictureCount('Short', 600, false),
    )
    expect(pictureCount('Full', 8_000, true)).toBe(
      pictureCount('Full', 8_000, false),
    )
  })

  test('draws nothing once the run has started', () => {
    expect(introShapes(readyModel, LANDSCAPE_SCREEN)).toEqual([])
  })
})
