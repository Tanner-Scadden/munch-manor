import { Array } from 'effect'
import type { Canvas } from 'foldkit'

import { type Sprite, bakeShapes, placeAt } from '../../art/sprite'
import { rect } from '../../render/drawing'
import { doorArrowShapes } from '../../render/powerupView'
import {
  COOLDOWN_RINGS,
  SET_UP_RINGS,
  WORK_RING_RADIUS,
  ringStepOf,
} from '../../render/workRing'
import type { World } from '../../world/schema/world'
import type { StationId } from '../../world/schema/worldSchema'
import { type StationView, stationViewsOf } from '../../world/stations/stations'

// The room tools' work stations (src/world/stations/stations.ts) drawn.
// Show, don't explain: the cleat is brass on the wall with its rope; while
// a player works it a gold ring fills round it, a step away drains it, and
// once it fires a grey ring refills over its cooldown. The first time it
// waits to be worked in a run, a bobbing arrow points at it and its ring
// pulses, so a player learns to stand at it by seeing it.

const HINT_PULSE_MS = 400

// NOTE: the cleat: a brass horn bolted to the wall's inner face, the rope
// running up from it to the ceiling and a coil of it hanging below.
const CLEAT_SPRITE: Sprite = bakeShapes([
  rect(6, -14, 1, 15, '#c9a66b'),
  rect(7, -14, 1, 15, '#8a6a3a'),
  rect(5, -1, 4, 1, '#6a4a1c'),
  rect(4, 0, 6, 2, '#d8b04a'),
  rect(4, 2, 6, 1, '#8a6420'),
  rect(6, 3, 2, 3, '#a8822e'),
  rect(4, 6, 6, 1, '#d8b04a'),
  rect(4, 7, 6, 1, '#8a6420'),
  rect(5, 8, 1, 4, '#c9a66b'),
  rect(8, 8, 1, 5, '#c9a66b'),
  rect(5, 12, 4, 1, '#8a6a3a'),
])

const STATION_SPRITES: Readonly<Record<StationId, Sprite>> = {
  Cleat: CLEAT_SPRITE,
}

const HALF_TILE = 5

const ringShapes = (
  station: StationView,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(station.center.x)
  const y = Math.round(station.center.y)
  if (station.setUp > 0) {
    return [placeAt(x, y, ringStepOf(SET_UP_RINGS, station.setUp))]
  }
  if (station.cooldown > 0) {
    return [placeAt(x, y, ringStepOf(COOLDOWN_RINGS, 1 - station.cooldown))]
  }
  if (!station.isWorkable || station.timesWorked > 0) {
    return []
  }
  const isLit = Math.floor(elapsedMs / HINT_PULSE_MS) % 2 === 0
  return [
    placeAt(
      x,
      y,
      isLit
        ? Array.lastNonEmpty(SET_UP_RINGS)
        : Array.headNonEmpty(SET_UP_RINGS),
    ),
    ...doorArrowShapes({ x, y: y - WORK_RING_RADIUS }, elapsedMs),
  ]
}

// NOTE: on the ground layer, over the room's walls: each station's art.
export const stationGroundShapes = (
  world: World,
): ReadonlyArray<Canvas.Shape> =>
  Array.map(stationViewsOf(world), ({ id, center }) =>
    placeAt(
      Math.round(center.x) - HALF_TILE,
      Math.round(center.y) - HALF_TILE,
      STATION_SPRITES[id],
    ),
  )

// NOTE: over everything: a station's set-up or cooldown ring, or its first
// time hint.
export const stationOverheadShapes = (
  world: World,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(stationViewsOf(world), station =>
    ringShapes(station, world.elapsedMs),
  )
