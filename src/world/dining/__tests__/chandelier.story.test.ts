import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { type Bullet, GameEvent, type Model, Phase } from '../../../app/model'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  quietWave,
  withActors,
  withPlayerAt,
} from '../../../test/model.fixture'
import { APPLICATION, bulletInto, ticks, zombieAt } from '../../../test/testing'
import {
  MANOR,
  findStrike,
  isWalkableTile,
  levelFor,
  levelOf,
} from '../../level/arena'
import { CHANDELIER_DROP, MANOR_SPEC } from '../../level/plan'
import { focusOf } from '../../party/party'
import {
  CHANDELIER_RULES,
  chandelierHitBox,
  gapBoxOf,
  isChandelierDown,
} from '../chandelier'

// The dining room's chandelier (src/world/dining/chandelier.ts): a shot
// through it in a wave drops it into the gap in the party table, crushing
// the zombies under it and blocking the gap until the next break, when it
// is hung again. It never hurts a player.

const FRAME_MS = FIXED_STEP_MS

const GAP = Option.getOrThrow(gapBoxOf(MANOR))
const GAP_MIDDLE = {
  x: (GAP.left + GAP.right) / 2,
  y: (GAP.top + GAP.bottom) / 2,
}
const GAP_COLUMN = Math.floor(GAP.left / 10)
const GAP_ROW = Math.floor(GAP.top / 10)

// NOTE: a shot flying north up the gap from the start spot's side of the
// table, toward the chandelier hung over it.
const shotUpTheGap: Bullet = modifyFields(
  bulletInto(500, zombieAt(0, GAP_MIDDLE.x, GAP.bottom + 6)),
  {
    velocityX: () => 0,
    velocityY: () => -420,
  },
)

// NOTE: a shot already at the chain, so nothing in the gap stops it first.
const shotAtTheChain: Bullet = modifyFields(shotUpTheGap, {
  y: () => GAP.top - 2,
})

// NOTE: the player stands west of the table, out of the shot's way.
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
    Story.story(
      APPLICATION,
      Story.given(withActors(wave(quietWave(2)), [], [shotUpTheGap])),
      ...ticks(8, FRAME_MS),
      Story.model(current => {
        expect(isChandelierDown(current)).toBe(true)
        expect(levelOf(current).dropped).toEqual([CHANDELIER_DROP])
        expect(isWalkableTile(levelOf(current), GAP_COLUMN, GAP_ROW)).toBe(
          false,
        )
        expect(current.bullets).toEqual([])
      }),
    ),
  )

  it.effect(
    'crushes a zombie under it and sets it down at the edge of the gap, but not one beside the table',
    () => {
      const under = zombieAt(1, GAP_MIDDLE.x, GAP.top + 4, { hp: 100 })
      const beside = zombieAt(2, 40, 60, { hp: 100 })
      return Story.story(
        APPLICATION,
        Story.given(
          withActors(wave(quietWave(2)), [under, beside], [shotAtTheChain]),
        ),
        ...ticks(1, FRAME_MS),
        Story.model(current => {
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
      )
    },
  )

  it.effect('kills a Groaner under it outright', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withActors(
          wave(quietWave(2)),
          [zombieAt(1, GAP_MIDDLE.x, GAP.top + 4)],
          [shotAtTheChain],
        ),
      ),
      ...ticks(1, FRAME_MS),
      Story.model(current => {
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toBe(true)
      }),
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
      return Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(2, FRAME_MS),
        Story.model(current => {
          expect(isChandelierDown(current)).toBe(true)
          const { player } = focusOf(current)
          expect(player.hp).toBe(focusOf(start).player.hp)
          expect(player.y).toBeGreaterThanOrEqual(
            GAP.bottom + PLAYER_RADIUS - 1,
          )
        }),
      )
    },
  )

  it.effect('stays hung when shot in a break', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withActors(
          wave(
            modifyFields(quietWave(2), {
              phase: () =>
                Phase.Preparation({
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
      ),
      ...ticks(8, FRAME_MS),
      Story.model(current => {
        expect(isChandelierDown(current)).toBe(false)
      }),
    ),
  )

  it.effect('is hung again when the wave ends and the break begins', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(wave(quietWave(2)), {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          level: level =>
            modifyFields(level, { dropped: () => [CHANDELIER_DROP] }),
        }),
      ),
      Story.model(current => {
        expect(isChandelierDown(current)).toBe(true)
      }),
      ...ticks(30, FRAME_MS),
      Story.model(current => {
        expect(Phase.isAnyOf(['Preparation'])(current.phase)).toBe(true)
        expect(isChandelierDown(current)).toBe(false)
        expect(isWalkableTile(levelOf(current), GAP_COLUMN, GAP_ROW)).toBe(true)
      }),
    ),
  )

  it.effect('says so with ChandelierFell in the gap the frame it lands', () =>
    Story.story(
      APPLICATION,
      Story.given(withActors(wave(quietWave(2)), [], [shotAtTheChain])),
      ...ticks(1, FRAME_MS),
      Story.model(current => {
        expect(
          Array.filter(
            current.frameEvents,
            GameEvent.isAnyOf(['ChandelierFell']),
          ),
        ).toEqual([GameEvent.ChandelierFell(GAP_MIDDLE)])
      }),
    ),
  )
})
