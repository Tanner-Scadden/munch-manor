import { Array, Option } from 'effect'

import type { Level } from './arena.ts'
import { DINING_ROOM_ID, LIBRARY_ROOM_ID, PARLOUR_ROOM_ID } from './plan.ts'

export type Rug = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export const PARLOUR_RUG: Rug = { x: 72, y: 52, width: 176, height: 76 }

export const DINING_RUGS: ReadonlyArray<Rug> = [
  { x: 62, y: 86, width: 236, height: 48 },
  { x: 166, y: 138, width: 28, height: 62 },
]

export const LIBRARY_RUG: Rug = { x: 176, y: 102, width: 108, height: 36 }

const RUGS_BY_ROOM: ReadonlyArray<
  Readonly<{ roomId: string; rugs: ReadonlyArray<Rug> }>
> = [
  { roomId: PARLOUR_ROOM_ID, rugs: [PARLOUR_RUG] },
  { roomId: DINING_ROOM_ID, rugs: DINING_RUGS },
  { roomId: LIBRARY_ROOM_ID, rugs: [LIBRARY_RUG] },
]

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
