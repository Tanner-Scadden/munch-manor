import { Array, Option, Order } from 'effect'
import type { Canvas } from 'foldkit'
import { describe, expect, test } from 'vitest'

import { zombieAt } from '../../../test/testing'
import { levelFor } from '../../../world/level/arena'
import { MANOR_SPEC } from '../../../world/level/plan'
import { isInsideRoomAt, isSolidAt } from '../../../world/level/tileQueries'
import type { Player, Zombie } from '../../../world/schema/entitySchema'
import { initialPlayer } from '../../../world/schema/worldSchema'
import { depthSortedShapes } from '../../depth'
import { type TallCover, tallCoverDrawables, tallCoverOf } from '../tallCover'

const level = levelFor(MANOR_SPEC)

// NOTE: a freestanding piece: one with floor above it, so someone can stand
// behind it. The widest keeps the test clear of its sides.
const piece: TallCover = Option.getOrThrow(
  Array.last(
    Array.sort(
      Array.filter(tallCoverOf(level), ({ left, right, artTop }) => {
        const x = (left + right) / 2
        const y = artTop + 6
        return isInsideRoomAt(level, { x, y }) && !isSolidAt(level, { x, y })
      }),
      Order.mapInput(
        Order.Number,
        ({ left, right }: TallCover) => right - left,
      ),
    ),
  ),
)

const middle = (piece.left + piece.right) / 2

// NOTE: spots by the feet: a player's and a Groaner's feet are 5 px under
// their middle.
type Spot = Readonly<{ x: number; footY: number }>
const FOOT_PX = 5

const behindIt: Spot = { x: middle, footY: piece.artTop + 12 }
const inFront: Spot = { x: middle, footY: piece.footY + 4 }
// NOTE: across the house, far from anything behind the piece.
const farAway: Spot = { x: middle + 400, footY: piece.footY + 200 }

const playerOn = ({ x, footY }: Spot): Player => ({
  ...initialPlayer,
  x,
  y: footY - FOOT_PX,
})

const zombieOn = ({ x, footY }: Spot): Zombie => zombieAt(1, x, footY - FOOT_PX)

const opacityOf = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Option.getOrElse(
    Option.flatMap(Array.head(shapes), shape =>
      shape._tag === 'Group'
        ? Option.fromNullishOr(shape.opacity)
        : Option.none(),
    ),
    () => 1,
  )

const drawnFor = (
  players: ReadonlyArray<Spot>,
  zombies: ReadonlyArray<Spot> = [],
) =>
  Array.filter(
    tallCoverDrawables(
      level,
      Array.map(players, playerOn),
      Array.map(zombies, zombieOn),
    ),
    ({ footY }) => footY === piece.footY,
  )

describe('tall cover', () => {
  test('the levels have tall pieces to stand behind', () => {
    expect(tallCoverOf(level).length).toBeGreaterThan(0)
  })

  test('nothing extra is drawn while nobody is behind a piece', () => {
    expect(drawnFor([inFront])).toEqual([])
    expect(drawnFor([])).toEqual([])
  })

  test('a player behind a piece shows through it, faded', () => {
    const [drawn] = drawnFor([behindIt])
    expect(drawn?.rank).toBe('Prop')
    expect(opacityOf(drawn?.shapes ?? [])).toBeCloseTo(0.4)
  })

  test('the fade deepens as a player steps in behind', () => {
    const [shallow] = drawnFor([{ x: middle, footY: piece.artTop + 3 }])
    expect(opacityOf(shallow?.shapes ?? [])).toBeGreaterThan(0.4)
    expect(opacityOf(shallow?.shapes ?? [])).toBeLessThan(1)
  })

  test('a zombie far from every player is hidden behind it, not faded', () => {
    const [drawn] = drawnFor([farAway], [behindIt])
    expect(opacityOf(drawn?.shapes ?? [])).toBe(1)
  })

  test('a zombie behind it near a player shows through', () => {
    const [drawn] = drawnFor([inFront], [behindIt])
    expect(opacityOf(drawn?.shapes ?? [])).toBeCloseTo(0.4)
  })

  test('the piece draws over a body behind it and under one in front', () => {
    const behindBody: Canvas.Shape = {
      _tag: 'Rect',
      x: middle,
      y: behindIt.footY - 20,
      width: 4,
      height: 20,
      fill: 'red',
    }
    const frontBody: Canvas.Shape = { ...behindBody, fill: 'blue' }
    const [drawn] = drawnFor([behindIt])
    const sorted = depthSortedShapes([
      ...Array.fromOption(Option.fromNullishOr(drawn)),
      { footY: inFront.footY, rank: 'Player', shapes: [frontBody] },
      { footY: behindIt.footY, rank: 'Player', shapes: [behindBody] },
    ])
    expect(Array.head(sorted)).toEqual(Option.some(behindBody))
    expect(Array.last(sorted)).toEqual(Option.some(frontBody))
  })
})
