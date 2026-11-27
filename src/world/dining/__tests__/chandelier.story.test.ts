import { Array, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import {
  BreakClock,
  type Bullet,
  GameEvent,
  type Model,
  Phase,
} from '#app/model.ts'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '#shared/constants.ts'
import {
  DISTANT_SPAWN,
  quietWave,
  withActors,
  withPlayerAt,
} from '#test/model.fixture.ts'
import {
  bulletInto,
  checkModel,
  modelAfter,
  steps,
  ticks,
  zombieAt,
} from '#test/testing.ts'
import {
  CHANDELIER_RULES,
  chandelierHitBox,
  gapBoxOf,
  isChandelierDown,
} from '#world/dining/chandelier.ts'
import { MANOR, levelFor, levelOf } from '#world/level/arena.ts'
import { CHANDELIER_DROP, MANOR_SPEC } from '#world/level/plan.ts'
import { findStrike, isWalkableTile } from '#world/level/tileQueries.ts'
import { focusOf } from '#world/party/party.ts'

const FRAME_MS = FIXED_STEP_MS

const GAP = Option.getOrThrow(gapBoxOf(MANOR))
const GAP_MIDDLE = {
  x: (GAP.left + GAP.right) / 2,
  y: (GAP.top + GAP.bottom) / 2,
}
const GAP_COLUMN = Math.floor(GAP.left / 10)
const GAP_ROW = Math.floor(GAP.top / 10)

const shotUpTheGap: Bullet = UiStruct.evolve(
  bulletInto(500, zombieAt(0, GAP_MIDDLE.x, GAP.bottom + 6)),
  {
    velocityX: () => 0,
    velocityY: () => -420,
  },
)

const shotAtTheChain: Bullet = UiStruct.evolve(shotUpTheGap, {
  y: () => GAP.top - 2,
})

const wave = (model: Model): Model => withPlayerAt(model, 40, 130)

const zombieIn = (model: Model, id: number): Option.Option<number> =>
  Option.map(
    Array.findFirst(model.zombies, zombie => zombie.id === id),
    ({ hp }) => hp,
  )

describe('the chandelier', () => {
  test('hangs over the gap in the party table, which is floor while it hangs', () => {
    expect(isWalkableTile(MANOR, GAP_COLUMN, GAP_ROW)).toBe(true)
    const hit = chandelierHitBox(GAP)
    expect(hit.bottom).toBe(GAP.top)
    expect(hit.top).toBeLessThan(GAP.top - CHANDELIER_RULES.hungRisePx)
  })

  test('fallen, it blocks the gap for walkers and for bullets', () => {
    const fallen = levelFor(MANOR_SPEC, [], [CHANDELIER_DROP])
    expect(isWalkableTile(fallen, GAP_COLUMN, GAP_ROW)).toBe(false)
    expect(isWalkableTile(fallen, GAP_COLUMN + 1, GAP_ROW + 1)).toBe(false)
    expect(
      Option.isSome(
        findStrike(
          fallen,
          { x: GAP_MIDDLE.x, y: GAP.bottom + 6 },
          { x: GAP_MIDDLE.x, y: GAP.top - 6 },
        ),
      ),
    ).toBe(true)
  })

  it.effect('a shot through it in a wave drops it into the gap', () =>
    modelAfter(
      withActors(wave(quietWave(2)), [], [shotUpTheGap]),
      steps(
        ticks(8, FRAME_MS),
        checkModel(current => {
          expect(isChandelierDown(current)).toBe(true)
          expect(levelOf(current).dropped).toEqual([CHANDELIER_DROP])
          expect(isWalkableTile(levelOf(current), GAP_COLUMN, GAP_ROW)).toBe(
            false,
          )
          expect(current.bullets).toEqual([])
        }),
      ),
    ),
  )

  it.effect(
    'crushes a zombie under it and sets it down at the edge of the gap, but not one beside the table',
    () => {
      const under = zombieAt(1, GAP_MIDDLE.x, GAP.top + 4, { hp: 100 })
      const beside = zombieAt(2, 40, 60, { hp: 100 })
      return modelAfter(
        withActors(wave(quietWave(2)), [under, beside], [shotAtTheChain]),
        steps(
          ticks(1, FRAME_MS),
          checkModel(current => {
            expect(zombieIn(current, 1)).toEqual(
              Option.some(100 - CHANDELIER_RULES.damage),
            )
            expect(zombieIn(current, 2)).toEqual(Option.some(100))
            const crushed = Array.findFirst(
              current.zombies,
              zombie => zombie.id === 1,
            )
            expect(
              Option.exists(crushed, ({ y }) => y < GAP.top || y > GAP.bottom),
            ).toBe(true)
          }),
        ),
      )
    },
  )

  it.effect('kills a Groaner under it outright', () =>
    modelAfter(
      withActors(
        wave(quietWave(2)),
        [zombieAt(1, GAP_MIDDLE.x, GAP.top + 4)],
        [shotAtTheChain],
      ),
      steps(
        ticks(1, FRAME_MS),
        checkModel(current => {
          expect(
            Array.some(
              current.frameEvents,
              GameEvent.isAnyOf(['ZombieKilled']),
            ),
          ).toBe(true)
        }),
      ),
    ),
  )

  it.effect(
    'never hurts a player under it: it steps them out of the gap',
    () => {
      const start = withActors(
        withPlayerAt(quietWave(2), GAP_MIDDLE.x, GAP.bottom - 4),
        [],
        [shotAtTheChain],
      )
      return modelAfter(
        start,
        steps(
          ticks(2, FRAME_MS),
          checkModel(current => {
            expect(isChandelierDown(current)).toBe(true)
            const { player } = focusOf(current)
            expect(player.hp).toBe(focusOf(start).player.hp)
            expect(player.y).toBeGreaterThanOrEqual(
              GAP.bottom + PLAYER_RADIUS - 1,
            )
          }),
        ),
      )
    },
  )

  it.effect('stays hung when shot in a break', () =>
    modelAfter(
      withActors(
        wave(
          UiStruct.evolve(quietWave(2), {
            phase: () =>
              Phase.Preparation({
                clock: BreakClock.Counting(),
                wave: 2,
                remainingMs: 1e9,
                durationMs: 1e9,
                spawns: [DISTANT_SPAWN],
              }),
          }),
        ),
        [],
        [shotUpTheGap],
      ),
      steps(
        ticks(8, FRAME_MS),
        checkModel(current => {
          expect(isChandelierDown(current)).toBe(false)
        }),
      ),
    ),
  )

  it.effect('is hung again when the wave ends and the break begins', () =>
    modelAfter(
      UiStruct.evolve(wave(quietWave(2)), {
        phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        level: level =>
          UiStruct.evolve(level, { dropped: () => [CHANDELIER_DROP] }),
      }),
      steps(
        checkModel(current => {
          expect(isChandelierDown(current)).toBe(true)
        }),
        ticks(30, FRAME_MS),
        checkModel(current => {
          expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
          expect(isChandelierDown(current)).toBe(false)
          expect(isWalkableTile(levelOf(current), GAP_COLUMN, GAP_ROW)).toBe(
            true,
          )
        }),
      ),
    ),
  )

  it.effect('says so with ChandelierFell in the gap the frame it lands', () =>
    modelAfter(
      withActors(wave(quietWave(2)), [], [shotAtTheChain]),
      steps(
        ticks(1, FRAME_MS),
        checkModel(current => {
          expect(
            Array.filter(
              current.frameEvents,
              GameEvent.isAnyOf(['ChandelierFell']),
            ),
          ).toEqual([GameEvent.ChandelierFell(GAP_MIDDLE)])
        }),
      ),
    ),
  )
})
