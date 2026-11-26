import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { PLAYER_RADIUS } from '../../shared/constants'
import { type Level, levelOf } from '../level/arena'
import { boxAround } from '../level/exits'
import { type LevelSpec, STACK_DROPS } from '../level/plan'
import {
  type Box,
  boxCenter,
  circleTouchesBox,
  tileBox,
  tilesWithSymbol,
} from '../level/tileGrid'
import { forEachSeat, modifySeat, seatStateAt } from '../party/party'
import type { World } from '../schema/world'
import type { Vector } from '../schema/worldSchema'
import { knockDownWhere } from '../stations/knockDown'
import { TOOL_RULES, isToolActive } from '../stations/toolRules'
import { ZERO_VECTOR, isInsideBox } from '../step/geometry'
import { bodyRadiusOf, isGrounded } from '../zombies/zombies'

export type StackId = keyof typeof STACK_DROPS

export const STACK_IDS: ReadonlyArray<StackId> = ['NorthStack', 'SouthStack']

const heapBoxes = new WeakMap<
  LevelSpec,
  Readonly<Record<StackId, Option.Option<Box>>>
>()

const heapBoxIn = (level: Level, id: StackId): Option.Option<Box> =>
  boxAround(Array.map(tilesWithSymbol(level, STACK_DROPS[id].symbol), tileBox))

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

export const toppleStack: {
  (id: StackId): (world: World) => World
  (world: World, id: StackId): World
} = Function.dual(2, (world: World, id: StackId): World =>
  Option.match(heapBoxOf(levelOf(world), id), {
    onNone: () => world,
    onSome: heap => {
      const toppled = UiStruct.evolve(world, {
        level: state =>
          UiStruct.evolve(state, {
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
      const zombiesOut = UiStruct.evolve(crushed, {
        zombies: zombies =>
          Array.map(zombies, zombie => {
            const out = outOfHeap(heap, bodyRadiusOf(zombie), zombie)
            return out === zombie
              ? zombie
              : UiStruct.evolve(zombie, { x: () => out.x, y: () => out.y })
          }),
      })
      return forEachSeat(zombiesOut, (current, slot) => {
        const { player } = seatStateAt(current, slot)
        const out = outOfHeap(heap, PLAYER_RADIUS, player)
        return out === player
          ? current
          : modifySeat(current, slot, {
              player: each =>
                UiStruct.evolve(each, { x: () => out.x, y: () => out.y }),
            })
      })
    },
  }),
)

export const shelveHeaps = (world: World): World => {
  const raised = Array.filter(
    STACK_IDS,
    id => isHeapDown(world, id) && !isToolActive(world, id),
  )
  return Array.isReadonlyArrayEmpty(raised)
    ? world
    : UiStruct.evolve(world, {
        level: state =>
          UiStruct.evolve(state, {
            dropped: dropped =>
              Array.filter(
                dropped,
                each => !Array.some(raised, id => STACK_DROPS[id].id === each),
              ),
          }),
      })
}
