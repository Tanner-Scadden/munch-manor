import { Array, Option, pipe } from 'effect'
import { Canvas } from 'foldkit'
import type { Html } from 'foldkit/html'

import { DOOR_OUTWARD, type Level, levelOf } from './arena'
import { maybeBossDoor } from './boss'
import { type Camera, worldToView } from './camera'
import type { ApplicationViewBuilder } from './composition'
import { FULL_TURN, placeSprite } from './drawing'
import { exitBoxOf } from './exits'
import {
  COUNT_SPRITES,
  GLYPH_HEIGHT,
  bakeText,
  placeBaked,
  textShapes,
} from './font'
import { clamp } from './geometry'
import {
  type Boss,
  type DoorId,
  type Model,
  Phase,
  type PlannedSpawn,
  type Trap,
  type Vector,
  type ZombieKind,
} from './model'
import { type Box, screenOf } from './screen'
import { group } from './sprite'
import { BOSS_ICON, ZOMBIE_SPRITES } from './sprites/zombies'
import {
  type DoorCount,
  type KindCount,
  debutKinds,
  doorCounts,
  endlessDepth,
  floorCounts,
  hpScaleFor,
} from './waves'
import { ZOMBIE_KINDS } from './zombies'

// DOOR MARKERS

const DOOR_MARKER_INSET = 20
const DOOR_MARKER_PULSE_MS = 1400
const DOOR_MARKER_ROW_PX = 9
const DOOR_MARKER_ICON_X = -6
const DOOR_MARKER_COUNT_X = 0
const DOOR_MARKER_PAD = 2
const DOOR_MARKER_BACK_COLOR = 'rgba(14, 8, 12, 0.86)'
const DOOR_MARKER_EDGE_COLOR = '#ff8a3d'
const DOOR_MARKER_EDGE_DIM = 0.35
const DOOR_MARKER_BACK_WIDTH = 26

const NEW_TAG = bakeText('NEW', 'Fresh')
const NEW_TAG_GAP = 2
const NEW_TAG_PAD = 1

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

const newTagTop = (outwardY: number, top: number, rows: number): number =>
  outwardY < 0
    ? top +
      rows * DOOR_MARKER_ROW_PX -
      DOOR_MARKER_ROW_PX / 2 +
      DOOR_MARKER_PAD +
      NEW_TAG_GAP
    : top -
      DOOR_MARKER_ROW_PX / 2 -
      DOOR_MARKER_PAD -
      GLYPH_HEIGHT -
      NEW_TAG_GAP

const newTagShapes = (
  isNew: boolean,
  y: number,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? [
        Canvas.Rect({
          x: -Math.ceil(NEW_TAG.width / 2) - NEW_TAG_PAD,
          y: y - NEW_TAG_PAD,
          width: NEW_TAG.width + NEW_TAG_PAD * 2 + 1,
          height: GLYPH_HEIGHT + NEW_TAG_PAD * 2,
          fill: DOOR_MARKER_BACK_COLOR,
        }),
        placeBaked(NEW_TAG, { x: 0, y, align: 'Center' }),
      ]
    : []

const countShapes = (
  count: number,
  isNew: boolean,
): ReadonlyArray<Canvas.Shape> =>
  isNew
    ? textShapes(`x${count}`, 'Fresh', 0, -2, 'Left')
    : Option.match(Array.get(COUNT_SPRITES, count), {
        onNone: () => textShapes(`x${count}`, 'Kill', 0, -2, 'Left'),
        onSome: sprite => sprite,
      })

const markerRowShapes =
  (top: number, debuts: ReadonlyArray<ZombieKind>) =>
  ({ kind, count }: KindCount, index: number): ReadonlyArray<Canvas.Shape> => {
    const y = top + index * DOOR_MARKER_ROW_PX
    return [
      placeSprite(DOOR_MARKER_ICON_X, y, ZOMBIE_SPRITES[kind].icon),
      placeSprite(
        DOOR_MARKER_COUNT_X,
        y,
        countShapes(count, Array.contains(debuts, kind)),
      ),
    ]
  }

// NOTE: in portrait the world window shows only part of the room, so a
// marker whose door is out of view is pinned to the window's edge with an
// arrow toward the door. This is the preview between waves, not a warning
// during one.
type Side = 'Left' | 'Inside' | 'Right'

type Pinned = Readonly<{ point: Vector; side: Side }>

const EDGE_MARGIN_PX = 5
const ARROW_GAP_PX = 2
const ARROW_LENGTH_PX = 3

// NOTE: a zoomed portrait window puts world points between screen pixels,
// so the anchor is rounded to keep the marker's edges crisp.
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
): ReadonlyArray<Canvas.Shape> => {
  if (side === 'Inside') {
    return []
  }
  const direction = side === 'Right' ? 1 : -1
  const base = direction * (halfWidth + ARROW_GAP_PX)
  return Array.makeBy(ARROW_LENGTH_PX, step => {
    const reach = ARROW_LENGTH_PX - step
    return Canvas.Rect({
      x: Math.round(base + direction * step - (direction < 0 ? 1 : 0)),
      y: Math.round(centerY) - reach + 1,
      width: 1,
      height: reach * 2 - 1,
      fill,
    })
  })
}

