import { type Vector } from './basics'

// THE KITCHEN ROUTE

// The bot walks straight lines, so the way between the parlour and the
// fridge goes by waypoints: the kitchen's double door, a spot inside it,
// the open floor east of the prep table, up the lane west of the sacks,
// then east to the fridge.
const KITCHEN_DOOR_X = 70
const PARLOUR_SIDE: Vector = { x: KITCHEN_DOOR_X, y: 14 }
const KITCHEN_SIDE: Vector = { x: KITCHEN_DOOR_X, y: -42 }
const KITCHEN_EAST: Vector = { x: 150, y: -48 }
// NOTE: the fridge stands in the north-east corner above a pile of sacks,
// so the bot goes up the open lane west of the sacks, then east to it.
const FRIDGE_LANE: Vector = { x: 150, y: -104 }

export const isInKitchen = (point: Vector) => point.y < -2

const isInDoorColumn = (point: Vector) =>
  Math.abs(point.x - KITCHEN_DOOR_X) <= 6

// The next point to walk to on the way to goal.
export const routeTo = (from: Vector, goal: Vector): Vector => {
  if (isInKitchen(from) === isInKitchen(goal)) {
    if (!isInKitchen(goal) || goal.y >= -55 || Math.abs(from.x - goal.x) <= 6) {
      return goal
    }
    if (from.y > -55 && Math.abs(from.x - KITCHEN_EAST.x) > 6) {
      return KITCHEN_EAST
    }
    return from.y > FRIDGE_LANE.y + 2 ? FRIDGE_LANE : goal
  }
  if (!isInKitchen(from)) {
    return isInDoorColumn(from) && from.y < 22 ? KITCHEN_SIDE : PARLOUR_SIDE
  }
  if (from.y < -55 && from.x > 135) {
    return KITCHEN_EAST
  }
  return isInDoorColumn(from) && from.y > -48 ? PARLOUR_SIDE : KITCHEN_SIDE
}
