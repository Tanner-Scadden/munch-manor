import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Boss, BossMove, Glob, type Model } from '../../../app/model'
import { newPlayerReady } from '../../../test/model.fixture'
import { zombieOf } from '../../../test/testing'
import { START_LEVEL } from '../../../world/level/arena'
import { freshFight } from '../../../world/zombies/boss'
import { BOSS_RULES } from '../../../world/zombies/bossRules'
import { chunkDodge } from '../escape'

// How a bot reads Uncle Chunk (src/features/bots/escape.ts): out of a
// winding ring, still outside it, and off a charge's lane and a glob's
// mark. The bot stands in the dining room's open
// aisle south of the party table, Chunk to its west.

const BOSS_ID = 777
const AT = { x: START_LEVEL.start.x, y: START_LEVEL.start.y - 15 }

const fightWith = (
  move: BossMove,
  gap: number,
  globs: ReadonlyArray<Glob> = [],
): Model =>
  modifyFields(newPlayerReady, {
    boss: () => {
      const fight = freshFight(BOSS_ID, move, 1)
      return Boss.isAnyOf(['Fighting'])(fight)
        ? Boss.Fighting({ ...fight, globs })
        : fight
    },
    zombies: () => [zombieOf('Boss', BOSS_ID, AT.x - gap, AT.y)],
  })

const STALKING = BossMove.Stalking({ cooldownMs: 1000 })

const windingUp = (attack: 'Stomp' | 'Slam') =>
  BossMove.WindingUp({ attack, remainingMs: 400, durationMs: 600 })

describe('chunkDodge', () => {
  test('with no fight on, there is nothing to dodge', () => {
    expect(chunkDodge(newPlayerReady, AT)).toBeUndefined()
  })

  test('inside a winding stomp, it steps out, away from him', () => {
    const step = chunkDodge(fightWith(windingUp('Stomp'), 20), AT)
    expect(step?.x).toBeGreaterThan(0.9)
  })

  test('just outside a winding slam, it keeps still rather than walk in', () => {
    const step = chunkDodge(
      fightWith(windingUp('Slam'), BOSS_RULES.slamRadius + 20),
      AT,
    )
    expect(step).toEqual({ x: 0, y: 0 })
  })

  test("through a belch's wind-up, it keeps fighting", () => {
    expect(
      chunkDodge(
        fightWith(
          BossMove.WindingUp({
            attack: 'Belch',
            remainingMs: 400,
            durationMs: 600,
          }),
          60,
        ),
        AT,
      ),
    ).toBeUndefined()
  })

  test("in a charge's lane, it steps sideways off it", () => {
    const step = chunkDodge(
      fightWith(
        BossMove.Rushing({ direction: { x: 1, y: 0 }, remainingPx: 120 }),
        60,
      ),
      AT,
    )
    expect(Math.abs(step?.y ?? 0)).toBeGreaterThan(0.9)
  })

  test("on a glob's mark, it steps off it", () => {
    const mark = { x: AT.x + 4, y: AT.y }
    const step = chunkDodge(
      fightWith(STALKING, 60, [
        Glob.Flying({
          from: mark,
          to: mark,
          remainingMs: 500,
          durationMs: 900,
        }),
      ]),
      AT,
    )
    expect(step?.x).toBeLessThan(-0.9)
  })

  test('with no tell on it, it leaves the bot to its fight', () => {
    expect(chunkDodge(fightWith(STALKING, 60), AT)).toBeUndefined()
  })
})
