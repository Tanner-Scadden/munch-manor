import { Function } from 'effect'

import type { World } from '../schema/world'
import type { StationId } from '../schema/worldSchema'

// The room tools' numbers, all in one table (docs/ROOM_RESEARCH.md,
// "Decided", owner 2026-11-10: every tool is a work station on its own
// cooldown, longer for a stronger tool, used mid-wave). Every tool has its
// set-up (`setUpMs` of a still player's work, src/world/stations/), its
// `cooldownMs` from the moment it fires, the `reachPx` a player may stand
// from its tile, and `activeMs`, how long its effect lasts after it fires:
// the first `activeMs` of the cooldown. So a tool's effect is read off its
// station's own clock and needs no field of its own on the wire. The rest
// of each entry is that tool's own numbers. Untuned: no balance pass until
// the rooms rework and the pacing are both in (owner, 2026-11-10).

const REACH_PX = 8

type ToolTimes = Readonly<{
  setUpMs: number
  cooldownMs: number
  reachPx: number
  activeMs: number
}>

// NOTE: every tool has its times; each keeps its own numbers besides.
const toolTable = <Rules extends Readonly<Record<StationId, ToolTimes>>>(
  rules: Rules,
): Rules => rules

export const TOOL_RULES = toolTable({
  // NOTE: winches the fallen chandelier back up (src/world/dining/).
  Cleat: {
    setUpMs: 3000,
    cooldownMs: 20_000,
    reachPx: REACH_PX,
    activeMs: 0,
  },
  // NOTE: plays a waltz for 10 s: Groaners and Kaboomers in the parlour
  // stop chasing and turn slow circles at a third of their pace, drifting
  // toward the dance floor (src/world/parlour/gramophone.ts). A lure, not a
  // shield: one you walk into still bites.
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
  // NOTE: the leaning stacks topple: 60 damage to every zombie under the
  // heap (the chandelier's crush, so all but the boss), which lies there as a wall for 15 s (src/world/library/stacks.ts).
  // The strongest tool, so the longest cooldown.
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
  // NOTE: the opened secret shelf spins: its workers come out on the other
  // side of the wall, and every zombie within 36 px is flung away and
  // dazed (src/world/library/revolvingShelf.ts). Small, so short.
  Shelf: {
    setUpMs: 1000,
    cooldownMs: 12_000,
    reachPx: REACH_PX,
    activeMs: 600,
    shovePx: 36,
    shoveSpeed: 220,
    dazeMs: 800,
  },
  // NOTE: a barrel rolls west down the cellar's corridor at 180 px/s and
  // bowls over every zombie it meets: 4 damage (a Groaner's whole health,
  // a dent in a Big Lug), knocked along, dazed 1 s. It breaks on the far
  // wall (src/world/cellar/barrels.ts).
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
  // NOTE: a yank of the bulb's chain lights the cellar for 12 s. In the
  // dark, zombies in the cellar walk 15% faster, and the cellar's dare
  // thing glints only in the light (src/world/cellar/bulb.ts).
  Bulb: {
    setUpMs: 1000,
    cooldownMs: 25_000,
    reachPx: REACH_PX,
    activeMs: 12_000,
    darkPace: 1.15,
  },
  // NOTE: the soup pot tips: a fresh puddle 20 px across spills in front of
  // it for 10 s, and zombies that step in slip like on the old soup
  // (src/world/kitchen/soupPot.ts).
  SoupPot: {
    setUpMs: 2000,
    cooldownMs: 22_000,
    reachPx: REACH_PX,
    activeMs: 10_000,
    spillDownPx: 16,
    radiusPx: 20,
  },
})
// NOTE: how long since a tool fired, while its effect lasts.
const activeForMs = (world: World, id: StationId): number => {
  const state = world.stations[id]
  const rules = TOOL_RULES[id]
  return state.timesWorked > 0 && state.cooldownMs > 0
    ? rules.cooldownMs - state.cooldownMs
    : Infinity
}

// NOTE: whether a tool's effect is on: the first `activeMs` of its cooldown.
export const isToolActive: {
  (id: StationId): (world: World) => boolean
  (world: World, id: StationId): boolean
} = Function.dual(
  2,
  (world: World, id: StationId): boolean =>
    activeForMs(world, id) < TOOL_RULES[id].activeMs,
)

// NOTE: how far into its effect a tool is, in ms, while it is on.
export const toolActiveMs: {
  (id: StationId): (world: World) => number
  (world: World, id: StationId): number
} = Function.dual(2, (world: World, id: StationId): number =>
  Math.min(activeForMs(world, id), TOOL_RULES[id].activeMs),
)
