// The manor's windows as the storm sees them: the glass of each one the
// room art draws (the dining room's rose window too), and the patch of floor a lightning strike throws its
// light on. The boxes come from the art's own modules, so the storm always
// lands on the glass (src/render/iso/storm.ts).

import { Array, Option } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import {
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../world/level/plan'
import { WALL_SYMBOL, symbolAt } from '../../world/level/tileGrid'
import { libraryWindowPaneOf } from './libraryArt'
import { roomBoxOf } from './room'
import type { Box } from './roomPalette'
import { PARLOUR_WINDOW_GAPS, doorBox } from './roomWalls'
import { roseGlassOf } from './roseWindowArt'

// NOTE: a window high in a back wall, one in a side wall's gap, or the
// dining room's rose window.
type PaneKind = 'High' | 'Side' | 'Rose'

export type Pane = Readonly<{
  kind: PaneKind
  // NOTE: the room it lights, by id.
  roomId: string
  // NOTE: the glass, in game pixels.
  glass: Box
  // NOTE: where the wall under the glass meets the floor, in game pixels
  // down the map: the front edge a shaft of its light leaves the wall at.
  sill: number
  // NOTE: the floor a strike lights through this glass.
  thrown: Box
}>

// NOTE: how much longer a patch of light is than its glass, and how far
// out of the wall the light from high glass lands, as a share of its height
// over the sill.
const THROW_STRETCH = 1.5
const THROW_REACH = 0.6
// NOTE: how far into the room a side window's light reaches.
const SIDE_THROW = 16

const isWallAt = (level: Level, x: number, y: number): boolean =>
  Option.exists(
    symbolAt(level, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE)),
    symbol => symbol === WALL_SYMBOL,
  )

// NOTE: the top of the first floor tile below a back wall's glass.
const sillBelow = (level: Level, glass: Box): number => {
  const x = glass.x + Math.floor(glass.width / 2)
  const start = Math.floor((glass.y + glass.height) / TILE_SIZE) * TILE_SIZE
  const rows = Array.makeBy(4, row => start + row * TILE_SIZE)
  return Option.getOrElse(
    Array.findFirst(rows, y => !isWallAt(level, x, y)),
    () => start + TILE_SIZE,
  )
}

const wallPane = (
  level: Level,
  glass: Box,
  at: Readonly<{ kind: PaneKind; roomId: string }>,
): Pane => {
  const sill = sillBelow(level, glass)
  const over = sill - (glass.y + glass.height)
  return {
    ...at,
    glass,
    sill,
    thrown: {
      x: glass.x + 2,
      y: sill + Math.round(over * THROW_REACH),
      width: glass.width,
      height: Math.ceil(glass.height * THROW_STRETCH),
    },
  }
}

// NOTE: a window in a side wall's gap throws its light across the floor,
// away from the wall it sits in.
const sidePane = (level: Level, glass: Box): Pane => {
  const isWallEast = isWallAt(
    level,
    glass.x + glass.width + 1,
    glass.y + Math.floor(glass.height / 2),
  )
  return {
    kind: 'Side',
    roomId: KITCHEN_ROOM_ID,
    glass,
    sill: glass.y + glass.height,
    thrown: {
      x: isWallEast ? glass.x - SIDE_THROW - 2 : glass.x + glass.width + 2,
      y: glass.y + 2,
      width: SIDE_THROW,
      height: glass.height,
    },
  }
}

const builtPanes = new WeakMap<Level, ReadonlyArray<Pane>>()

export const windowPanesOf = (level: Level): ReadonlyArray<Pane> => {
  const cached = builtPanes.get(level)
  if (cached !== undefined) {
    return cached
  }
  const parlour = Option.match(roomBoxOf(level, PARLOUR_ROOM_ID), {
    onNone: () => [],
    onSome: room =>
      Array.map(PARLOUR_WINDOW_GAPS, gap =>
        wallPane(
          level,
          { ...gap, x: gap.x + room.x, y: gap.y + room.y },
          { kind: 'High', roomId: PARLOUR_ROOM_ID },
        ),
      ),
  })
  const library = Option.match(roomBoxOf(level, LIBRARY_ROOM_ID), {
    onNone: () => [],
    onSome: room => [
      wallPane(level, libraryWindowPaneOf(room), {
        kind: 'High',
        roomId: LIBRARY_ROOM_ID,
      }),
    ],
  })
  const rose = Option.match(roomBoxOf(level, DINING_ROOM_ID), {
    onNone: () => [],
    onSome: room => [
      wallPane(level, roseGlassOf(room), {
        kind: 'Rose',
        roomId: DINING_ROOM_ID,
      }),
    ],
  })
  const kitchen = Array.contains(level.doorIds, 'Window')
    ? [sidePane(level, doorBox(level, 'Window'))]
    : []
  const panes = [...parlour, ...library, ...rose, ...kitchen]
  builtPanes.set(level, panes)
  return panes
}
