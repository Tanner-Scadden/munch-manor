import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { GunSlot } from '../world/schema/worldSchema'
import { PadDirection } from './gamepad'
import {
  Gamepad,
  PadClick,
  PadScope,
  PointerDevice,
  SurfaceRectangle,
  TouchControls,
} from './inputSchema'

// NOTE: the root's Messages from the keyboard, the mouse, touch, and a
// controller, and the game surface they land on. A controller is polled
// (src/app/subscriptions.ts): PolledGamepad comes only when it changed.
// src/app/message.ts joins them into the root's Message union; their
// handlers are in src/app/update/input.ts.
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
  MeasuredGameSurface: SurfaceRectangle.fields,
  CompletedDetectInputDevice: { touchControls: TouchControls },
  PolledGamepad: Gamepad.fields,
  DisconnectedGamepad: { index: Schema.Finite },
  CompletedRumble: {},
  RepeatedPadDirection: { direction: PadDirection },
  ClickedPadFocus: { scope: PadScope, outcome: PadClick },
  CompletedPadMenu: {},
}
export const InputMessage = defineMessageUnion(inputCases)

export type PressedHudSlot = typeof InputMessage.PressedHudSlot.Type
export type PolledGamepad = typeof InputMessage.PolledGamepad.Type
export type DisconnectedGamepad = typeof InputMessage.DisconnectedGamepad.Type
export type RepeatedPadDirection = typeof InputMessage.RepeatedPadDirection.Type

// NOTE: the run's buttons: the touch HUD's slots, reload, MEDIC, traps,
// READY, the hold-to-buy button, and pause. Each goes to
// the room in an online run (orInRun, src/app/update/coopRun.ts), but for
// the HUD's dare list, which opens the dare card on this client alone.
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
  ClickedDareList: {},
}
export const RunButtonMessage = defineMessageUnion(runButtonCases)
export type RunButtonMessage = typeof RunButtonMessage.Type
