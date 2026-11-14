// The 3D spike's space: how the game's 2D world maps onto 3D units.

import { TILE_SIZE } from '@game/shared/constants'

// NOTE: one world unit is one tile. A game pixel is a tenth of a unit, x runs
// east and z runs south (the game's y), and y is up.
export const UNIT = 1 / TILE_SIZE

// NOTE: the camera, looking straight north and down steeply: the game's own
// map, tilted just enough to show the walls standing.
export const PITCH = (62 * Math.PI) / 180

// NOTE: crisp pixels. A floor seen at a slant is squashed (by sin PITCH),
// while a billboard faces the lens square, so floor pixels and sprite pixels
// would come out different heights. The world is stretched north-south by
// the inverse, so a game pixel is square on screen on the floor too, and
// with a whole number of screen pixels per game pixel (snapped, below)
// every pixel of art lands on the screen's own grid, as in the 2D game.
export const STRETCH = 1 / Math.sin(PITCH)
export const zOf = (gameY: number): number => gameY * UNIT * STRETCH
