import { Function, Option } from 'effect'

import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  STEP_EPSILON_MS,
} from '../shared/constants'

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
