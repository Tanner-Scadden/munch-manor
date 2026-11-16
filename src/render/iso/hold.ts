// The world's picture held behind a menu: while the World stands still (a
// paused run, an end card), the frames a menu's own animations render hand
// the world's element the same picture again and again. Each such frame
// carries a hold key, every input the picture is drawn from that can change
// while the World stands still; the element draws a frame only when its key
// differs from the last one drawn (src/render/iso/element.ts), so a phone
// resting on the pause screen or an end card draws no 3D at all.

import { Array, Option, Record, Result } from 'effect'

import type { Model } from '../../app/model'
import { isEndScreen } from '../../domain/run'
import { worldOf } from '../../world/schema/world'
import { Phase } from '../../world/schema/worldSchema'
import type { Camera } from '../camera'

// NOTE: the inputs, each compared by identity (or as a number).
export type HoldKey = ReadonlyArray<unknown>

// NOTE: the World's last events are emptied each frame and draw nothing
// here; the cosmetic generator's state and the dust clock draw nothing at
// all.
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

// NOTE: none while the World moves, so every frame draws. The end card's
// particles land and its shake settles in slow motion first; the key then
// stops changing and the picture holds.
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

// NOTE: whether a frame shows the picture last drawn: both held, and every
// input the same.
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
