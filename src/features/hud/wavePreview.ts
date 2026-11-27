import { Array, Function, Option, pipe } from 'effect'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import type { Model } from '#app/model.ts'
import { bakeText, placeBaked } from '#art/font.ts'
import { group } from '#art/sprite.ts'
import { BOSS_ICON } from '#art/sprites/zombies.ts'
import { type Camera, worldToView } from '#render/camera/camera.ts'
import { type Box, screenOf } from '#render/camera/screen.ts'
import * as Draw from '#render/draw.ts'
import { FULL_TURN, placeSprite } from '#render/drawing.ts'
import * as DetMath from '#shared/detMath.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { exitBoxOf } from '#world/level/exits.ts'
import { DOOR_OUTWARD } from '#world/level/tileGrid.ts'
import type { DoorId, Vector } from '#world/schema/entitySchema.ts'
import { type Boss, Phase } from '#world/schema/worldSchema.ts'
import { clamp } from '#world/step/geometry.ts'
import { endlessDepth, hpScaleFor } from '#world/waves/endlessWaves.ts'
import { debutKinds } from '#world/waves/wavePlans.ts'
import { maybeBossDoor } from '#world/zombies/boss.ts'
import { ZOMBIE_KINDS } from '#world/zombies/zombies.ts'

const DOOR_MARKER_INSET = 20
const DOOR_MARKER_PULSE_MS = 1400
const DOOR_MARKER_ROW_PX = 9
const DOOR_MARKER_PAD = 2
const DOOR_MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
const DOOR_MARKER_EDGE_DIM = 0.35

const NORTH_MARKER_SIDE_PX = 24

const markerAnchor = (
  level: Level,
  door: DoorId,
): Readonly<{ x: number; y: number }> => {
  const { center, outward } = level.doors[door]
  const inside = {
    x: Math.round(center.x - outward.x * DOOR_MARKER_INSET),
    y: Math.round(center.y - outward.y * DOOR_MARKER_INSET),
  }
  return door === 'North'
    ? { x: inside.x + NORTH_MARKER_SIDE_PX, y: inside.y - DOOR_MARKER_ROW_PX }
    : inside
}

type Side = 'Left' | 'Inside' | 'Right'

type Pinned = Readonly<{ point: Vector; side: Side }>

const EDGE_MARGIN_PX = 5
const ARROW_GAP_PX = 2
const ARROW_LENGTH_PX = 3

const pinToWindow = (
  window: Box,
  { x: anchorX, y: anchorY }: Vector,
  halfWidth: number,
): Pinned => {
  const anchor = { x: Math.round(anchorX), y: Math.round(anchorY) }
  const reach = halfWidth + EDGE_MARGIN_PX + ARROW_LENGTH_PX
  const left = window.x + reach
  const right = window.x + window.width - reach
  const x = clamp(anchor.x, left, right)
  if (anchor.x < window.x + halfWidth) {
    return { point: { x, y: anchor.y }, side: 'Left' }
  } else if (anchor.x > window.x + window.width - halfWidth) {
    return { point: { x, y: anchor.y }, side: 'Right' }
  } else {
    return { point: anchor, side: 'Inside' }
  }
}

const arrowShapes = (
  side: Side,
  halfWidth: number,
  centerY: number,
  fill: string,
): ReadonlyArray<Draw.Shape> => {
  if (side === 'Inside') {
    return []
  }
  const direction = side === 'Right' ? 1 : -1
  const base = direction * (halfWidth + ARROW_GAP_PX)
  return Array.makeBy(ARROW_LENGTH_PX, step => {
    const reach = ARROW_LENGTH_PX - step
    return Draw.Rect({
      x: Math.round(base + direction * step - (direction < 0 ? 1 : 0)),
      y: Math.round(centerY) - reach + 1,
      width: 1,
      height: reach * 2 - 1,
      fill,
    })
  })
}

const markerEdgeOpacity = (elapsedMs: number): number =>
  DOOR_MARKER_EDGE_DIM +
  (1 - DOOR_MARKER_EDGE_DIM) *
    (0.5 + 0.5 * DetMath.sin((FULL_TURN * elapsedMs) / DOOR_MARKER_PULSE_MS))

type MarkerSpot = Readonly<{ key: string; anchor: Vector; outward: Vector }>

const isRowInWindow = (window: Box, y: number): boolean =>
  y >= window.y && y <= window.y + window.height

const exitSpotOf = (level: Level, door: DoorId): Option.Option<MarkerSpot> =>
  pipe(
    level.exits,
    Array.findFirst(
      ({ isOpen, doors }) => isOpen && Array.contains(doors, door),
    ),
    Option.flatMap(exit =>
      Option.map(exitBoxOf(level, exit.id), box => ({
        key: `exit:${exit.id}`,
        anchor: {
          x: Math.round((box.left + box.right) / 2),
          y: Math.round(box.bottom + DOOR_MARKER_INSET / 2),
        },
        outward: { x: 0, y: -1 },
      })),
    ),
  )

