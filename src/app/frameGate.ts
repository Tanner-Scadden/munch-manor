import { Function, Option, Schema } from 'effect'

import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  STEP_EPSILON_MS,
} from '#shared/constants.ts'
import { Phase } from '#world/schema/worldSchema.ts'

import type { Model } from './model.ts'

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

const MENU_FRAME_MS = 1000 / 30
const MENU_EARLY_MS = 4

export const gateMenuFrame: {
  (deltaMs: number): (gate: FrameGate) => Gated
  (gate: FrameGate, deltaMs: number): Gated
} = Function.dual(2, (gate: FrameGate, deltaMs: number): Gated => {
  const heldMs = gate.heldMs + deltaMs
  const dueMs = heldMs + gate.carryMs
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

export const FramePace = Schema.Literals(['Play', 'Menu'])
export type FramePace = typeof FramePace.Type

export const framePaceOf = (model: Model): FramePace =>
  Phase.isAnyOf(['Ready'])(model.phase) ? 'Menu' : 'Play'

export const gateFor = (
  pace: FramePace,
): ((gate: FrameGate, deltaMs: number) => Gated) =>
  pace === 'Menu' ? gateMenuFrame : gateFrame
