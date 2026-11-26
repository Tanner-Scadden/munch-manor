// What glows of itself in the dark, lit by no room: the library's rose
// window, the pickled hearts in their jars on the cellar's shelf, the
// zombies' eyes and Rattles', and a Kaboomer's sparks. The kitchen's soup
// is its own picture, unlit as the leaks' puddles are (soupLayer.ts).
//
// The house's glows are one unlit layer, painted once per level on quads over
// only the tiles they cover (as the storm is, storm.ts), and only in open
// rooms, so a shut room stays black. The eyes are their own front faces,
// which a carve keeps apart and draws glowing (voxels.ts), so they show in
// the cellar's dark where the rest of the body does not.
// The sparks stand with the glowing billboards (scene.ts, `isGlowShape`).

import { Array, Option, Result } from 'effect'
import type { Application } from 'pixi.js'

import { Container3D, FlatMaterial } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import { CELLAR_ROOM_ID, LIBRARY_ROOM_ID } from '../../world/level/plan'
import type * as Draw from '../draw'
import { heartJarGlowShapes } from '../room/cellarArt'
import { isRoomOpen, roomBoxOf } from '../room/room'
import type { Box } from '../room/roomPalette'
import { roseGlowShapes } from '../room/roseWindowArt'
import { type ArtMesh, buildArtQuads } from './house'
import { FloorPicture } from './painter'
import type { Textures } from './textures'
import { artQuadsOver } from './wallQuads'

// THE HOUSE'S GLOWS

const inRoom = (
  level: Level,
  roomId: string,
  shapesOf: (room: Box) => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  isRoomOpen(level, roomId)
    ? Array.flatMap(Array.fromOption(roomBoxOf(level, roomId)), shapesOf)
    : []

// NOTE: every glow the level has in its open rooms, in game pixels on the
// level's picture.
const glowShapesOf = (level: Level): ReadonlyArray<Draw.Shape> => [
  ...inRoom(level, LIBRARY_ROOM_ID, roseGlowShapes),
  ...inRoom(level, CELLAR_ROOM_ID, heartJarGlowShapes),
]

const boxesOf = (shapes: ReadonlyArray<Draw.Shape>): ReadonlyArray<Box> =>
  Array.filterMap(shapes, shape =>
    shape._tag === 'Rect'
      ? Result.succeed({
          x: shape.x,
          y: shape.y,
          width: shape.width,
          height: shape.height,
        })
      : Result.failVoid,
  )

// NOTE: the glows lie just under the storm's quads (storm.ts): over a
// wall's art, or over the ground's glows on the floor.
const OVER_WALL = 0.004
const OVER_FLOOR = 0.013

// NOTE: mutable on purpose: it owns the level's glow picture and its quads,
// painted once when built.
export class HouseGlows {
  private readonly picture: FloorPicture
  private readonly holder = new Container3D()
  private art: Option.Option<ArtMesh> = Option.none()

  constructor(
    input: Readonly<{
      app: Application
      textures: Textures
      level: Level
      parent: Container3D
    }>,
  ) {
    const { app, textures, level, parent } = input
    this.picture = new FloorPicture({ app, textures, level })
    const shapes = glowShapesOf(level)
    parent.addChild(this.holder)
    if (shapes.length === 0) {
      return
    }
    this.picture.paint(shapes)
    const art = buildArtQuads({
      level,
      material: new FlatMaterial({
        baseColorTexture: this.picture.texture,
        alphaMode: 'blend',
      }),
      quads: artQuadsOver({
        level,
        boxes: boxesOf(shapes),
        overWall: OVER_WALL,
        overFloor: OVER_FLOOR,
      }),
    })
    this.art = Option.some(art)
    this.holder.addChild(art.mesh)
  }

  // NOTE: the glows over a wall's top fan with it (house.ts `ArtMesh`).
  fanFrom(eye: Option.Option<Readonly<{ x: number; z: number }>>): void {
    if (Option.isSome(this.art)) {
      this.art.value.fanFrom(eye)
    }
  }

  destroy(): void {
    this.holder.destroy({ children: true })
    this.picture.destroy()
  }
}
