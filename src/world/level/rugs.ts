import { Array, Option } from 'effect'

import type { Level } from './arena'
import { DINING_ROOM_ID, LIBRARY_ROOM_ID, PARLOUR_ROOM_ID } from './plan'

// The rugs and runners laid on the rooms' floors, placed by hand on each
// room's map from its top left. The art draws them (src/render/room/), and
// the roof leaks' puddles keep off them (src/world/level/leaks.ts), so they
// live here, where both read them.

export type Rug = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

// NOTE: the dance floor's rug, inside the parlour's ring of furniture.
export const PARLOUR_RUG: Rug = { x: 72, y: 52, width: 176, height: 76 }

// NOTE: the rug under the party table, and the hall runner from the front
// door up to the gap, placed by hand on the drafted map (docs/ROOM_DRAFTS.md).
export const DINING_RUGS: ReadonlyArray<Rug> = [
  { x: 62, y: 86, width: 236, height: 48 },
  { x: 166, y: 138, width: 28, height: 62 },
]

// NOTE: the long green rug under the reading desk in the nook.
export const LIBRARY_RUG: Rug = { x: 176, y: 102, width: 108, height: 36 }

const RUGS_BY_ROOM: ReadonlyArray<
  Readonly<{ roomId: string; rugs: ReadonlyArray<Rug> }>
> = [
  { roomId: PARLOUR_ROOM_ID, rugs: [PARLOUR_RUG] },
  { roomId: DINING_ROOM_ID, rugs: DINING_RUGS },
  { roomId: LIBRARY_ROOM_ID, rugs: [LIBRARY_RUG] },
]

// NOTE: every rug and runner on the level, on the level's map, for what
// must keep off them (a roof leak's puddle).
export const rugsOf = (level: Level): ReadonlyArray<Rug> =>
  Array.flatMap(RUGS_BY_ROOM, ({ roomId, rugs }) =>
    Option.match(
      Array.findFirst(level.rooms, ({ id }) => id === roomId),
      {
        onNone: () => [],
        onSome: ({ box }) =>
          Array.map(rugs, rug => ({
            ...rug,
            x: box.left + rug.x,
            y: box.top + rug.y,
          })),
      },
    ),
  )