const markerTop = (outwardY: number, rows: number): number => {
  const span = (rows - 1) * DOOR_MARKER_ROW_PX
  if (outwardY < 0) {
    return 0
  } else if (outwardY > 0) {
    return -span
  } else {
    return -Math.round(span / 2)
  }
}

const markerEdgeOpacity = (elapsedMs: number): number =>
  DOOR_MARKER_EDGE_DIM +
  (1 - DOOR_MARKER_EDGE_DIM) *
    (0.5 + 0.5 * Math.sin((FULL_TURN * elapsedMs) / DOOR_MARKER_PULSE_MS))

// NOTE: where a door's marker goes. A marker shows only for a door whose
// spot is on the screen, never one above or below the window, so nothing
// points at a door out of view. A door behind an open exit that is out of
// view counts at that exit's doorway instead when the doorway is in view,
// since that is where its zombies come into the room the player is in.
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

type PlacedCount = Readonly<{
  spot: MarkerSpot
  kinds: Array.NonEmptyReadonlyArray<KindCount>
}>

const mergeKinds = (
  first: Array.NonEmptyReadonlyArray<KindCount>,
  second: ReadonlyArray<KindCount>,
): Array.NonEmptyReadonlyArray<KindCount> =>
  Array.reduce(second, first, (merged, { kind, count }) =>
    Array.some(merged, entry => entry.kind === kind)
      ? Array.map(merged, entry =>
          entry.kind === kind ? { kind, count: entry.count + count } : entry,
        )
      : Array.append(merged, { kind, count }),
  )

const NOTHING_PLACED: ReadonlyArray<PlacedCount> = []

const placeCounts = (
  level: Level,
  camera: Camera,
  window: Box,
  counts: ReadonlyArray<DoorCount>,
): ReadonlyArray<PlacedCount> =>
  Array.reduce(counts, NOTHING_PLACED, (placed, { door, kinds }) =>
    Option.match(markerSpotOf(level, camera, window, door), {
      onNone: () => placed,
      onSome: spot =>
        Array.some(placed, entry => entry.spot.key === spot.key)
          ? Array.map(placed, entry =>
              entry.spot.key === spot.key
                ? { spot, kinds: mergeKinds(entry.kinds, kinds) }
                : entry,
            )
          : Array.append(placed, { spot, kinds }),
    }),
  )

const doorMarkerShapes =
  (
    camera: Camera,
    window: Box,
    elapsedMs: number,
    debuts: ReadonlyArray<ZombieKind>,
  ) =>
  ({ spot, kinds }: PlacedCount): ReadonlyArray<Canvas.Shape> => {
    const outward = spot.outward
    const pinned = pinToWindow(
      window,
      worldToView(camera, spot.anchor),
      DOOR_MARKER_BACK_WIDTH / 2,
    )
    const top = markerTop(outward.y, kinds.length)
    const boxTop = top - DOOR_MARKER_ROW_PX / 2 - DOOR_MARKER_PAD
    const boxHeight = kinds.length * DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2
    const boxLeft = -DOOR_MARKER_BACK_WIDTH / 2
    return [
      group({
        translate: pinned.point,
        shapes: [
          ...arrowShapes(
            pinned.side,
            DOOR_MARKER_BACK_WIDTH / 2,
            boxTop + boxHeight / 2,
            DOOR_MARKER_EDGE_COLOR,
          ),
          group({
            opacity: Math.round(markerEdgeOpacity(elapsedMs) * 10) / 10,
            shapes: [
              Canvas.Rect({
                x: boxLeft - 1,
                y: boxTop - 1,
                width: DOOR_MARKER_BACK_WIDTH + 2,
                height: boxHeight + 2,
                fill: DOOR_MARKER_EDGE_COLOR,
              }),
            ],
          }),
          Canvas.Rect({
            x: boxLeft,
            y: boxTop,
            width: DOOR_MARKER_BACK_WIDTH,
            height: boxHeight,
            fill: DOOR_MARKER_BACK_COLOR,
          }),
          ...Array.flatMap(kinds, markerRowShapes(top, debuts)),
          ...newTagShapes(
            Array.some(kinds, ({ kind }) => Array.contains(debuts, kind)),
            newTagTop(outward.y, top, kinds.length),
          ),
        ],
      }),
    ]
  }

