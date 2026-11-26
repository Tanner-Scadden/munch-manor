import { Option } from 'effect'

import {
  type Palette,
  type Sprite,
  TOP_LEFT,
  deepSprite,
  glowingSprite,
  group,
  placeAt,
  spriteShapes,
} from '../art/sprite'
import { backDoorBoxOf, isBackDoorOpen } from '../world/kitchen/backDoor'
import { levelOf } from '../world/level/arena'
import type { World } from '../world/schema/world'
import type { Drawable } from './depth'
import type * as Draw from './draw'
import { rect } from './drawing'

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

const DOOR_DEPTH = { most: 2 }
const SIGN_DEPTH = { most: 1 }

const DOOR_SHUT: Sprite = deepSprite(
  spriteShapes(
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
  ),
  DOOR_DEPTH,
)

const DOOR_AJAR: Sprite = deepSprite(
  spriteShapes(
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
  ),
  DOOR_DEPTH,
)

const SIGN_PALETTE: Palette = {
  K: '#140c10',
  G: '#3fe07a',
  g: '#c8ffd8',
  D: '#1a4a2a',
  d: '#2a6a3a',
}

const SIGN_LIT: Sprite = glowingSprite(
  deepSprite(
    spriteShapes(
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
    ),
    SIGN_DEPTH,
  ),
)

const SIGN_DARK: Sprite = deepSprite(
  spriteShapes(
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
  ),
  SIGN_DEPTH,
)

const DOOR_WIDTH = 10
const SIGN_LIFT_PX = 8
const GLOW_PAD_PX = 3
const GLOW_PERIOD_MS = 900
const GLOW_COLOR = '#3fe07a'

const glowShapes = (
  x: number,
  y: number,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> => [
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

export const backDoorDrawables = (world: World): ReadonlyArray<Drawable> =>
  Option.match(backDoorBoxOf(levelOf(world)), {
    onNone: () => [],
    onSome: box => {
      const isOpen = isBackDoorOpen(world)
      const left = box.left - DOOR_WIDTH
      const signY = box.top - SIGN_LIFT_PX
      return [
        {
          footY: box.bottom,
          rank: 'Prop',
          shapes: [
            placeAt(left, box.top, isOpen ? DOOR_AJAR : DOOR_SHUT),
            placeAt(left, signY, isOpen ? SIGN_LIT : SIGN_DARK),
          ],
        },
        ...(isOpen
          ? [
              {
                footY: box.bottom - 1,
                rank: 'Glow' as const,
                shapes: glowShapes(left, signY, world.elapsedMs),
              },
            ]
          : []),
      ]
    },
  })
