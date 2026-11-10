import { Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { type Sprite, TOP_LEFT, placeAt, spriteShapes } from '../../art/sprite'
import { type Camera, worldToView } from '../../render/camera'
import { rect } from '../../render/drawing'
import { hudLayoutFor } from '../../render/hudLayout'
import type { Screen } from '../../render/screen'
import { Finale } from '../../world/dare/dareSchema'
import { isFrontDoorOpen, unlockShareOf } from '../../world/dare/finale'
import { levelOf } from '../../world/level/arena'
import { clamp } from '../../world/step/geometry'

// The front door in the finale (src/world/dare/finale.ts), over its baked
// art (src/render/room/diningArt.ts): while it unlocks, a bar over the
// lintel fills gold and the padlock blinks; once it is open, the leaves are
// gone and the night outside shows through, with a warm spill on the sill.

const BAR_HEIGHT = 2
const BAR_RISE = 7
const BLINK_MS = 400
const TRACK_COLOR = 'rgba(10, 8, 14, 0.8)'
const FILL_COLOR = '#ffd23f'
const GLINT_COLOR = '#fff7d0'
const NIGHT_COLOR = '#0b0a1a'
const STARLIGHT_COLOR = '#2a2850'
const SPILL_COLOR = 'rgba(255, 210, 120, 0.35)'

export const frontDoorShapes = (model: Model): ReadonlyArray<Canvas.Shape> => {
  if (Finale.isAnyOf(['Hunting', 'Summoned'])(model.dare.finale)) {
    return []
  }
  const { box } = levelOf(model).thresholds.Front
  const width = box.right - box.left
  const height = box.bottom - box.top
  if (isFrontDoorOpen(model)) {
    return [
      rect(box.left, box.top, width, height, NIGHT_COLOR),
      rect(box.left + 2, box.top + 2, width - 4, 1, STARLIGHT_COLOR),
      rect(box.left, box.top - 3, width, 3, SPILL_COLOR),
    ]
  }
  const middle = box.left + Math.floor(width / 2)
  return [
    rect(box.left, box.top - BAR_RISE, width, BAR_HEIGHT, TRACK_COLOR),
    rect(
      box.left,
      box.top - BAR_RISE,
      Math.round(width * unlockShareOf(model)),
      BAR_HEIGHT,
      FILL_COLOR,
    ),
    ...(Math.floor(model.elapsedMs / BLINK_MS) % 2 === 0
      ? [rect(middle - 1, box.top + 3, 3, 3, GLINT_COLOR)]
      : []),
  ]
}

// THE DOOR'S MARKER

// NOTE: while the door unlocks and once it is open, a door out of sight
// (in another room, past the window's edge, or under the gun slots) gets a
// marker pinned to the window's edge toward it: the door with its padlock,
// or open on the night, its bar under it, and an arrow at the door. It
// points at the way out, never at a zombie (GAME_DESIGN.md, "No off-screen
// hints").

const MARKER_OUTLINE = '#140c10'
const MARKER_PALETTE = {
  O: MARKER_OUTLINE,
  W: '#6a3e24',
  N: NIGHT_COLOR,
  S: STARLIGHT_COLOR,
  Y: FILL_COLOR,
  K: MARKER_OUTLINE,
}

const LOCKED_DOOR_ICON: Sprite = spriteShapes(
  [
    'OOOOOOOOO',
    'OWWWOWWWO',
    'OWWWOWWWO',
    'OWWWOWWWO',
    'OWWYYYWWO',
    'OWWYKYWWO',
    'OWWYYYWWO',
    'OWWWOWWWO',
    'OOOOOOOOO',
  ],
  MARKER_PALETTE,
  TOP_LEFT,
)

const OPEN_DOOR_ICON: Sprite = spriteShapes(
  [
    'OOOOOOOOO',
    'ONNNNNNNO',
    'ONSNNNSNO',
    'ONNNNNNNO',
    'ONNNSNNNO',
    'ONNNNNNNO',
    'ONNNNNNNO',
    'OYYYYYYYO',
    'OOOOOOOOO',
  ],
  MARKER_PALETTE,
  TOP_LEFT,
)

type Pointing = 'Down' | 'Left' | 'Right'

const ARROW_PIXELS: Readonly<Record<Pointing, ReadonlyArray<string>>> = {
  Down: ['YYYYY', '.YYY.', '..Y..'],
  Left: ['..Y', '.YY', 'YYY', '.YY', '..Y'],
  Right: ['Y..', 'YY.', 'YYY', 'YY.', 'Y..'],
}

const ARROWS: Readonly<Record<Pointing, Sprite>> = {
  Down: spriteShapes(ARROW_PIXELS.Down, MARKER_PALETTE, TOP_LEFT),
  Left: spriteShapes(ARROW_PIXELS.Left, MARKER_PALETTE, TOP_LEFT),
  Right: spriteShapes(ARROW_PIXELS.Right, MARKER_PALETTE, TOP_LEFT),
}

const ICON_SIZE = 9
const ARROW_SIDE_WIDTH = 3
const ARROW_DOWN_WIDTH = 5
const MARKER_PAD = 2
const MARKER_WIDTH = ICON_SIZE + MARKER_PAD * 2
const MARKER_HEIGHT = ICON_SIZE + BAR_HEIGHT + 1 + MARKER_PAD * 2
const MARKER_EDGE_GAP = 2
const ARROW_GAP = 1
const MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
// NOTE: the top HUD rows over a landscape window, which a marker keeps
// clear of.
const MARKER_TOP_CLEARANCE = 22
const KEY_CAP_CLEARANCE = 4
// NOTE: the door is in sight while its padlock and the bar over it are:
// the rows from the bar down to the padlock's foot, either side of its
// middle.
const PADLOCK_ROWS = 6
const PADLOCK_HALF_WIDTH = 4

const isFinaleAtDoor = (model: Model): boolean =>
  Finale.isAnyOf(['Unlocking', 'Open'])(model.dare.finale)

// NOTE: where the window shows the world clear of the HUD, in screen
// pixels: the gun slots and their key caps cover its bottom in landscape.
const clearWindowOf = (
  screen: Screen,
): Readonly<{ left: number; top: number; right: number; bottom: number }> => {
  const window = screen.world
  const top =
    screen.layout === 'Landscape'
      ? window.y + MARKER_TOP_CLEARANCE
      : window.y + MARKER_EDGE_GAP
  return {
    left: window.x + MARKER_EDGE_GAP,
    top,
    right: window.x + window.width - MARKER_EDGE_GAP,
    bottom:
      Math.min(
        window.y + window.height,
        hudLayoutFor(screen).slotTop - KEY_CAP_CLEARANCE,
      ) - MARKER_EDGE_GAP,
  }
}

export const frontDoorMarkerShapes: {
  (
    screen: Screen,
    camera: Camera,
  ): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  3,
  (
    model: Model,
    screen: Screen,
    camera: Camera,
  ): ReadonlyArray<Canvas.Shape> => {
    if (!isFinaleAtDoor(model)) {
      return []
    }
    const { box } = levelOf(model).thresholds.Front
    const topLeft = worldToView(camera, { x: box.left, y: box.top - BAR_RISE })
    const bottomRight = worldToView(camera, {
      x: box.right,
      y: box.top + PADLOCK_ROWS,
    })
    const clear = clearWindowOf(screen)
    const centerX = Math.round((topLeft.x + bottomRight.x) / 2)
    const isInSight =
      centerX - PADLOCK_HALF_WIDTH >= clear.left &&
      centerX + PADLOCK_HALF_WIDTH <= clear.right &&
      topLeft.y >= clear.top &&
      bottomRight.y <= clear.bottom
    if (isInSight) {
      return []
    }
    const arrowHeight = ARROW_PIXELS.Down.length
    const maxTop = clear.bottom - MARKER_HEIGHT - arrowHeight - ARROW_GAP
    const isBelow = topLeft.y > maxTop
    const left = Math.round(
      clamp(
        centerX - MARKER_WIDTH / 2,
        clear.left + ARROW_SIDE_WIDTH + ARROW_GAP,
        clear.right - MARKER_WIDTH - ARROW_SIDE_WIDTH - ARROW_GAP,
      ),
    )
    const top = Math.round(clamp(topLeft.y, clear.top, maxTop))
    const pointing: Pointing = isBelow
      ? 'Down'
      : centerX < left
        ? 'Left'
        : 'Right'
    const arrowAt = {
      Down: {
        x: left + Math.floor((MARKER_WIDTH - ARROW_DOWN_WIDTH) / 2),
        y: top + MARKER_HEIGHT + ARROW_GAP,
      },
      Left: {
        x: left - ARROW_SIDE_WIDTH - ARROW_GAP,
        y: top + Math.floor((MARKER_HEIGHT - ARROW_PIXELS.Left.length) / 2),
      },
      Right: {
        x: left + MARKER_WIDTH + ARROW_GAP,
        y: top + Math.floor((MARKER_HEIGHT - ARROW_PIXELS.Right.length) / 2),
      },
    }[pointing]
    const barTop = top + MARKER_PAD + ICON_SIZE + 1
    return [
      rect(left, top, MARKER_WIDTH, MARKER_HEIGHT, MARKER_BACK_COLOR),
      placeAt(
        left + MARKER_PAD,
        top + MARKER_PAD,
        isFrontDoorOpen(model) ? OPEN_DOOR_ICON : LOCKED_DOOR_ICON,
      ),
      rect(left + MARKER_PAD, barTop, ICON_SIZE, BAR_HEIGHT, TRACK_COLOR),
      rect(
        left + MARKER_PAD,
        barTop,
        Math.round(ICON_SIZE * unlockShareOf(model)),
        BAR_HEIGHT,
        FILL_COLOR,
      ),
      placeAt(arrowAt.x, arrowAt.y, ARROWS[pointing]),
    ]
  },
)
