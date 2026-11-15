// The Rooms tab's live room: the manor drawn by the game's own 3D renderer,
// through the audit harness in a frame (./worldStage.ts). What it shows
// (the room, the mood, the bodies, a lightning strike, the chandelier) is
// the harness's query string, built here from the Studio's picks.
import { Array, Option, Schema } from 'effect'

import { strikeClockOf } from '../../src/render/iso/mood'
import { TILE_SIZE } from '../../src/shared/constants'
import { CrateRoom } from '../../src/world/schema/entitySchema'
import {
  ARRANGEMENTS,
  type RoomSpec,
  manorSpecFor,
  widthOf,
} from '../../src/world/level/plan'

// NOTE: the room the live scene stands in: every room of the manor, as the
// World names them.
export const LiveSpot = CrateRoom
export type LiveSpot = typeof LiveSpot.Type

export const LiveMood = Schema.Literals([
  'Break',
  'Wave',
  'Late',
  'Frenzy',
  'Boss',
])
export type LiveMood = typeof LiveMood.Type

export const LiveBodies = Schema.Literals(['None', 'Crowd', 'Lineup'])
export type LiveBodies = typeof LiveBodies.Type

// NOTE: what a press on the live room does: pins tiles for a note, or holds
// the pixel loupe over it.
export const LiveTool = Schema.Literals(['Pin', 'Loupe'])
export type LiveTool = typeof LiveTool.Type

export const LiveScene = Schema.Struct({
  spot: LiveSpot,
  mood: LiveMood,
  bodies: LiveBodies,
  isStrike: Schema.Boolean,
  isFallen: Schema.Boolean,
  isStill: Schema.Boolean,
  isHudOn: Schema.Boolean,
})
export type LiveScene = typeof LiveScene.Type

export const DEFAULT_LIVE: LiveScene = {
  spot: 'Dining',
  mood: 'Break',
  bodies: 'Crowd',
  isStrike: false,
  isFallen: false,
  isStill: true,
  isHudOn: false,
}

const WAVE = 3

// NOTE: the frames a still scene plays before it holds, enough for the
// lights and the bodies to settle.
const STILL_FRAMES = 4

const CROWD = 10

type Box = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const boxOfRoom = (room: RoomSpec): Box => ({
  left: room.origin.column * TILE_SIZE,
  top: room.origin.row * TILE_SIZE,
  right: (room.origin.column + widthOf(room.tiles)) * TILE_SIZE,
  bottom: (room.origin.row + room.tiles.length) * TILE_SIZE,
})

// NOTE: a spot's room box in a house, in world pixels; the dining room's when
// the house has no such room.
const spotBoxOf = (house: number, spot: LiveSpot): Box => {
  const spec = manorSpecFor(
    Option.getOrElse(Array.get(ARRANGEMENTS, house), () =>
      Array.headNonEmpty(ARRANGEMENTS),
    ),
  )
  return boxOfRoom(
    Option.getOrElse(
      Array.findFirst(spec.rooms, room => room.id === spot),
      () => Array.headNonEmpty(spec.rooms),
    ),
  )
}

const MOOD_KEYS: Readonly<Record<LiveMood, ReadonlyArray<string>>> = {
  Break: ['break=open'],
  Wave: ['start=wave', 'heat=0.35'],
  Late: ['start=wave', 'heat=1'],
  Frenzy: ['start=wave', 'heat=1', 'frenzy'],
  Boss: ['boss=fighting', 'heat=1'],
}

const bodyKeys = (bodies: LiveBodies, box: Box): ReadonlyArray<string> =>
  ({
    None: [],
    Crowd: [`crowd=${CROWD}`, `crowdx=${box.left}`, `crowdy=${box.top + 20}`],
    Lineup: ['lineup=sizes'],
  })[bodies]

// NOTE: the harness's query for a live scene: every room open and seen, the
// player (who the camera follows) in the middle of the picked room, unhurt.
export const harnessQueryOf = ({
  scene,
  house,
}: Readonly<{ scene: LiveScene; house: number }>): string => {
  const box = spotBoxOf(house, scene.spot)
  const middleX = Math.round((box.left + box.right) / 2)
  const middleY = Math.round((box.top + box.bottom) / 2)
  return Array.join(
    [
      'nodev',
      'god',
      'seen=all',
      `wave=${WAVE}`,
      `house=${house}`,
      'openexits=West,East,Far,Kitchen',
      'kitchen',
      `px=${middleX}`,
      `py=${middleY}`,
      ...MOOD_KEYS[scene.mood],
      ...bodyKeys(scene.bodies, box),
      ...(scene.isStrike ? [`clock=${strikeClockOf(WAVE)}`] : []),
      ...(scene.isFallen ? ['fallen'] : []),
      ...(scene.isStill ? [`freeze=${STILL_FRAMES}`] : []),
      ...(scene.isHudOn ? [] : ['nohud']),
    ],
    '&',
  )
}

export const HARNESS_PATH = '/tools/audit/harness/'
