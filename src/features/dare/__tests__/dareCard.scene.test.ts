import { Array } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../../app/model'
import {
  DARE_EMPTY_SLOTS,
  DARE_FOUND_SLOTS,
  DARE_SLOT_SIZE,
} from '../../../art/dareArt'
import { cameraOf } from '../../../render/camera'
import { HUD_STRIP_HEIGHT, hudLayoutFor } from '../../../render/hudLayout'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
  type Screen,
} from '../../../render/screen'
import { hudShapes } from '../../../screens/game/hud'
import { quietWave } from '../../../test/model.fixture'
import { type DareKind, DareThingState } from '../../../world/dare/dareSchema'
import { dareCardShapes } from '../dareCard'

// The dare card on the HUD (src/features/dare/dareCard.ts): one slot per
// thing on the list and the hat last, each an empty outline until found.

const LIST: ReadonlyArray<DareKind> = [
  'SilverSpoon',
  'FamilyPortrait',
  'MusicBox',
]

const onTheHunt = (found: ReadonlyArray<DareKind>): Model =>
  modifyFields(quietWave(3), {
    dare: dare => modifyFields(dare, { list: () => LIST }),
    dareThings: () =>
      Array.map(LIST, (kind, id) => ({
        id,
        kind,
        isAsked: true,
        state: Array.contains(found, kind)
          ? DareThingState.Found({ slot: 0 })
          : DareThingState.Hidden({ x: 40, y: 40 }),
      })),
  })

type Placed = Readonly<{ x: number; y: number; src: string }>

const placedImages = (
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Placed> =>
  Array.flatMap(shapes, shape =>
    shape._tag === 'Image' ? [{ x: shape.x, y: shape.y, src: shape.src }] : [],
  )

const srcOf = (sprite: ReadonlyArray<Canvas.Shape>): string =>
  Array.match(placedImages(sprite), {
    onEmpty: () => '',
    onNonEmpty: ([first]) => first.src,
  })

const isSlotIn =
  (sprites: Readonly<Record<DareKind, ReadonlyArray<Canvas.Shape>>>) =>
  (kind: DareKind) =>
  ({ src }: Placed): boolean =>
    src === srcOf(sprites[kind])

const cardOf = (model: Model, screen: Screen): ReadonlyArray<Placed> =>
  placedImages(dareCardShapes(model, hudLayoutFor(screen)))

describe('the dare card', () => {
  test('shows each thing on the list as an empty outline, the hat last', () => {
    expect(srcOf(DARE_EMPTY_SLOTS.SilverSpoon)).not.toBe('')
    expect(srcOf(DARE_EMPTY_SLOTS.SilverSpoon)).not.toBe(
      srcOf(DARE_FOUND_SLOTS.SilverSpoon),
    )
    const card = cardOf(onTheHunt([]), LANDSCAPE_SCREEN)
    expect(card).toHaveLength(LIST.length + 1)
    Array.forEach([...LIST, 'PartyHat' as const], (kind, index) => {
      expect(
        isSlotIn(DARE_EMPTY_SLOTS)(kind)(
          card[index] ?? { x: 0, y: 0, src: '' },
        ),
      ).toBe(true)
    })
  })

  test('fills a slot once its thing is found, and only that slot', () => {
    const card = cardOf(onTheHunt(['FamilyPortrait']), LANDSCAPE_SCREEN)
    const found = Array.filter(card, placed =>
      Array.some(LIST, kind => isSlotIn(DARE_FOUND_SLOTS)(kind)(placed)),
    )
    expect(found).toHaveLength(1)
    expect(
      isSlotIn(DARE_FOUND_SLOTS)('FamilyPortrait')(
        card[1] ?? { x: 0, y: 0, src: '' },
      ),
    ).toBe(true)
    expect(
      isSlotIn(DARE_EMPTY_SLOTS)('SilverSpoon')(
        card[0] ?? { x: 0, y: 0, src: '' },
      ),
    ).toBe(true)
  })

  test('sits in a row on the screen in landscape and portrait, clear of the top strip', () => {
    Array.forEach([LANDSCAPE_SCREEN, DEFAULT_PORTRAIT_SCREEN], screen => {
      const card = cardOf(onTheHunt([]), screen)
      expect(new Set(Array.map(card, ({ y }) => y)).size).toBe(1)
      Array.forEach(card, ({ x, y }) => {
        expect(x).toBeGreaterThanOrEqual(0)
        expect(x + DARE_SLOT_SIZE).toBeLessThanOrEqual(screen.width)
        expect(y + DARE_SLOT_SIZE).toBeLessThanOrEqual(
          screen.world.y + screen.world.height,
        )
      })
      // NOTE: under the strip in landscape, over the world in portrait.
      const top = screen.layout === 'Landscape' ? HUD_STRIP_HEIGHT : 0
      const bottom =
        screen.layout === 'Landscape' ? screen.height : screen.world.y
      Array.forEach(card, ({ y }) => {
        expect(y).toBeGreaterThanOrEqual(top)
        expect(y + DARE_SLOT_SIZE).toBeLessThanOrEqual(bottom)
      })
    })
  })

  test('is drawn with the HUD in a run, and Endless has none', () => {
    const model = onTheHunt([])
    const hud = placedImages(
      hudShapes(model, LANDSCAPE_SCREEN, cameraOf(model)),
    )
    expect(
      Array.filter(hud, isSlotIn(DARE_EMPTY_SLOTS)('PartyHat')),
    ).toHaveLength(1)
    const endless = modifyFields(model, {
      dare: dare => modifyFields(dare, { list: () => [] }),
      dareThings: () => [],
    })
    expect(cardOf(endless, LANDSCAPE_SCREEN)).toEqual([])
  })
})
