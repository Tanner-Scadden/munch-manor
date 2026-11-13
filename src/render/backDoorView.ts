import { Option } from 'effect'
import type { Canvas } from 'foldkit'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  group,
  placeAt,
  spriteShapes,
} from '../art/sprite'
import { backDoorBoxOf, isBackDoorOpen } from '../world/kitchen/backDoor'
import { levelOf } from '../world/level/arena'
import type { World } from '../world/schema/world'
import { rect } from './drawing'

// The kitchen's back door to the garden (src/world/kitchen/backDoor.ts),
// set in the east wall's south corner: a plank door in its frame with a
// little EXIT sign over it. Shut and the sign dark while there is no way
// out; once a thing on the list is found, in a break, the sign glows green
// and the door stands ajar on a slice of moonlight. Fixed art is sprites
// built once here; only the sign's glow breathes, so it stays a rectangle.

const DOOR_PALETTE: Palette = {
  K: '#140c10',
  F: '#4a2c18',
  f: '#6a4426',
  P: '#8a5a30',
  p: '#a8743e',
  H: '#ffd23f',
  M: '#bcd8ff',
  m: '#6a8ab8',
}

// NOTE: 10 by 20, the wall tile's width and two rows tall: the frame, the
// planks run down, and the knob on the room's side.
const DOOR_SHUT: Sprite = spriteShapes(
  [
    'KKKKKKKKKK',
    'KFFFFFFFFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFffffffFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFHPPpPPFK',
    'KFHPPpPPFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFffffffFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFpPPpPPFK',
    'KFFFFFFFFK',
    'KKKKKKKKKK',
  ],
  DOOR_PALETTE,
  TOP_LEFT,
)

// NOTE: swung out a little: the leaf narrows and moonlight from the garden
// shows between it and the frame.
const DOOR_AJAR: Sprite = spriteShapes(
  [
    'KKKKKKKKKK',
    'KFMMMFFFFK',
    'KFMMmpPPFK',
    'KFMmMpPPFK',
    'KFMMmpPPFK',
    'KFMmMpPPFK',
    'KFMMmfffFK',
    'KFMmMpPPFK',
    'KFMMmpPPFK',
    'KFMmMHPPFK',
    'KFMMmHPPFK',
    'KFMmMpPPFK',
    'KFMMmpPPFK',
    'KFMmMfffFK',
    'KFMMmpPPFK',
    'KFMmMpPPFK',
    'KFMMmpPPFK',
    'KFMmMpPPFK',
    'KFMMMFFFFK',
    'KKKKKKKKKK',
  ],
  DOOR_PALETTE,
  TOP_LEFT,
)

const SIGN_PALETTE: Palette = {
  K: '#140c10',
  G: '#3fe07a',
  g: '#c8ffd8',
  D: '#1a4a2a',
  d: '#2a6a3a',
}

// NOTE: a little running figure on a green plate, 9 by 6, the way every
// exit in the world says EXIT without a word.
const SIGN_LIT: Sprite = spriteShapes(
  [
    'KKKKKKKKK',
    'KGGGgGGGK',
    'KGGgggGgK',
    'KGGGgGGGK',
    'KGGgGgGGK',
    'KKKKKKKKK',
  ],
  SIGN_PALETTE,
  TOP_LEFT,
)

const SIGN_DARK: Sprite = spriteShapes(
  [
    'KKKKKKKKK',
    'KDDDdDDDK',
    'KDDdddDdK',
    'KDDDdDDDK',
    'KDDdDdDDK',
    'KKKKKKKKK',
  ],
  SIGN_PALETTE,
  TOP_LEFT,
)

const SIGN_LIFT_PX = 8
const GLOW_PAD_PX = 3
const GLOW_PERIOD_MS = 900
const GLOW_COLOR = '#3fe07a'

const glowShapes = (
  x: number,
  y: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => [
  group({
    opacity: 0.18 + 0.1 * Math.sin((elapsedMs / GLOW_PERIOD_MS) * Math.PI * 2),
    shapes: [
      rect(
        x - GLOW_PAD_PX,
        y - GLOW_PAD_PX,
        9 + GLOW_PAD_PX * 2,
        6 + GLOW_PAD_PX * 2,
        GLOW_COLOR,
      ),
    ],
  }),
]

// NOTE: drawn on the ground, under the actors, once the kitchen is open.
export const backDoorGroundShapes = (
  world: World,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(backDoorBoxOf(levelOf(world)), {
    onNone: () => [],
    onSome: box => {
      const isOpen = isBackDoorOpen(world)
      const signY = box.top - SIGN_LIFT_PX
      return [
        placeAt(box.left, box.top, isOpen ? DOOR_AJAR : DOOR_SHUT),
        ...(isOpen ? glowShapes(box.left, signY, world.elapsedMs) : []),
        placeAt(box.left, signY, isOpen ? SIGN_LIT : SIGN_DARK),
      ]
    },
  })
