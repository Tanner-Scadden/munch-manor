// The manor's windows as the storm sees them: the glass of each one the
// room art draws, and the patch of floor a lightning strike throws its
// light on. The boxes come from the art's own modules, so the storm always
// lands on the glass (src/render/iso/storm.ts).

import { Array, Option } from 'effect'

import { TILE_SIZE } from '../../shared/constants'
import type { Level } from '../../world/level/arena'
import { LIBRARY_ROOM_ID, PARLOUR_ROOM_ID } from '../../world/level/plan'
import { WALL_SYMBOL, symbolAt } from '../../world/level/tileGrid'
import { libraryWindowPaneOf } from './libraryArt'
import { roomBoxOf } from './room'
import type { Box } from './roomPalette'
import { PARLOUR_WINDOW_GAPS, doorBox } from './roomWalls'

export type Pane = Readonly<{
  // NOTE: the glass, in game pixels.
  glass: Box
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

const wallPane = (level: Level, glass: Box): Pane => {
  const sill = sillBelow(level, glass)
  const over = sill - (glass.y + glass.height)
  return {
    glass,
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
    glass,
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
        wallPane(level, { ...gap, x: gap.x + room.x, y: gap.y + room.y }),
      ),
  })
  const library = Option.match(roomBoxOf(level, LIBRARY_ROOM_ID), {
    onNone: () => [],
    onSome: room => [wallPane(level, libraryWindowPaneOf(room))],
  })
  const kitchen = Array.contains(level.doorIds, 'Window')
    ? [sidePane(level, doorBox(level, 'Window'))]
    : []
  const panes = [...parlour, ...library, ...kitchen]
  builtPanes.set(level, panes)
  return panes
}
