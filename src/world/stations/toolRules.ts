import { Function } from 'effect'

import type { World } from '#world/schema/world.ts'
import type { StationId } from '#world/schema/worldSchema.ts'

const REACH_PX = 8

type ToolTimes = Readonly<{
  setUpMs: number
  cooldownMs: number
  reachPx: number
  activeMs: number
}>

const toolTable = <Rules extends Readonly<Record<StationId, ToolTimes>>>(
  rules: Rules,
): Rules => rules

export const TOOL_RULES = toolTable({
  Cleat: {
    setUpMs: 3000,
    cooldownMs: 20_000,
    reachPx: REACH_PX,
    activeMs: 0,
  },
  Gramophone: {
    setUpMs: 2000,
    cooldownMs: 30_000,
    reachPx: REACH_PX,
    activeMs: 10_000,
    danceScale: 0.35,
    turnMs: 1500,
    driftScale: 0.3,
    floorPx: 36,
  },
  NorthStack: {
    setUpMs: 2000,
    cooldownMs: 40_000,
    reachPx: REACH_PX,
    activeMs: 15_000,
    damage: 60,
  },
  SouthStack: {
    setUpMs: 2000,
    cooldownMs: 40_000,
    reachPx: REACH_PX,
    activeMs: 15_000,
    damage: 60,
  },
  Shelf: {
    setUpMs: 1000,
    cooldownMs: 12_000,
    reachPx: REACH_PX,
    activeMs: 600,
    shovePx: 36,
    shoveSpeed: 220,
    dazeMs: 800,
  },
  Barrels: {
    setUpMs: 1500,
    cooldownMs: 15_000,
    reachPx: REACH_PX,
    activeMs: 2500,
    rollSpeed: 180,
    radiusPx: 7,
    damage: 4,
    dazeMs: 1000,
    knockback: 140,
  },
  Bulb: {
    setUpMs: 1000,
    cooldownMs: 25_000,
    reachPx: REACH_PX,
    activeMs: 12_000,
    darkPace: 1.15,
  },
  SoupPot: {
    setUpMs: 2000,
    cooldownMs: 22_000,
    reachPx: REACH_PX,
    activeMs: 10_000,
    spillDownPx: 16,
    radiusPx: 20,
  },
})
const activeForMs = (world: World, id: StationId): number => {
  const state = world.stations[id]
  const rules = TOOL_RULES[id]
  return state.timesWorked > 0 && state.cooldownMs > 0
    ? rules.cooldownMs - state.cooldownMs
    : Infinity
}

export const isToolActive: {
  (id: StationId): (world: World) => boolean
  (world: World, id: StationId): boolean
} = Function.dual(
  2,
  (world: World, id: StationId): boolean =>
    activeForMs(world, id) < TOOL_RULES[id].activeMs,
)

export const toolActiveMs: {
  (id: StationId): (world: World) => number
  (world: World, id: StationId): number
} = Function.dual(2, (world: World, id: StationId): number =>
  Math.min(activeForMs(world, id), TOOL_RULES[id].activeMs),
)
