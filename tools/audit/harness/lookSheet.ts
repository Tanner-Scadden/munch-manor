// NOTE: the look sheet (`looksheet`): every look part's options on one
// canvas, and walk frames, facings, and the hit flash for a few mixed looks.

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
    BODIES.map(body => modifyFields(base, { body: () => body })),
    BODIES.map(body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Dress',
        hairStyle: () => 'Long',
      }),
    ),
    BODIES.map(body =>
      modifyFields(base, {
        body: () => body,
        outfit: () => 'Overalls',
        print: () => 'Rainbow',
        beard: () => true,
        glasses: () => true,
      }),
    ),
    HAIR_STYLES.map(hairStyle =>
      modifyFields(base, { hairStyle: () => hairStyle }),
    ),
    HAIR_COLORS.map(hairColor =>
      modifyFields(base, {
        hairColor: () => hairColor,
        hairStyle: () => 'Long',
      }),
    ),
    SKIN_TONES.map(skinTone =>
      modifyFields(base, { skinTone: () => skinTone }),
    ),
    SHIRT_COLORS.map(shirtColor =>
      modifyFields(base, { shirtColor: () => shirtColor }),
    ),
    OUTFITS.map(outfit => modifyFields(base, { outfit: () => outfit })),
    PRINTS.map(print => modifyFields(base, { print: () => print })),
    OUTFITS.flatMap(outfit =>
      PRINTS.map(print =>
        modifyFields(base, {
          outfit: () => outfit,
          print: () => print,
          body: () => 'Slim',
        }),
      ),
    ),
    ON_OFF.flatMap(beard =>
      ON_OFF.map(glasses =>
        modifyFields(base, { beard: () => beard, glasses: () => glasses }),
      ),
    ),
  ]
  rows.forEach((row, r) =>
    row.forEach((appearance, c) =>
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
  samples.forEach((appearance, i) => {
    const y = rows.length * CELL_H + 18 + i * CELL_H
    ;[0, 1, 2, 3].forEach(f =>
      draw(appearance, 8 + f * CELL_W, y, 'walk', f, 'Right', 'Normal'),
    )
    ;[0, 1].forEach(f =>
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
