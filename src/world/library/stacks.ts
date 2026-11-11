import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { PLAYER_RADIUS } from '../../shared/constants'
import {
  type Box,
  type Level,
  boxCenter,
  circleTouchesBox,
  levelOf,
  tileBox,
  tilesWithSymbol,
} from '../level/arena'
import { boxAround } from '../level/exits'
import { type LevelSpec, STACK_DROPS } from '../level/plan'
import { forEachSeat, modifySeat, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'
import { knockDownWhere } from '../stations/knockDown'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'
import { ZERO_VECTOR, isInsideBox } from '../step/geometry'
import { bodyRadiusOf, isGrounded } from '../zombies/zombies'

// The library's leaning stacks (docs/ROOM_RESEARCH.md, "The library:
// TOPPLE"), two room tools. Worked (a still player at the stack's end,
// src/world/stations/stations.ts), a stack's leaning top topples: a heap of
// books lands across the aisle next to it (the north stack across the
// north door's aisle, the south one across the corridor), crushing every
// zombie under it, and lies there as a wall while its tool is active, then
// the house shelves the books again. The heap is the level's drop
// (LevelState.dropped), as the chandelier is, so its tiles are solid for
// every walker, bullet, and path with no rule of their own. It never hurts
// a player: one under it is stepped out to its nearer side.

export type StackId = keyof typeof STACK_DROPS

export const STACK_IDS: ReadonlyArray<StackId> = ['NorthStack', 'SouthStack']

const heapBoxes = new WeakMap<
  LevelSpec,
  Readonly<Record<StackId, Option.Option<Box>>>
>()

const heapBoxIn = (level: Level, id: StackId): Option.Option<Box> =>
  boxAround(Array.map(tilesWithSymbol(level, STACK_DROPS[id].symbol), tileBox))

// NOTE: where a stack's heap lands: the box of its drop's tiles. A spec
// keeps its boxes.
export const heapBoxOf: {
  (id: StackId): (level: Level) => Option.Option<Box>
  (level: Level, id: StackId): Option.Option<Box>
} = Function.dual(2, (level: Level, id: StackId): Option.Option<Box> => {
  const cached = heapBoxes.get(level.spec)
  if (cached !== undefined) {
    return cached[id]
  }
  const boxes = {
    NorthStack: heapBoxIn(level, 'NorthStack'),
    SouthStack: heapBoxIn(level, 'SouthStack'),
  }
  heapBoxes.set(level.spec, boxes)
  return boxes[id]
})

export const isHeapDown: {
  (id: StackId): (world: World) => boolean
  (world: World, id: StackId): boolean
} = Function.dual(2, (world: World, id: StackId): boolean =>
  Array.contains(world.level.dropped, STACK_DROPS[id].id),
)

// NOTE: a body in the heap is set down at its nearer side, across the
// heap's short way.
const outOfHeap = (heap: Box, radius: number, body: Vector): Vector => {
  if (!isInsideBox(body, heap)) {
    return body
  }
  const middle = boxCenter(heap)
  return heap.right - heap.left >= heap.bottom - heap.top
    ? {
        x: body.x,
        y: body.y < middle.y ? heap.top - radius : heap.bottom + radius,
      }
    : {
        x: body.x < middle.x ? heap.left - radius : heap.right + radius,
        y: body.y,
      }
}

// NOTE: a worked stack topples: its heap drops, crushing the zombies
// under it, and steps any player there out.
export const toppleStack: {
  (id: StackId): (world: World) => World
  (world: World, id: StackId): World
} = Function.dual(2, (world: World, id: StackId): World =>
  Option.match(heapBoxOf(levelOf(world), id), {
    onNone: () => world,
    onSome: heap => {
      const toppled = modifyFields(world, {
        level: state =>
          modifyFields(state, {
            dropped: dropped => Array.append(dropped, STACK_DROPS[id].id),
          }),
      })
      const crushed = knockDownWhere(toppled, zombie =>
        isGrounded(zombie) &&
        circleTouchesBox(zombie, bodyRadiusOf(zombie), heap)
          ? Option.some({
              damage: TOOL_RULES[id].damage,
              direction: ZERO_VECTOR,
              knockbackSpeed: 0,
              dazeMs: 0,
            })
          : Option.none(),
      )
      const zombiesOut = modifyFields(crushed, {
        zombies: zombies =>
          Array.map(zombies, zombie => {
            const out = outOfHeap(heap, bodyRadiusOf(zombie), zombie)
            return out === zombie
              ? zombie
              : modifyFields(zombie, { x: () => out.x, y: () => out.y })
          }),
      })
      return forEachSeat(zombiesOut, (current, slot) => {
        const { player } = seatStateAt(current, slot)
        const out = outOfHeap(heap, PLAYER_RADIUS, player)
        return out === player
          ? current
          : modifySeat(current, slot, {
              player: each =>
                modifyFields(each, { x: () => out.x, y: () => out.y }),
            })
      })
    },
  }),
)

// NOTE: once a stack's tool is no longer active, the house shelves its
// heap again and the aisle is clear.
export const shelveHeaps = (world: World): World => {
  const raised = Array.filter(
    STACK_IDS,
    id => isHeapDown(world, id) && !isToolActive(world, id),
  )
  return Array.isReadonlyArrayEmpty(raised)
    ? world
    : modifyFields(world, {
        level: state =>
          modifyFields(state, {
            dropped: dropped =>
              Array.filter(
                dropped,
                each => !Array.some(raised, id => STACK_DROPS[id].id === each),
              ),
          }),
      })
}
