import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { GunSlot } from '../world/schema/worldSchema'
import { PointerDevice, TouchControls } from './inputSchema'

// NOTE: the root's Messages from the keyboard, the mouse, and touch, and the
// game surface they land on. src/app/message.ts joins them into the root's
// Message union; their handlers are in src/app/update/input.ts.
export const inputCases = {
  PressedKey: { code: Schema.String },
  ReleasedKey: { code: Schema.String },
  PressedMetaKey: {},
  MissedKeyDown: { code: Schema.String },
  PressedPointer: {
    pointerId: Schema.Finite,
    device: PointerDevice,
    clientX: Schema.Finite,
    clientY: Schema.Finite,
  },
  PressedHudSlot: {
    pointerId: Schema.Finite,
    device: PointerDevice,
    clientX: Schema.Finite,
    clientY: Schema.Finite,
  },
  MovedPointer: {
    pointerId: Schema.Finite,
    clientX: Schema.Finite,
    clientY: Schema.Finite,
  },
  ReleasedPointer: { pointerId: Schema.Finite },
  CancelledPointer: { pointerId: Schema.Finite },
  ReleasedEveryTouch: {},
  MovedMouse: { clientX: Schema.Finite, clientY: Schema.Finite },
  SuppressedContextMenu: {},
  TappedWithTouch: {},
  MeasuredGameSurface: {
    left: Schema.Finite,
    top: Schema.Finite,
    width: Schema.Finite,
    height: Schema.Finite,
  },
  CompletedDetectInputDevice: { touchControls: TouchControls },
}
export const InputMessage = defineMessageUnion(inputCases)

export type PressedHudSlot = typeof InputMessage.PressedHudSlot.Type

// NOTE: the run's buttons: the touch HUD's slots, reload, MEDIC, traps,
// READY, the hold-to-buy button, and pause. Each goes to
// the room in an online run (orInRun, src/app/update/coopRun.ts).
export const runButtonCases = {
  PressedHoldButton: { pointerId: Schema.Finite },
  ClickedPauseButton: {},
  ClickedStartWaveButton: {},
  ClickedSwapButton: {},
  ClickedGunSlot: { slot: GunSlot },
  ClickedMeleeSlot: {},
  ClickedReloadButton: {},
  ClickedMedicButton: {},
  ClickedPlaceTrapButton: {},
  ClickedNextTrapButton: {},
}
export const RunButtonMessage = defineMessageUnion(runButtonCases)
export type RunButtonMessage = typeof RunButtonMessage.Type
