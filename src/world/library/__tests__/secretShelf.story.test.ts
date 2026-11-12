import { Array, Option, Result } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { GameEvent, type Model, Phase } from '../../../app/model'
import {
  FIXED_STEP_MS,
  PLAYER_RADIUS,
  TILE_SIZE,
} from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  quietWave,
  withPlayerAt,
} from '../../../test/model.fixture'
import { APPLICATION, ticks } from '../../../test/testing'
import { levelFor, levelOf, openExitIn } from '../../level/arena'
import { exitOffers } from '../../level/exits'
import { flowFieldToward, playerDistancePx } from '../../level/pathing'
import { EAST_EXIT, FAR_EXIT, MANOR_SPEC, SECRET_EXIT } from '../../level/plan'
import { tileCenter } from '../../level/tileGrid'
import { isWalkableTile } from '../../level/tileQueries'
import { SHELF_RULES, secretShelfOf } from '../secretShelf'

// The library's secret shelf (src/world/library/secretShelf.ts): in the
// wall the library shares with the dining room, a red book sticks out. A
// player who walks up to it in a round pulls it, and the shelf swings open
// for the rest of the run, a free second way between the two rooms.

const LIBRARY_OPEN = levelFor(MANOR_SPEC, [EAST_EXIT])
const SHELF = Option.getOrThrow(secretShelfOf(LIBRARY_OPEN))

// NOTE: the shelf's two rows, in the dining room's east wall and the
// library's west wall.
const DINING_SIDE = { column: SHELF.tile.column - 1, row: SHELF.tile.row }

// NOTE: a player whose body touches the book.
const atBook = (model: Model): Model =>
  withPlayerAt(model, SHELF.book.x + PLAYER_RADIUS + 1, SHELF.book.y)

const withLibraryOpen = (model: Model): Model =>
  modifyFields(model, { level: state => openExitIn(state, EAST_EXIT) })

const isSecretOpen = (model: Model): boolean =>
  Array.contains(levelOf(model).openExits, SECRET_EXIT)

const swungEvents = (model: Model): ReadonlyArray<GameEvent> =>
  Array.filter(model.frameEvents, GameEvent.isAnyOf(['ShelfSwung']))

describe('the secret shelf', () => {
  test('stands in the library wall the dining room shares, its book facing the library', () => {
    expect(SHELF.side).toBe('West')
    expect(SHELF.tile).toEqual({ column: 36, row: 13 })
    expect(SHELF.book).toEqual({
      x: 37 * TILE_SIZE + SHELF_RULES.bookOutPx,
      y: 13 * TILE_SIZE + 7,
    })
  })

  test('shut, it is wall on both sides; open, a two tile doorway through', () => {
    const open = levelFor(MANOR_SPEC, [EAST_EXIT, SECRET_EXIT])
    Array.forEach([0, 1], row => {
      expect(
        isWalkableTile(LIBRARY_OPEN, SHELF.tile.column, SHELF.tile.row + row),
      ).toBe(false)
      expect(
        isWalkableTile(LIBRARY_OPEN, DINING_SIDE.column, DINING_SIDE.row + row),
      ).toBe(false)
      expect(
        isWalkableTile(open, SHELF.tile.column, SHELF.tile.row + row),
      ).toBe(true)
      expect(
        isWalkableTile(open, DINING_SIDE.column, DINING_SIDE.row + row),
      ).toBe(true)
    })
  })

  it.effect('swings open when a player walks up to the book in a round', () =>
    Story.story(
      APPLICATION,
      Story.given(atBook(withLibraryOpen(quietWave(4)))),
      ...ticks(1, FIXED_STEP_MS),
      Story.model(current => {
        expect(isSecretOpen(current)).toBe(true)
        expect(swungEvents(current)).toHaveLength(1)
        expect(
          isWalkableTile(levelOf(current), DINING_SIDE.column, DINING_SIDE.row),
        ).toBe(true)
      }),
      ...ticks(3, FIXED_STEP_MS),
      Story.model(current => {
        expect(isSecretOpen(current)).toBe(true)
        expect(swungEvents(current)).toEqual([])
      }),
    ),
  )

  it.effect('swings in a break too', () =>
    Story.story(
      APPLICATION,
      Story.given(
        atBook(
          withLibraryOpen(
            modifyFields(quietWave(4), {
              phase: () =>
                Phase.Preparation({
                  wave: 4,
                  remainingMs: 60_000,
                  durationMs: 60_000,
                  spawns: [DISTANT_SPAWN],
                }),
            }),
          ),
        ),
      ),
      ...ticks(1, FIXED_STEP_MS),
      Story.model(current => {
        expect(isSecretOpen(current)).toBe(true)
      }),
    ),
  )

  it.effect('stays shut for a player a step away from the book', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withPlayerAt(
          withLibraryOpen(quietWave(4)),
          SHELF.book.x + PLAYER_RADIUS + SHELF_RULES.reachPx + 4,
          SHELF.book.y,
        ),
      ),
      ...ticks(4, FIXED_STEP_MS),
      Story.model(current => {
        expect(isSecretOpen(current)).toBe(false)
      }),
    ),
  )

  it.effect('cannot swing while the library is boarded', () =>
    Story.story(
      APPLICATION,
      Story.given(atBook(quietWave(4))),
      ...ticks(2, FIXED_STEP_MS),
      Story.model(current => {
        expect(isSecretOpen(current)).toBe(false)
      }),
    ),
  )

  test('is never for sale, and the far boards are only once the library is open', () => {
    const offered = (model: Model): ReadonlyArray<string> =>
      Array.filterMap(exitOffers(model), ({ target }) =>
        target._tag === 'Exit' ? Result.succeed(target.exit) : Result.failVoid,
      )
    expect(offered(quietWave(4))).toEqual(['Kitchen', 'West', EAST_EXIT])
    expect(offered(withLibraryOpen(quietWave(4)))).toEqual([
      'Kitchen',
      'West',
      FAR_EXIT,
    ])
  })

  test('once open, zombies take it: the way between the two rooms is a few steps', () => {
    const open = levelFor(MANOR_SPEC, [EAST_EXIT, SECRET_EXIT])
    const inLibrary = tileCenter({ column: 38, row: 13 })
    const inDining = tileCenter({ column: 33, row: 14 })
    const shut = flowFieldToward(LIBRARY_OPEN, inLibrary, 'Wide', [])
    const swung = flowFieldToward(open, inLibrary, 'Wide', [])
    const before = playerDistancePx(LIBRARY_OPEN, shut, inDining)
    const after = playerDistancePx(open, swung, inDining)
    expect(after).toBeLessThan(before)
    expect(after).toBeLessThanOrEqual(8 * TILE_SIZE)
  })
})
