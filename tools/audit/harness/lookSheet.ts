import { Array } from 'effect'

import { UiStruct } from '@effect/ui'
import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '@game/app/component'
import { type Appearance, defaultAppearance } from '@game/app/model'
import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  ON_OFF,
  OUTFITS,
  PRINTS,
  SHIRT_COLORS,
  SKIN_TONES,
  playerSprites,
} from '@game/art/appearance'
import { frameAt, group } from '@game/art/sprite'
import { gunSprite } from '@game/art/sprites/guns'
import { overlayElement } from '@game/render/iso/overlayElement'
import { FLOOR_COLOR } from '@game/render/room/roomPalette'
import { SHADOW_COLOR } from '@game/shared/constants'

import * as Draw from '../../../src/render/draw'

const CELL_W = 12
const CELL_H = 16
const SHEET_W = 168
const SHEET_H = 268

const lookSheetShapes = (): Array<Draw.Shape> => {
  const shapes: Array<Draw.Shape> = [
    Draw.Rect({
      x: 0,
      y: 0,
      width: SHEET_W,
      height: SHEET_H,
      fill: FLOOR_COLOR,
    }),
  ]
  const draw = (
    appearance: Appearance,
    x: number,
    y: number,
    frames: 'walk' | 'idle',
    frame: number,
    facing: 'Left' | 'Right',
    tone: 'Normal' | 'Flash',
  ) => {
    const sprites = playerSprites(appearance)
    shapes.push(
      Draw.Rect({
        x: x - 3,
        y: y - 1,
        width: 7,
        height: 2,
        fill: SHADOW_COLOR,
      }),
      group({
        translate: { x, y },
        shapes: frameAt(sprites[frames], frame)[tone][facing],
      }),
      group({
        translate: { x: x + (facing === 'Right' ? 2 : -2), y: y - 5 },
        shapes: gunSprite('Pistol', 0, facing === 'Right' ? 0 : Math.PI),
      }),
    )
  }
  const base = defaultAppearance
  const rows: ReadonlyArray<ReadonlyArray<Appearance>> = [
    Array.map(BODIES, body => UiStruct.evolve(base, { body: () => body })),
    Array.map(BODIES, body =>
      UiStruct.evolve(base, {
        body: () => body,
        outfit: () => 'Dress',
        hairStyle: () => 'Long',
      }),
    ),
    Array.map(BODIES, body =>
      UiStruct.evolve(base, {
        body: () => body,
        outfit: () => 'Overalls',
        print: () => 'Rainbow',
        beard: () => true,
        glasses: () => true,
      }),
    ),
    Array.map(HAIR_STYLES, hairStyle =>
      UiStruct.evolve(base, { hairStyle: () => hairStyle }),
    ),
    Array.map(HAIR_COLORS, hairColor =>
      UiStruct.evolve(base, {
        hairColor: () => hairColor,
        hairStyle: () => 'Long',
      }),
    ),
    Array.map(SKIN_TONES, skinTone =>
      UiStruct.evolve(base, { skinTone: () => skinTone }),
    ),
    Array.map(SHIRT_COLORS, shirtColor =>
      UiStruct.evolve(base, { shirtColor: () => shirtColor }),
    ),
    Array.map(OUTFITS, outfit =>
      UiStruct.evolve(base, { outfit: () => outfit }),
    ),
    Array.map(PRINTS, print => UiStruct.evolve(base, { print: () => print })),
    Array.flatMap(OUTFITS, outfit =>
      Array.map(PRINTS, print =>
        UiStruct.evolve(base, {
          outfit: () => outfit,
          print: () => print,
          body: () => 'Slim',
        }),
      ),
    ),
    Array.flatMap(ON_OFF, beard =>
      Array.map(ON_OFF, glasses =>
        UiStruct.evolve(base, { beard: () => beard, glasses: () => glasses }),
      ),
    ),
  ]
  Array.forEach(rows, (row, r) =>
    Array.forEach(row, (appearance, c) =>
      draw(
        appearance,
        c * CELL_W + 8,
        r * CELL_H + 15,
        'idle',
        0,
        'Right',
        'Normal',
      ),
    ),
  )
  const samples: Array<Appearance> = [
    {
      ...base,
      body: 'Slim',
      hairStyle: 'Mohawk',
      hairColor: 'Pink',
      skinTone: 'Tan',
      outfit: 'Hoodie',
      print: 'Rainbow',
      glasses: true,
    },
    {
      ...base,
      body: 'Broad',
      hairStyle: 'Curly',
      hairColor: 'Black',
      skinTone: 'Deep',
      outfit: 'Overalls',
      shirtColor: 'Yellow',
      beard: true,
    },
    {
      ...base,
      body: 'Slim',
      hairStyle: 'Long',
      hairColor: 'Blonde',
      skinTone: 'Fair',
      outfit: 'Dress',
      shirtColor: 'Purple',
      print: 'Stripes',
    },
    {
      ...base,
      body: 'Broad',
      hairStyle: 'Bald',
      hairColor: 'Grey',
      skinTone: 'Brown',
      shirtColor: 'Red',
      beard: true,
      glasses: true,
    },
  ]
  Array.forEach(samples, (appearance, i) => {
    const y = rows.length * CELL_H + 18 + i * CELL_H
    Array.forEach([0, 1, 2, 3], f =>
      draw(appearance, 8 + f * CELL_W, y, 'walk', f, 'Right', 'Normal'),
    )
    Array.forEach([0, 1], f =>
      draw(appearance, 8 + (4 + f) * CELL_W, y, 'idle', f, 'Right', 'Normal'),
    )
    draw(appearance, 8 + 6 * CELL_W, y, 'walk', 0, 'Left', 'Normal')
    draw(appearance, 8 + 7 * CELL_W, y, 'idle', 0, 'Left', 'Normal')
    draw(appearance, 8 + 8 * CELL_W, y, 'idle', 0, 'Right', 'Flash')
  })
  return shapes
}

const SHEET_SHAPES = lookSheetShapes()

export const lookSheetView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.div
    .style({ background: '#000', padding: '8px' })
    .children(
      overlayElement(h)
        .key('look-sheet')
        .class('look-sheet')
        .picture({ width: SHEET_W, height: SHEET_H, shapes: SHEET_SHAPES }),
    )
