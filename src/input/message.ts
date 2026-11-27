import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { GunSlot } from '#world/schema/worldSchema.ts'

import { PadDirection } from './gamepad.ts'
import {
  Gamepad,
  PadClick,
  PadScope,
  PointerDevice,
  SurfaceRectangle,
  TouchControls,
} from './inputSchema.ts'

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
  ChangedTouches: {
    points: Schema.Array(
      Schema.Struct({ clientX: Schema.Finite, clientY: Schema.Finite }),
    ),
  },
  MovedMouse: { clientX: Schema.Finite, clientY: Schema.Finite },
  SuppressedContextMenu: {},
  TappedWithTouch: {},
  MeasuredGameSurface: SurfaceRectangle.fields,
  CompletedDetectInputDevice: { touchControls: TouchControls },
  PolledGamepad: Gamepad.fields,
  DisconnectedGamepad: { index: Schema.Finite },
  RepeatedPadDirection: { direction: PadDirection },
  ClickedPadFocus: { scope: PadScope, outcome: PadClick },
}
export const InputMessage = UiSchema.TaggedEnum(inputCases)

export type PressedHudSlot = typeof InputMessage.cases.PressedHudSlot.Type
export type PolledGamepad = typeof InputMessage.cases.PolledGamepad.Type
export type DisconnectedGamepad =
  typeof InputMessage.cases.DisconnectedGamepad.Type
export type RepeatedPadDirection =
  typeof InputMessage.cases.RepeatedPadDirection.Type

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
export const RunButtonMessage = UiSchema.TaggedEnum(runButtonCases)
export type RunButtonMessage = typeof RunButtonMessage.Type
