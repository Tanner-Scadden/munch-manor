import { Function } from 'effect'

import type { Model } from '#app/model.ts'
import { ROOM_ICONS } from '#art/roomIcons.ts'
import {
  type Palette,
  type Sprite,
  group,
  placeAt,
  placeScaled,
  spriteShapes,
} from '#art/sprite.ts'
import { ClocheLift } from '#domain/clientSchema.ts'
import { type Camera, placedAt } from '#render/camera.ts'
import type * as Draw from '#render/draw.ts'
import type { SlotRoomId, Vector } from '#world/schema/entitySchema.ts'
import { clamp, easeOut } from '#world/step/geometry.ts'

import { CLOCHE_RULES } from './clocheReveal.ts'

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

const LIFT_PX = 16
const PLATE_DROP_PX = 5
const RATTLE_STEP_MS = 40
const ICON_POP_SCALE = 1.3
const OPACITY_STEPS = 4

const stepped = (share: number): number =>
  Math.ceil(clamp(share, 0, 1) * OPACITY_STEPS) / OPACITY_STEPS

const faded = (
  opacity: number,
  shapes: ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  opacity >= 1 ? shapes : opacity <= 0 ? [] : [group({ opacity, shapes })]

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
): ReadonlyArray<Draw.Shape> => {
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

export const clocheShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
    ClocheLift.match(model.cosmetics.clocheLift, {
      Resting: () => [],
      Lifting: ({ room, at, ageMs }) => [
        placedAt(camera, at, liftShapes(room, at, ageMs)),
      ],
    }),
)
