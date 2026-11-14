// The 3D world's space: how the game's 2D world maps onto 3D units.

import { TILE_SIZE } from '../../shared/constants'

// NOTE: one world unit is one tile. A game pixel is a tenth of a unit, x runs
// east and z runs south (the game's y), and y is up.
export const UNIT = 1 / TILE_SIZE

// NOTE: the camera, looking straight north and down steeply: the game's own
// map, tilted just enough to show the walls standing.
export const PITCH = (62 * Math.PI) / 180

// NOTE: crisp pixels, and the 2D game's own map. A floor seen at a slant is
// squashed (by sin PITCH), while a billboard faces the lens square, so floor
// pixels and sprite pixels would come out different heights. The world is
// stretched north-south by the inverse, so a game pixel is square on screen
// on the floor too. The floor then projects exactly onto the game's 2D map:
// a camera locked to the game's own camera puts every floor point where the
// game aims, so the mouse, the touch aim, and the overlay's markers need
// nothing new.
export const STRETCH = 1 / Math.sin(PITCH)

export const zOf = (gameY: number): number => gameY * UNIT * STRETCH

export const WALL_HEIGHT = 1.4

// NOTE: where "up" and "toward the lens" point in the world. The camera
// looks straight north, so every billboard faces it square, and a sprite's
// parts are offset from its foot along the camera's own up: that keeps the
// whole sprite at its foot's depth, which is exactly the game's foot sort,
// and keeps the parts of one body (a hat over a head, a gun in a hand)
// where the 2D game drew them.
export type Vec3 = Readonly<{ x: number; y: number; z: number }>

export const CAMERA_UP: Vec3 = {
  x: 0,
  y: Math.cos(PITCH),
  z: -Math.sin(PITCH),
}

export const TOWARD_CAMERA: Vec3 = {
  x: 0,
  y: Math.sin(PITCH),
  z: Math.cos(PITCH),
}
