// What the audit harness hands Munch Studio about the live scene it shows in
// Studio's frame (tools/audit/harness/entry.ts sets it on its window): the
// world camera, where the world's view sits on its page, and a copy of the
// world's pixels. Plain types and a guard, so both sides read it without
// importing each other's modules.
import { Option, Predicate } from 'effect'

// NOTE: the window key the harness puts the bridge on.
export const BRIDGE_KEY = '__studioBridge'

// NOTE: the world camera's view in game pixels (x and y its top left), and
// the world view's box on the harness's page, in CSS pixels.
export type BridgeView = Readonly<{
  cameraX: number
  cameraY: number
  viewWidth: number
  viewHeight: number
  left: number
  top: number
  width: number
  height: number
}>

export type StudioBridge = Readonly<{
  view: () => BridgeView | undefined
  // NOTE: the world's frame drawn again and copied, in its canvas's own
  // pixels. A canvas of the harness's page, so only drawn from, never
  // checked with `instanceof` here.
  snapshot: () => HTMLCanvasElement | undefined
}>

const isBridge = (value: unknown): value is StudioBridge =>
  Predicate.hasProperty(value, 'view') &&
  Predicate.isFunction(value.view) &&
  Predicate.hasProperty(value, 'snapshot') &&
  Predicate.isFunction(value.snapshot)

export const bridgeOf = (
  frame: Window | null | undefined,
): Option.Option<StudioBridge> => {
  if (frame === null || frame === undefined || !(BRIDGE_KEY in frame)) {
    return Option.none()
  }
  const value: unknown = Reflect.get(frame, BRIDGE_KEY)
  return isBridge(value) ? Option.some(value) : Option.none()
}
