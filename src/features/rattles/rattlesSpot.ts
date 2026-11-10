import type { Array } from 'effect'
import { Function } from 'effect'
import { Canvas } from 'foldkit'

import { GLYPH_SPRITES } from '../../art/font'
import {
  AWAKE_FACE,
  BLINK_FACE,
  RATTLES_PALETTE,
  rattlesPixels,
} from '../../art/rattlesArt'
import {
  type Sprite,
  TOP_LEFT,
  bakeShapes,
  group,
  placeAt,
  spriteShapes,
} from '../../art/sprite'
import { RATTLES_BOX } from '../../world/level/arena'

// Rattles' spot in the parlour (docs/ESCAPE_PLAN.md, layer 7): his stall
// went with the shop, and the first daredevil, from 1924, sits where it
// stood on an old steamer trunk, awake and swaying in a break, dozing
// through a wave. His speech bubble of hints hangs over him
// (src/screens/game/stallBubble.ts).

// PALETTE

const TRUNK_TOP_COLOR = '#6b4423'
const TRUNK_LID_EDGE_COLOR = '#8a5a2b'
const TRUNK_FRONT_COLOR = '#4f311a'
const TRUNK_STRAP_COLOR = '#2b1d12'
const TRUNK_CLASP_COLOR = '#c9a227'
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'
const BONE_COLOR = '#f4f1de'

const AWAKE_FRAME_MS = 280
const AWAKE_FRAMES = 8
const BLINK_FRAME = 7
const SLEEP_FRAME_MS = 900
const SNORE_RISE_PX = 5
const SNORE_CYCLE_MS = 1800
const SLEEP_SINK_PX = 5

const rect = (
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
): Canvas.Shape => Canvas.Rect({ x, y, width, height, fill })

const { left, top } = RATTLES_BOX
const width = RATTLES_BOX.right - RATTLES_BOX.left
const height = RATTLES_BOX.bottom - RATTLES_BOX.top
const centerX = left + Math.floor(width / 2)

// THE TRUNK

const TRUNK_TOP = top + 6

const TRUNK: ReadonlyArray<Canvas.Shape> = [
  rect(left, TRUNK_TOP, width, 3, TRUNK_TOP_COLOR),
  rect(left, TRUNK_TOP, width, 1, TRUNK_LID_EDGE_COLOR),
  rect(left, TRUNK_TOP + 3, width, height - 9, TRUNK_FRONT_COLOR),
  rect(left + 3, TRUNK_TOP, 2, height - 6, TRUNK_STRAP_COLOR),
  rect(left + width - 5, TRUNK_TOP, 2, height - 6, TRUNK_STRAP_COLOR),
  rect(centerX - 1, TRUNK_TOP + 3, 3, 3, TRUNK_CLASP_COLOR),
]

const SHADOW = rect(left + 2, top + height, width - 2, 2, SHADOW_COLOR)

// RATTLES

const RATTLES_WIDTH = 9
const RATTLES_LEFT = centerX - Math.floor(RATTLES_WIDTH / 2)
const RATTLES_TOP = top - 6

const RATTLES_AWAKE: Sprite = spriteShapes(
  rattlesPixels(AWAKE_FACE),
  RATTLES_PALETTE,
  TOP_LEFT,
)

const RATTLES_BLINK: Sprite = spriteShapes(
  rattlesPixels(BLINK_FACE),
  RATTLES_PALETTE,
  TOP_LEFT,
)

// NOTE: his bony hands rest on the trunk's lid, in front of him.
const HANDS: ReadonlyArray<Canvas.Shape> = [
  rect(left + 5, TRUNK_TOP - 1, 3, 2, BONE_COLOR),
  rect(left + width - 8, TRUNK_TOP - 1, 3, 2, BONE_COLOR),
]

// NOTE: the trunk and his hands never move, so they are one baked image.
const TRUNK_FRONT = bakeShapes([...TRUNK, ...HANDS])

const awake = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const frame = Math.floor(elapsedMs / AWAKE_FRAME_MS) % AWAKE_FRAMES
  return [
    placeAt(
      RATTLES_LEFT,
      RATTLES_TOP + (frame < AWAKE_FRAMES / 2 ? 0 : 1),
      frame === BLINK_FRAME ? RATTLES_BLINK : RATTLES_AWAKE,
    ),
  ]
}

const dozing = (elapsedMs: number): ReadonlyArray<Canvas.Shape> => {
  const breath = Math.floor(elapsedMs / SLEEP_FRAME_MS) % 2
  const snore = (elapsedMs % SNORE_CYCLE_MS) / SNORE_CYCLE_MS
  return [
    placeAt(RATTLES_LEFT, RATTLES_TOP + SLEEP_SINK_PX + breath, RATTLES_BLINK),
    group({
      translate: {
        x: RATTLES_LEFT + RATTLES_WIDTH + 1,
        y: Math.round(top - 2 - snore * SNORE_RISE_PX),
      },
      opacity: 1 - snore,
      shapes: GLYPH_SPRITES.Damage.Z,
    }),
  ]
}

// SCENE

export type RattlesLook = 'Awake' | 'Dozing'

export const RATTLES_LOOKS: Array.NonEmptyReadonlyArray<RattlesLook> = [
  'Awake',
  'Dozing',
]

export const RATTLES_FOOT_Y = RATTLES_BOX.bottom

export const RATTLES_GROUND_SHAPES: ReadonlyArray<Canvas.Shape> = [SHADOW]

export const rattlesShapes: {
  (elapsedMs: number): (look: RattlesLook) => ReadonlyArray<Canvas.Shape>
  (look: RattlesLook, elapsedMs: number): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (look: RattlesLook, elapsedMs: number): ReadonlyArray<Canvas.Shape> => [
    ...(look === 'Awake' ? awake(elapsedMs) : dozing(elapsedMs)),
    ...TRUNK_FRONT,
  ],
)
