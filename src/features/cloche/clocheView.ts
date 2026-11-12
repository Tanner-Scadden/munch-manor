import { Function } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../../app/model'
import { ROOM_ICONS } from '../../art/roomIcons'
import {
  type Palette,
  type Sprite,
  group,
  placeAt,
  placeScaled,
  spriteShapes,
} from '../../art/sprite'
import { ClocheLift } from '../../domain/clientSchema'
import { type Camera, worldToView } from '../../render/camera'
import type { SlotRoomId, Vector } from '../../world/schema/entitySchema'
import { ZERO_VECTOR, clamp, easeOut } from '../../world/step/geometry'
import { CLOCHE_RULES } from './clocheReveal'

// What the cloche reveal looks like (src/features/cloche/clocheReveal.ts),
// drawn on the overlay over the actors: the silver dome on its gold plate
// rattles over the doorway, lifts and fades, and the room's icon pops up
// from the plate with a squash and stretch, holds, and fades with the plate.

// THE ART

const OUTLINE = '#140c10'

const CLOCHE_PALETTE: Palette = {
  k: OUTLINE,
  W: '#c8ccd4',
  H: '#ffffff',
  S: '#8a90a0',
  G: '#e0c070',
}

const DOME: Sprite = spriteShapes(
  [
    '.....kkk.....',
    '.....kHk.....',
    '....kkkkk....',
    '..kkWWWWWkk..',
    '.kWHWWWWWWSk.',
    'kWHWWWWWWWWSk',
    'kWHWWWWWWWWSk',
    'kWWWWWWWWWWSk',
    'kkkkkkkkkkkkk',
  ],
  CLOCHE_PALETTE,
)

const PLATE: Sprite = spriteShapes(
  ['.kGGGGGGGGGk.', '..kkkkkkkkk..'],
  CLOCHE_PALETTE,
)

// THE LIFT

const LIFT_PX = 16
const PLATE_DROP_PX = 5
const RATTLE_STEP_MS = 40
const ICON_POP_SCALE = 1.3
const OPACITY_STEPS = 4

// NOTE: opacity in a few steps, so the fade reads as pixel art.
const stepped = (share: number): number =>
  Math.ceil(clamp(share, 0, 1) * OPACITY_STEPS) / OPACITY_STEPS

const faded = (
  opacity: number,
  shapes: ReadonlyArray<Canvas.Shape>,
): ReadonlyArray<Canvas.Shape> =>
  opacity >= 1 ? shapes : opacity <= 0 ? [] : [group({ opacity, shapes })]

// NOTE: the icon grows past its size and settles, a squash and stretch.
const iconScaleAt = (share: number): Readonly<{ x: number; y: number }> => {
  const grow =
    share < 0.6
      ? (share / 0.6) * ICON_POP_SCALE
      : ICON_POP_SCALE - ((share - 0.6) / 0.4) * (ICON_POP_SCALE - 1)
  return { x: grow, y: share < 0.6 ? grow * 1.1 : grow }
}

const liftShapes = (
  room: SlotRoomId,
  at: Vector,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const { rattleMs, liftMs, holdMs, fadeMs } = CLOCHE_RULES
  const plate = placeAt(at.x, at.y + PLATE_DROP_PX, PLATE)
  if (ageMs < rattleMs) {
    const jitter = Math.floor(ageMs / RATTLE_STEP_MS) % 2 === 0 ? -1 : 1
    return [plate, placeAt(at.x + jitter, at.y, DOME)]
  }
  const liftShare = clamp((ageMs - rattleMs) / liftMs, 0, 1)
  const fadeShare = clamp((ageMs - rattleMs - liftMs - holdMs) / fadeMs, 0, 1)
  const scale = iconScaleAt(liftShare)
  const shown = stepped(1 - fadeShare)
  return [
    ...faded(shown, [
      plate,
      placeScaled(at.x, at.y, ROOM_ICONS[room], scale.x, scale.y),
    ]),
    ...faded(stepped(1 - liftShare), [
      placeAt(at.x, at.y - Math.round(LIFT_PX * easeOut(liftShare)), DOME),
    ]),
  ]
}

// NOTE: the reveal for everyone in the room, placed in the world by the
// screen camera like the fridge's.
export const clocheShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Canvas.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Canvas.Shape> =>
    ClocheLift.match(model.clocheLift, {
      Resting: () => [],
      Lifting: ({ room, at, ageMs }) => [
        group({
          translate: worldToView(camera, ZERO_VECTOR),
          scale:
            camera.scale === 1
              ? undefined
              : { x: camera.scale, y: camera.scale },
          shapes: liftShapes(room, at, ageMs),
        }),
      ],
    }),
)
