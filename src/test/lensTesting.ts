import { Message } from '../app/message'
import {
  type LensFrame,
  floorToScreenDirection,
  lensOf,
  screenToFloorDirection,
} from '../render/lens'
import { STICK_RADIUS_PX } from '../shared/constants'
import { hypot } from '../shared/detMath'
import type { Vector } from '../world/schema/entitySchema'
import { type StoryStep, send, steps } from './testing'

const WALK_THUMB = 71

export const walkToward = (direction: Vector): StoryStep => {
  const onScreen = floorToScreenDirection(direction)
  const length = Math.max(1e-9, hypot(onScreen.x, onScreen.y))
  return steps(
    send(
      Message.PressedPointer({
        pointerId: WALK_THUMB,
        device: 'Touch',
        clientX: 100,
        clientY: 200,
      }),
    ),
    send(
      Message.MovedPointer({
        pointerId: WALK_THUMB,
        clientX: 100 + (onScreen.x / length) * STICK_RADIUS_PX,
        clientY: 200 + (onScreen.y / length) * STICK_RADIUS_PX,
      }),
    ),
  )
}

export const releaseWalk: StoryStep = send(
  Message.ReleasedPointer({ pointerId: WALK_THUMB }),
)

export const RIGHT_ON_SCREEN = screenToFloorDirection({ x: 1, y: 0 })

export const floorSeenOf = (
  camera: LensFrame,
): Readonly<{ top: number; bottom: number }> => {
  const lens = lensOf(camera)
  const middleX = camera.left + (camera.width * camera.scale) / 2
  const at = { x: 0, y: 0 }
  const top = lens.unprojectInto(middleX, camera.top, at).y
  const bottom = lens.unprojectInto(
    middleX,
    camera.top + camera.height * camera.scale,
    at,
  ).y
  return { top, bottom }
}

export const nearly = ({ x, y }: Vector): Vector => ({
  x: Math.round(x * 1e6) / 1e6 + 0,
  y: Math.round(y * 1e6) / 1e6 + 0,
})
