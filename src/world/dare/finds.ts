import { Option, Record } from 'effect'

import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '#world/level/plan.ts'
import type { World } from '#world/schema/world.ts'
import type { Vector } from '#world/schema/worldSchema.ts'

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

const ROOM_FINDS: Readonly<Record<string, FindStyle>> = {
  [PARLOUR_ROOM_ID]: 'Rummage',
  [LIBRARY_ROOM_ID]: 'HollowBook',
  [KITCHEN_ROOM_ID]: 'Dumbwaiter',
  [CELLAR_ROOM_ID]: 'Walk',
  [DINING_ROOM_ID]: 'Walk',
}

export const findStyleOfRoom = (room: string): FindStyle =>
  Option.getOrElse(Record.get(ROOM_FINDS, room), (): FindStyle => 'Walk')

export const isWorkedFind = (style: FindStyle): boolean =>
  FIND_RULES[style].workMs > 0