// BOSS MARKER

const BOSS_TAG = bakeText('BOSS', 'Defeat')
const BOSS_MARKER_WIDTH = 30
const BOSS_MARKER_HEIGHT = DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2
const BOSS_MARKER_EDGE_COLOR = '#ff4a4f'
const BOSS_MARKER_SIDE_STEP_PX = 32
const BOSS_MARKER_ROW_STEP_PX = 6
const BOSS_ICON_X = -9
const BOSS_TAG_X = -3

const bossMarkerOffset = (
  door: DoorId,
  counts: ReadonlyArray<DoorCount>,
): Readonly<{ x: number; y: number }> => {
  const outward = DOOR_OUTWARD[door]
  const rows = Option.match(
    Array.findFirst(counts, count => count.door === door),
    { onNone: () => 0, onSome: ({ kinds }) => kinds.length },
  )
  if (rows === 0) {
    return { x: 0, y: 0 }
  } else if (outward.x !== 0) {
    return { x: -outward.x * BOSS_MARKER_SIDE_STEP_PX, y: 0 }
  } else {
    const step =
      rows * DOOR_MARKER_ROW_PX + DOOR_MARKER_PAD * 2 + BOSS_MARKER_ROW_STEP_PX
    return { x: 0, y: -outward.y * step }
  }
}

