import { Array, Match, Option } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { type Model, Phase } from '../../../app/model'
import { PICTURE_HEIGHT, PICTURE_WIDTH } from '../../../art/introArt'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
  type Screen,
} from '../../../render/screen'
import { readyModel } from '../../../test/model.fixture'
import { FRIEND_LINES } from '../../../world/names'
import { ARRIVAL_MS } from '../../../world/run/arrival'
import type { IntroCut } from '../../../world/schema/worldSchema'
import { introFrameAt } from '../introBeat'
import { introShapes, widestFriendBubble } from '../introView'

// The intro's drawing on either screen: every beat of either cut covers the
// whole screen, and its picture sits inside it at a whole scale.

const arrivingAt = (cut: IntroCut, elapsedMs: number): Model =>
  modifyFields(readyModel, {
    phase: () => Phase.Arriving({ elapsedMs, cut }),
  })

const EVERY_FRAME_MS = 250

const momentsOf = (cut: IntroCut): ReadonlyArray<number> =>
  Array.makeBy(
    Math.floor(ARRIVAL_MS[cut] / EVERY_FRAME_MS),
    index => index * EVERY_FRAME_MS,
  )

const groupOf = (shape: Canvas.Shape | undefined) =>
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

  // NOTE: the shapes in the picture at `ms` into `cut`, with and without the
  // friends' line.
  const pictureCount = (cut: IntroCut, ms: number, hasLine: boolean) =>
    groupOf(
      groupOf(
        introShapes(
          modifyFields(arrivingAt(cut, ms), {
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
    // NOTE: the full cut said it in the car; its knock is the house's.
    expect(pictureCount('Full', 8_000, true)).toBe(
      pictureCount('Full', 8_000, false),
    )
  })

  test('draws nothing once the run has started', () => {
    expect(introShapes(readyModel, LANDSCAPE_SCREEN)).toEqual([])
  })
})
