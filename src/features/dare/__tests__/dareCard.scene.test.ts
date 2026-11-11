import { Array } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import type { Model } from '../../../app/model'
import {
  DARE_CARD_ICON,
  DARE_CHECK,
  DARE_EMPTY_SLOTS,
  DARE_FOUND_SLOTS,
} from '../../../art/dareArt'
import { PocketCard } from '../../../domain/clientSchema'
import { cameraOf } from '../../../render/camera'
import { HUD_STRIP_HEIGHT, hudLayoutFor } from '../../../render/hudLayout'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
  type Screen,
} from '../../../render/screen'
import { hudShapes } from '../../../screens/game/hud'
import { pocketOf } from '../../../screens/game/pocket'
import { quietWave } from '../../../test/model.fixture'
import { type DareKind, DareThingState } from '../../../world/dare/dareSchema'
import { Phase } from '../../../world/schema/worldSchema'
import { type DarePocket, dareCardShapes, pocketBoxOf } from '../dareCard'

// The dare pocket on the HUD (src/features/dare/dareCard.ts): shut through a
// wave, a chip of the card and the count found; open in a break, one slot
// per thing on the list and the hat last, a silhouette until found, then in
// color with a check.

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
        state: Array.contains(found, kind)
          ? DareThingState.Found({ slot: 0 })
          : DareThingState.Hidden({ x: 40, y: 40 }),
      })),
  })

// NOTE: a break `msIn` ms in, its banner in the top band or the bottom one.
const inBreak = (model: Model, msIn: number, band: Model['hintBand']): Model =>
  modifyFields(model, {
    phase: () =>
      Phase.Preparation({
        wave: 3,
        remainingMs: 20_000 - msIn,
        durationMs: 20_000,
        spawns: [],
      }),
    pocketCard: () => PocketCard.Pocketed(),
    hintBand: () => band,
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

const ANY_KIND: ReadonlyArray<DareKind> = [...LIST, 'PartyHat']

const isAnySlot = (placed: Placed): boolean =>
  Array.some(
    ANY_KIND,
    kind =>
      isSlotIn(DARE_EMPTY_SLOTS)(kind)(placed) ||
      isSlotIn(DARE_FOUND_SLOTS)(kind)(placed),
  )

const slotsOf = (
  model: Model,
  screen: Screen,
  pocket: DarePocket,
): ReadonlyArray<Placed> =>
  Array.filter(
    placedImages(dareCardShapes(model, hudLayoutFor(screen), pocket)),
    isAnySlot,
  )

const NOWHERE: Placed = { x: 0, y: 0, src: '' }

describe('the dare pocket', () => {
  test('opens on each thing on the list as a silhouette, the hat last', () => {
    expect(srcOf(DARE_EMPTY_SLOTS.SilverSpoon)).not.toBe('')
    expect(srcOf(DARE_EMPTY_SLOTS.SilverSpoon)).not.toBe(
      srcOf(DARE_FOUND_SLOTS.SilverSpoon),
    )
    const slots = slotsOf(onTheHunt([]), LANDSCAPE_SCREEN, 'Open')
    expect(slots).toHaveLength(LIST.length + 1)
    Array.forEach(ANY_KIND, (kind, index) => {
      expect(isSlotIn(DARE_EMPTY_SLOTS)(kind)(slots[index] ?? NOWHERE)).toBe(
        true,
      )
    })
  })

  test('fills a slot in color with a check once its thing is found, and only that slot', () => {
    const model = onTheHunt(['FamilyPortrait'])
    const slots = slotsOf(model, LANDSCAPE_SCREEN, 'Open')
    expect(
      Array.filter(slots, placed =>
        Array.some(LIST, kind => isSlotIn(DARE_FOUND_SLOTS)(kind)(placed)),
      ),
    ).toHaveLength(1)
    expect(
      isSlotIn(DARE_FOUND_SLOTS)('FamilyPortrait')(slots[1] ?? NOWHERE),
    ).toBe(true)
    const checks = Array.filter(
      placedImages(
        dareCardShapes(model, hudLayoutFor(LANDSCAPE_SCREEN), 'Open'),
      ),
      ({ src }) => src === srcOf(DARE_CHECK),
    )
    expect(checks).toHaveLength(1)
  })

  test('shut, shows the card and no slots', () => {
    const shapes = placedImages(
      dareCardShapes(
        onTheHunt(['MusicBox']),
        hudLayoutFor(LANDSCAPE_SCREEN),
        'Shut',
      ),
    )
    expect(Array.filter(shapes, isAnySlot)).toEqual([])
    expect(Array.some(shapes, ({ src }) => src === srcOf(DARE_CARD_ICON))).toBe(
      true,
    )
  })

  test('is shut through a wave and under a banner, and open in a break', () => {
    const hunting = onTheHunt([])
    expect(pocketOf(hunting)).toBe('Shut')
    expect(pocketOf(inBreak(hunting, 0, 'Top'))).toBe('Shut')
    expect(pocketOf(inBreak(hunting, 5000, 'Bottom'))).toBe('Open')
    expect(
      pocketOf(
        modifyFields(inBreak(hunting, 5000, 'Bottom'), {
          pocketCard: () => PocketCard.Folding({ ageMs: 0 }),
        }),
      ),
    ).toBe('Shut')
  })

  test('sits on the screen in landscape and portrait, clear of the room while shut', () => {
    Array.forEach([LANDSCAPE_SCREEN, DEFAULT_PORTRAIT_SCREEN], screen => {
      const model = onTheHunt([])
      const layout = hudLayoutFor(screen)
      const shut = pocketBoxOf(model, layout, 'Shut')
      const open = pocketBoxOf(model, layout, 'Open')
      Array.forEach([shut, open], box => {
        expect(box.left).toBeGreaterThanOrEqual(0)
        expect(box.right).toBeLessThanOrEqual(screen.width)
        expect(box.top).toBeGreaterThanOrEqual(0)
      })
      // NOTE: shut, in the top strip in landscape and in the band in
      // portrait; open in portrait, under the band.
      const shutBottom =
        screen.layout === 'Landscape' ? HUD_STRIP_HEIGHT : screen.world.y
      expect(shut.bottom).toBeLessThanOrEqual(shutBottom)
      expect(open.top).toBeGreaterThanOrEqual(
        screen.layout === 'Portrait' ? screen.world.y : 0,
      )
    })
  })

  test('is drawn with the HUD in a run, and Endless has none', () => {
    const model = inBreak(onTheHunt([]), 5000, 'Bottom')
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
    expect(
      dareCardShapes(endless, hudLayoutFor(LANDSCAPE_SCREEN), 'Open'),
    ).toEqual([])
  })
})
