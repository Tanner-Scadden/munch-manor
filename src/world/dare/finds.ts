import { Option, Record } from 'effect'

import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../level/plan'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'

// How each room finds its thing (docs/ROOM_RESEARCH.md, "Decided", owner
// 2026-11-10: "each room its own way"). A room names its find style here,
// and the dare's step (src/world/dare/dare.ts) reads the style of the room
// a thing lies in:
//
// - Walk: walking onto the thing finds it, as every room did before. The
//   dining room and any room that names no style keep it.
// - Rummage, the parlour: the thing is in an old trunk by the furniture.
//   Stand at it and keep still and you rummage, about 1 s, the lid creeping
//   open; the trunk springs open on the thing.
// - HollowBook, the library: one book sticks out of a short stack. Work it
//   out, about 1 s, and it falls open: hollow, the thing inside.
// - Dumbwaiter, the kitchen: a hatch with its rope. Haul the car up, 2 s in
//   the hottest room, and it rises with a ding, the thing on its tray.
//
// The work is the room tools' set-up (src/world/stations/stations.ts): a
// standing player keeping still in reach works it and cannot shoot, each
// player at it adds their own share, and it drains at half pace while
// nobody works it. `isReady` lets a room say when its thing can be worked
// at all (the cellar's, in a later layer, only in the light).

export type FindStyle = 'Walk' | 'Rummage' | 'HollowBook' | 'Dumbwaiter'

type FindRules = Readonly<{
  workMs: number
  reachPx: number
  isReady: (world: World, spot: Vector) => boolean
}>

const ALWAYS = (): boolean => true

export const FIND_RULES: Readonly<Record<FindStyle, FindRules>> = {
  Walk: { workMs: 0, reachPx: 10, isReady: ALWAYS },
  Rummage: { workMs: 1000, reachPx: 12, isReady: ALWAYS },
  HollowBook: { workMs: 1000, reachPx: 12, isReady: ALWAYS },
  Dumbwaiter: { workMs: 2000, reachPx: 12, isReady: ALWAYS },
}

// NOTE: each room's find, by its id. The cellar walks onto its thing until
// its bulb lights it (part 2 of the rooms rework).
const ROOM_FINDS: Readonly<Record<string, FindStyle>> = {
  [PARLOUR_ROOM_ID]: 'Rummage',
  [LIBRARY_ROOM_ID]: 'HollowBook',
  [KITCHEN_ROOM_ID]: 'Dumbwaiter',
  [CELLAR_ROOM_ID]: 'Walk',
  [DINING_ROOM_ID]: 'Walk',
}

export const findStyleOfRoom = (room: string): FindStyle =>
  Option.getOrElse(Record.get(ROOM_FINDS, room), (): FindStyle => 'Walk')

// NOTE: whether a style asks for work, rather than a walk onto it.
export const isWorkedFind = (style: FindStyle): boolean =>
  FIND_RULES[style].workMs > 0