const markerSpotOf = (
  level: Level,
  camera: Camera,
  window: Box,
  door: DoorId,
): Option.Option<MarkerSpot> => {
  const own: MarkerSpot = {
    key: door,
    anchor: markerAnchor(level, door),
    outward: DOOR_OUTWARD[door],
  }
  const isShown = (spot: MarkerSpot): boolean =>
    isRowInWindow(window, worldToView(camera, spot.anchor).y)
  return isShown(own)
    ? Option.some(own)
    : Option.filter(exitSpotOf(level, door), isShown)
}

const BOSS_TAG = bakeText('BOSS', 'Defeat')
const BOSS_MARKER_WIDTH = 30
const BOSS_MARKER_HEIGHT = DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2
const BOSS_MARKER_EDGE_COLOR = '#ff4a4f'
const BOSS_ICON_X = -9
const BOSS_TAG_X = -3

const bossMarkerShapes = (
  level: Level,
  boss: Boss,
  camera: Camera,
  window: Box,
  elapsedMs: number,
): ReadonlyArray<Draw.Shape> =>
  Option.match(
    Option.flatMap(maybeBossDoor(boss), door =>
      Option.map(markerSpotOf(level, camera, window, door), spot => ({
        door,
        spot,
      })),
    ),
    {
      onNone: () => [],
      onSome: ({ spot }) => {
        const anchor = worldToView(camera, spot.anchor)
        const pinned = pinToWindow(window, anchor, BOSS_MARKER_WIDTH / 2)
        const left = -BOSS_MARKER_WIDTH / 2
        const top = -BOSS_MARKER_HEIGHT / 2
        return [
          group({
            translate: pinned.point,
            shapes: [
              ...arrowShapes(
                pinned.side,
                BOSS_MARKER_WIDTH / 2,
                0,
                BOSS_MARKER_EDGE_COLOR,
              ),
              group({
                opacity: Math.round(markerEdgeOpacity(elapsedMs) * 10) / 10,
                shapes: [
                  Draw.Rect({
                    x: left - 1,
                    y: top - 1,
                    width: BOSS_MARKER_WIDTH + 2,
                    height: BOSS_MARKER_HEIGHT + 2,
                    fill: BOSS_MARKER_EDGE_COLOR,
                  }),
                ],
              }),
              Draw.Rect({
                x: left,
                y: top,
                width: BOSS_MARKER_WIDTH,
                height: BOSS_MARKER_HEIGHT,
                fill: DOOR_MARKER_BACK_COLOR,
              }),
              placeSprite(BOSS_ICON_X, 0, BOSS_ICON),
              placeBaked(BOSS_TAG, { x: BOSS_TAG_X, y: -2, align: 'Left' }),
            ],
          }),
        ]
      },
    },
  )

export const wavePreviewShapes: {
  (camera: Camera): (model: Model) => ReadonlyArray<Draw.Shape>
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape>
} = Function.dual(
  2,
  (model: Model, camera: Camera): ReadonlyArray<Draw.Shape> =>
    Phase.match(model.phase, {
      Ready: () => [],
      Arriving: () => [],
      Preparation: () =>
        bossMarkerShapes(
          levelOf(model),
          model.boss,
          camera,
          screenOf(model).world,
          model.elapsedMs,
        ),
      Wave: () => [],
      Paused: () => [],
      Escaped: () => [],
      LeftEarly: () => [],
      GameOver: () => [],
    }),
)

const bossLabel = (boss: Boss): string =>
  Option.match(maybeBossDoor(boss), {
    onNone: () => '',
    onSome: door =>
      ` Boss: ${ZOMBIE_KINDS.Boss.name} comes through the ${door} door late in the wave.`,
  })

export const wavePreviewLabel: {
  (boss: Boss): (wave: number) => string
  (wave: number, boss: Boss): string
} = Function.dual(2, (wave: number, boss: Boss): string => {
  const debuts = Array.map(debutKinds(wave), kind => ZOMBIE_KINDS[kind].name)
  const debutText = Array.isReadonlyArrayEmpty(debuts)
    ? ''
    : ` New this wave: ${Array.join(debuts, ', ')}.`
  const healthText =
    endlessDepth(wave) > 0
      ? ` Zombies have ${Math.round((hpScaleFor(wave) - 1) * 100)} percent more health.`
      : ''
  return `Coming in wave ${wave}.${debutText}${healthText}${bossLabel(boss)}`
})

export const wavePreviewView: {
  (boss: Boss, h: ApplicationViewBuilder): (wave: number) => ApplicationHtml
  (wave: number, boss: Boss, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  3,
  (wave: number, boss: Boss, h: ApplicationViewBuilder): ApplicationHtml =>
    h.p.class('sr-only').children(wavePreviewLabel(wave, boss)),
)
