import { Function } from 'effect'

import { type LensFrame, lensOf } from '../lens'

export type ViewBox = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const VIEW_MARGIN = 48

export const viewBoxOf = (frame: LensFrame): ViewBox => {
  const lens = lensOf(frame)
  const left = frame.left
  const top = frame.top
  const right = left + frame.width * frame.scale
  const bottom = top + frame.height * frame.scale
  const topLeft = lens.unprojectInto(left, top, { x: 0, y: 0 })
  const topRight = lens.unprojectInto(right, top, { x: 0, y: 0 })
  const bottomLeft = lens.unprojectInto(left, bottom, { x: 0, y: 0 })
  const bottomRight = lens.unprojectInto(right, bottom, { x: 0, y: 0 })
  return {
    left: Math.min(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    top: Math.min(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
    right: Math.max(topLeft.x, topRight.x, bottomLeft.x, bottomRight.x),
    bottom: Math.max(topLeft.y, topRight.y, bottomLeft.y, bottomRight.y),
  }
}

export const isNearView: {
  (view: ViewBox): (box: ViewBox) => boolean
  (box: ViewBox, view: ViewBox): boolean
} = Function.dual(
  2,
  (box: ViewBox, view: ViewBox): boolean =>
    box.left <= view.right + VIEW_MARGIN &&
    box.right >= view.left - VIEW_MARGIN &&
    box.top <= view.bottom + VIEW_MARGIN &&
    box.bottom >= view.top - VIEW_MARGIN,
)

export type ViewFloor = ReadonlyArray<Readonly<{ x: number; y: number }>>

export const viewFloorOf = (frame: LensFrame): ViewFloor => {
  const lens = lensOf(frame)
  const left = frame.left
  const top = frame.top
  const right = left + frame.width * frame.scale
  const bottom = top + (frame.height + VIEW_MARGIN) * frame.scale
  return [
    lens.unprojectInto(left, top, { x: 0, y: 0 }),
    lens.unprojectInto(right, top, { x: 0, y: 0 }),
    lens.unprojectInto(right, bottom, { x: 0, y: 0 }),
    lens.unprojectInto(left, bottom, { x: 0, y: 0 }),
  ]
}

export const boxFloorOf = (view: ViewBox): ViewFloor => [
  { x: view.left - VIEW_MARGIN, y: view.top - VIEW_MARGIN },
  { x: view.right + VIEW_MARGIN, y: view.top - VIEW_MARGIN },
  { x: view.right + VIEW_MARGIN, y: view.bottom + VIEW_MARGIN },
  { x: view.left - VIEW_MARGIN, y: view.bottom + VIEW_MARGIN },
]

const isPartedAlong = (
  box: ViewBox,
  floor: ViewFloor,
  normalX: number,
  normalY: number,
): boolean => {
  let floorLow = Number.POSITIVE_INFINITY
  let floorHigh = Number.NEGATIVE_INFINITY
  for (const { x, y } of floor) {
    const along = x * normalX + y * normalY
    floorLow = Math.min(floorLow, along)
    floorHigh = Math.max(floorHigh, along)
  }
  const xs = [box.left * normalX, box.right * normalX]
  const ys = [box.top * normalY, box.bottom * normalY]
  const boxLow = Math.min(...xs) + Math.min(...ys)
  const boxHigh = Math.max(...xs) + Math.max(...ys)
  return boxHigh < floorLow || boxLow > floorHigh
}

export const isOnFloorSeen: {
  (floor: ViewFloor): (box: ViewBox) => boolean
  (box: ViewBox, floor: ViewFloor): boolean
} = Function.dual(2, (box: ViewBox, floor: ViewFloor): boolean => {
  if (isPartedAlong(box, floor, 1, 0) || isPartedAlong(box, floor, 0, 1)) {
    return false
  }
  for (let index = 0; index < floor.length; index += 1) {
    const from = floor[index]
    const to = floor[(index + 1) % floor.length]
    if (
      from !== undefined &&
      to !== undefined &&
      isPartedAlong(box, floor, to.y - from.y, from.x - to.x)
    ) {
      return false
    }
  }
  return true
})
