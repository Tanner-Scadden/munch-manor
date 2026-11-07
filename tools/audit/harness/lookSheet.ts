// NOTE: the look sheet (`looksheet`): every look part's options on one
// canvas, and walk frames, facings, and the hit flash for a few mixed looks.

import { Array } from 'effect'
import { Canvas } from 'foldkit'
import { type Document } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

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
} from '@game/appearance'
import type { ApplicationComposition } from '@game/composition'
import { SHADOW_COLOR } from '@game/constants'
import { type Appearance, defaultAppearance } from '@game/model'
import { FLOOR_COLOR } from '@game/roomPalette'
import { frameAt, group } from '@game/sprite'
import { gunSprite } from '@game/sprites/guns'

export type ViewHtml = Parameters<
  Parameters<typeof ApplicationComposition.makeView>[0]
>[1]

const CELL_W = 12
const CELL_H = 16
const SHEET_W = 168
const SHEET_H = 268

// NOTE: the look sheet: one row per part, each option of it on the classic
// look (the bodies three times: in a tee, in a dress, and in overalls with
// the Rainbow print, a beard, and glasses), then walk frames, both facings,
// and the hit flash for four mixed looks.
const lookSheetShapes = (): Array<Canvas.Shape> => {
  const shapes: Array<Canvas.Shape> = [
    Canvas.Rect({
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
      Canvas.Rect({
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
    Array.map(BODIES, body => modifyFields(base, { body: () => body })),
    Array.map(BODIES, body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Dress',
        hairStyle: () => 'Long',
      }),
    ),
    Array.map(BODIES, body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Overalls',
        print: () => 'Rainbow',
        beard: () => true,
        glasses: () => true,
      }),
    ),
    Array.map(HAIR_STYLES, hairStyle =>
      modifyFields(base, { hairStyle: () => hairStyle }),
    ),
    Array.map(HAIR_COLORS, hairColor =>
      modifyFields(base, {
        hairColor: () => hairColor,
        hairStyle: () => 'Long',
      }),
    ),
    Array.map(SKIN_TONES, skinTone =>
      modifyFields(base, { skinTone: () => skinTone }),
    ),
    Array.map(SHIRT_COLORS, shirtColor =>
      modifyFields(base, { shirtColor: () => shirtColor }),
    ),
    Array.map(OUTFITS, outfit => modifyFields(base, { outfit: () => outfit })),
    Array.map(PRINTS, print => modifyFields(base, { print: () => print })),
    Array.flatMap(OUTFITS, outfit =>
      Array.map(PRINTS, print =>
        modifyFields(base, {
          outfit: () => outfit,
          print: () => print,
          body: () => 'Slim',
        }),
      ),
    ),
    Array.flatMap(ON_OFF, beard =>
      Array.map(ON_OFF, glasses =>
        modifyFields(base, { beard: () => beard, glasses: () => glasses }),
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

export const lookSheetView = (h: ViewHtml): Document => ({
  title: 'Looks',
  body: h.div(
    [h.Style({ background: '#000', padding: '8px' })],
    [
      Canvas.view(
        {
          width: SHEET_W,
          height: SHEET_H,
          shapes: lookSheetShapes(),
          className: 'look-sheet',
        },
        h,
      ),
    ],
  ),
})
