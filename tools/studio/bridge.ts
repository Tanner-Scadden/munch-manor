import { Option, Predicate } from 'effect'

import type { LabTables } from './lab'

export const BRIDGE_KEY = '__studioBridge'

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
  snapshot: () => HTMLCanvasElement | undefined
  tune: (tables: LabTables) => void
}>

const isBridge = (value: unknown): value is StudioBridge =>
  Predicate.hasProperty(value, 'view') &&
  Predicate.isFunction(value.view) &&
  Predicate.hasProperty(value, 'snapshot') &&
  Predicate.isFunction(value.snapshot) &&
  Predicate.hasProperty(value, 'tune') &&
  Predicate.isFunction(value.tune)

export const bridgeOf = (
  frame: Window | null | undefined,
): Option.Option<StudioBridge> => {
  if (frame === null || frame === undefined || !(BRIDGE_KEY in frame)) {
    return Option.none()
  }
  const value: unknown = Reflect.get(frame, BRIDGE_KEY)
  return isBridge(value) ? Option.some(value) : Option.none()
}
