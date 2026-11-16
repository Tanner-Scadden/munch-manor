import { Function, Option, Schema } from 'effect'

import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  STEP_EPSILON_MS,
} from '../shared/constants'
import { Phase } from '../world/schema/worldSchema'
import type { Model } from './model'

// NOTE: the sim steps at a fixed 60 Hz (ticksIn in src/app/frame.ts), so a
// display frame that owes no tick changes nothing in the World. A 120 Hz
// screen would still send it, and the whole view and the 3D scene would
// draw it, about twice the work of 60 Hz for the same game. The gate keeps
// a frame's time until the frames it has kept owe a tick, then sends their
// sum as one frame: a 60 Hz screen sends every frame as before, a 120 Hz
// one every other, a 90 Hz one two of three, so the game draws at most
// about 60 times a second on any screen.
// `carryMs` follows the update's own carry (clamped the same way), so a
// frame sent owes the update a tick. A frame a little short of the step
// (`EARLY_MS`) is sent too, since a 60 Hz screen's frames jitter round it.
const EARLY_MS = 1

export type FrameGate = Readonly<{ heldMs: number; carryMs: number }>

export const OPEN_GATE: FrameGate = { heldMs: 0, carryMs: 0 }

export type Gated = Readonly<{ gate: FrameGate; sendMs: Option.Option<number> }>

const carryAfterTicks = (carryMs: number): number =>
  carryMs >= FIXED_STEP_MS - STEP_EPSILON_MS
    ? carryAfterTicks(carryMs - FIXED_STEP_MS)
    : Math.max(0, carryMs)

export const gateFrame: {
  (deltaMs: number): (gate: FrameGate) => Gated
  (gate: FrameGate, deltaMs: number): Gated
} = Function.dual(2, (gate: FrameGate, deltaMs: number): Gated => {
  const heldMs = gate.heldMs + deltaMs
  const carryMs = gate.carryMs + Math.min(deltaMs, MAX_FRAME_DELTA_MS)
  return carryMs >= FIXED_STEP_MS - EARLY_MS
    ? {
        gate: { heldMs: 0, carryMs: carryAfterTicks(carryMs) },
        sendMs: Option.some(heldMs),
      }
    : { gate: { heldMs, carryMs }, sendMs: Option.none() }
})

// NOTE: a frame on the title, its menus, and the lobbies over it: nothing
// there moves faster than the diorama's 30 frames a second
// (src/render/iso/diorama.ts) or a menu's own art (a sprite's step of 50 ms
// or more, the logo's bob of a pixel or two), so their frames go at most
// 30 times a second, half the views and updates of play. A frame a little
// short (`MENU_EARLY_MS`) goes too, so a 60 Hz screen's jitter never holds
// one for a third frame.
const MENU_FRAME_MS = 1000 / 30
const MENU_EARLY_MS = 4

export const gateMenuFrame: {
  (deltaMs: number): (gate: FrameGate) => Gated
  (gate: FrameGate, deltaMs: number): Gated
} = Function.dual(2, (gate: FrameGate, deltaMs: number): Gated => {
  const heldMs = gate.heldMs + deltaMs
  const dueMs = heldMs + gate.carryMs
  // NOTE: a frame sent early owes its few milliseconds to the next, so a
  // fast screen's frames average 30 a second, never more.
  return dueMs >= MENU_FRAME_MS - MENU_EARLY_MS
    ? {
        gate: {
          heldMs: 0,
          carryMs: Math.min(0, Math.max(-MENU_EARLY_MS, dueMs - MENU_FRAME_MS)),
        },
        sendMs: Option.some(heldMs),
      }
    : { gate: { heldMs, carryMs: gate.carryMs }, sendMs: Option.none() }
})

// NOTE: how fast a screen's frames go: play's 60 a second, or a menu's 30.
export const FramePace = Schema.Literals(['Play', 'Menu'])
export type FramePace = typeof FramePace.Type

// NOTE: the title and every menu and lobby over it go at a menu's pace; a
// run and its end card at play's.
export const framePaceOf = (model: Model): FramePace =>
  Phase.isAnyOf(['Ready'])(model.phase) ? 'Menu' : 'Play'

export const gateFor = (
  pace: FramePace,
): ((gate: FrameGate, deltaMs: number) => Gated) =>
  pace === 'Menu' ? gateMenuFrame : gateFrame
