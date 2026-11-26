import { Array, Option, Record, Result } from 'effect'

import type { Model } from '../../app/model'
import { isEndScreen } from '../../domain/run'
import { worldOf } from '../../world/schema/world'
import { Phase } from '../../world/schema/worldSchema'
import type { Camera } from '../camera'

export type HoldKey = ReadonlyArray<unknown>

const UNDRAWN: ReadonlySet<string> = new Set([
  'frameEvents',
  'cosmeticRngState',
  'dustCooldownMs',
])

const drawnValues = (record: Readonly<Record<string, unknown>>) =>
  Array.filterMap(Record.toEntries(record), ([key, value]) =>
    UNDRAWN.has(key) ? Result.failVoid : Result.succeed(value),
  )

const isWorldStill = (model: Model): boolean =>
  Phase.isAnyOf(['Paused'])(model.phase) || isEndScreen(model.phase)

export const holdKeyOf = (
  input: Readonly<{
    model: Model
    camera: Camera
    shake: Readonly<{ x: number; y: number }>
  }>,
): Option.Option<HoldKey> => {
  const { model, camera, shake } = input
  return isWorldStill(model)
    ? Option.some([
        ...drawnValues(worldOf(model)),
        ...drawnValues(model.cosmetics),
        shake.x,
        shake.y,
        camera.x,
        camera.y,
        camera.width,
        camera.height,
        camera.scale,
        camera.left,
        camera.top,
        model.maybeSurface,
        model.appearance,
        model.settings,
      ])
    : Option.none()
}

export const isHeldOver = (
  input: Readonly<{
    drawn: Option.Option<HoldKey>
    next: Option.Option<HoldKey>
  }>,
): boolean => {
  const { drawn, next } = input
  if (Option.isNone(drawn) || Option.isNone(next)) {
    return false
  }
  return (
    drawn.value.length === next.value.length &&
    Array.every(next.value, (value, index) => value === drawn.value[index])
  )
}