const bossMarkerShapes = (
  level: Level,
  boss: Boss,
  camera: Camera,
  window: Box,
  elapsedMs: number,
  counts: ReadonlyArray<DoorCount>,
): ReadonlyArray<Canvas.Shape> =>
  Option.match(
    Option.flatMap(maybeBossDoor(boss), door =>
      Option.map(markerSpotOf(level, camera, window, door), spot => ({
        door,
        spot,
      })),
    ),
    {
      onNone: () => [],
      onSome: ({ door, spot }) => {
        const anchor = worldToView(camera, spot.anchor)
        const offset = bossMarkerOffset(door, counts)
        const pinned = pinToWindow(
          window,
          { x: anchor.x + offset.x, y: anchor.y + offset.y },
          BOSS_MARKER_WIDTH / 2,
        )
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
                  Canvas.Rect({
                    x: left - 1,
                    y: top - 1,
                    width: BOSS_MARKER_WIDTH + 2,
                    height: BOSS_MARKER_HEIGHT + 2,
                    fill: BOSS_MARKER_EDGE_COLOR,
                  }),
                ],
              }),
              Canvas.Rect({
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

// FLOOR MARKER

const FLOOR_TAG = bakeText('FLOOR', 'Prompt')
const FLOOR_ANCHOR = { x: 160, y: 120 }
const FLOOR_MARKER_EDGE_COLOR = '#c08a4a'
const FLOOR_MARKER_WIDTH = 30
const FLOOR_TAG_GAP = 2

// NOTE: the floor is everywhere, so its marker sits in the middle of the
// window, which is the middle of the room in landscape. In portrait that
// keeps it clear of door markers pinned to the window's edges.
const floorMarkerShapes = (
  kinds: ReadonlyArray<KindCount>,
  camera: Camera,
  window: Box,
  elapsedMs: number,
  debuts: ReadonlyArray<ZombieKind>,
): ReadonlyArray<Canvas.Shape> =>
  Array.match(kinds, {
    onEmpty: () => [],
    onNonEmpty: rows => {
      const anchor = {
        x: Math.round(window.x + window.width / 2),
        y: Math.round(worldToView(camera, FLOOR_ANCHOR).y),
      }
      const tagTop = -DOOR_MARKER_ROW_PX / 2 - DOOR_MARKER_PAD - GLYPH_HEIGHT
      const top = tagTop - FLOOR_TAG_GAP - DOOR_MARKER_PAD
      const height =
        rows.length * DOOR_MARKER_ROW_PX +
        DOOR_MARKER_PAD * 3 +
        GLYPH_HEIGHT +
        FLOOR_TAG_GAP
      const left = -FLOOR_MARKER_WIDTH / 2
      return [
        group({
          translate: anchor,
          shapes: [
            group({
              opacity: Math.round(markerEdgeOpacity(elapsedMs) * 10) / 10,
              shapes: [
                Canvas.Rect({
                  x: left - 1,
                  y: top - 1,
                  width: FLOOR_MARKER_WIDTH + 2,
                  height: height + 2,
                  fill: FLOOR_MARKER_EDGE_COLOR,
                }),
              ],
            }),
            Canvas.Rect({
              x: left,
              y: top,
              width: FLOOR_MARKER_WIDTH,
              height,
              fill: DOOR_MARKER_BACK_COLOR,
            }),
            placeBaked(FLOOR_TAG, { x: 0, y: tagTop, align: 'Center' }),
            ...Array.flatMap(rows, markerRowShapes(0, debuts)),
          ],
        }),
      ]
    },
  })

export const wavePreviewShapes = (
  model: Model,
  camera: Camera,
): ReadonlyArray<Canvas.Shape> =>
  Phase.match(model.phase, {
    Ready: () => [],
    Preparation: ({ wave, spawns }) => {
      const level = levelOf(model)
      const counts = doorCounts(spawns, model.traps, level.doorIds)
      const window = screenOf(model).world
      return [
        ...Array.flatMap(
          placeCounts(level, camera, window, counts),
          doorMarkerShapes(camera, window, model.elapsedMs, debutKinds(wave)),
        ),
        ...bossMarkerShapes(
          level,
          model.boss,
          camera,
          window,
          model.elapsedMs,
          counts,
        ),
        ...floorMarkerShapes(
          floorCounts(spawns),
          camera,
          window,
          model.elapsedMs,
          debutKinds(wave),
        ),
      ]
    },
    Wave: () => [],
    Paused: () => [],
    Victory: () => [],
    GameOver: () => [],
  })

// SCREEN READER

const kindLabel = ({ kind, count }: KindCount): string =>
  `${count} ${ZOMBIE_KINDS[kind].name}`

const doorPreviewLabel = ({ door, kinds }: DoorCount): string =>
  `${door} door: ${Array.join(Array.map(kinds, kindLabel), ', ')}`

const floorLabel = (spawns: ReadonlyArray<PlannedSpawn>): string =>
  Array.match(floorCounts(spawns), {
    onEmpty: () => '',
    onNonEmpty: kinds =>
      ` Up through the floor: ${Array.join(Array.map(kinds, kindLabel), ', ')}.`,
  })

const bossLabel = (boss: Boss): string =>
  Option.match(maybeBossDoor(boss), {
    onNone: () => '',
    onSome: door =>
      ` Boss: ${ZOMBIE_KINDS.Boss.name} comes through the ${door} door late in the wave.`,
  })

export const wavePreviewLabel = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  boss: Boss,
): string => {
  const debuts = Array.map(debutKinds(wave), kind => ZOMBIE_KINDS[kind].name)
  const debutText = Array.isReadonlyArrayEmpty(debuts)
    ? ''
    : ` New this wave: ${Array.join(debuts, ', ')}.`
  const healthText =
    endlessDepth(wave) > 0
      ? ` Zombies have ${Math.round((hpScaleFor(wave) - 1) * 100)} percent more health.`
      : ''
  return `Coming in wave ${wave}. ${Array.join(Array.map(doorCounts(spawns, traps), doorPreviewLabel), '. ')}.${floorLabel(spawns)}${debutText}${healthText}${bossLabel(boss)}`
}

export const wavePreviewView = (
  wave: number,
  spawns: ReadonlyArray<PlannedSpawn>,
  traps: ReadonlyArray<Trap>,
  boss: Boss,
  h: ApplicationViewBuilder,
): Html =>
  h.p([h.Class('sr-only')], [wavePreviewLabel(wave, spawns, traps, boss)])
