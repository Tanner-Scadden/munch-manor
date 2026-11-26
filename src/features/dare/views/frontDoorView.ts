import { Function } from 'effect'

import type { Model } from '#app/model.ts'
import { type Sprite, TOP_LEFT, placeAt, spriteShapes } from '#art/sprite.ts'
import { type Camera, worldToView } from '#render/camera/camera.ts'
import type { Screen } from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'
import { rect } from '#render/drawing.ts'
import { clearWindowOf } from '#render/hud/hudLayout.ts'
import { Finale } from '#world/dare/dareSchema.ts'
import { isFrontDoorOpen } from '#world/dare/finale.ts'
import { levelOf } from '#world/level/arena.ts'
import { clamp } from '#world/step/geometry.ts'

const BLINK_MS = 120
const LOCK_RISE = 7
const FILL_COLOR = '#ffd23f'
const GLINT_COLOR = '#fff7d0'
const NIGHT_COLOR = '#0b0a1a'
const STARLIGHT_COLOR = '#2a2850'
const SPILL_COLOR = 'rgba(255, 210, 120, 0.35)'

export const frontDoorShapes = (model: Model): ReadonlyArray<Draw.Shape> => {
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
    rect(
      middle - 1,
      box.top + 3,
      3,
      3,
      Math.floor(model.elapsedMs / BLINK_MS) % 2 === 0
        ? GLINT_COLOR
        : FILL_COLOR,
    ),
  ]
}

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
const MARKER_HEIGHT = ICON_SIZE + MARKER_PAD * 2
const MARKER_EDGE_GAP = 2
const ARROW_GAP = 1
const MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
const PADLOCK_ROWS = 6
const PADLOCK_HALF_WIDTH = 4

const isFinaleAtDoor = (model: Model): boolean =>
  Finale.isAnyOf(['KeyFlying', 'Open'])(model.dare.finale)

export const frontDoorMarkerShapes: {
  (screen: Screen, camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  3,
  (model: Model, screen: Screen, camera: Camera): ReadonlyArray<Draw.Shape> => {
    if (!isFinaleAtDoor(model)) {
      return []
    }
    const { box } = levelOf(model).thresholds.Front
    const topLeft = worldToView(camera, { x: box.left, y: box.top - LOCK_RISE })
    const bottomRight = worldToView(camera, {
      x: box.right,
      y: box.top + PADLOCK_ROWS,
    })
    const clear = clearWindowOf(screen, MARKER_EDGE_GAP)
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
    return [
      rect(left, top, MARKER_WIDTH, MARKER_HEIGHT, MARKER_BACK_COLOR),
      placeAt(
        left + MARKER_PAD,
        top + MARKER_PAD,
        isFrontDoorOpen(model) ? OPEN_DOOR_ICON : LOCKED_DOOR_ICON,
      ),
      placeAt(arrowAt.x, arrowAt.y, ARROWS[pointing]),
    ]
  },
)
