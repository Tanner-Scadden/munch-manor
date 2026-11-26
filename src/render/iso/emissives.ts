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

const inRoom = (
  level: Level,
  roomId: string,
  shapesOf: (room: Box) => ReadonlyArray<Draw.Shape>,
): ReadonlyArray<Draw.Shape> =>
  isRoomOpen(level, roomId)
    ? Array.flatMap(Array.fromOption(roomBoxOf(level, roomId)), shapesOf)
    : []

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

const OVER_WALL = 0.004
const OVER_FLOOR = 0.013

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
