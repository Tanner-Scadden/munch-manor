import { Array, Option, Result } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { BOSS_RULES, maybeBossBar } from './boss'
import {
  BOSS_HP,
  BOSS_ID,
  CENTER_X,
  CENTER_Y,
  FRAME_MS,
  WAVE_8_HP_SCALE,
  bossAt,
  eventsTagged,
  fighting,
  fightingWith,
  inWave,
  spawnAt,
  sturdy,
} from './boss.fixture'
import {
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_MAX_HP,
  ZOMBIE_ALIVE_MAX,
} from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Boss,
  type BossAttack,
  BossMove,
  GameEvent,
  Glob,
  type Model,
  type Zombie,
} from './model'
import { bulletInto, tick, ticks, zombieOf } from './testing'
import { FINAL_WAVE } from './wavePlans'
import { ZOMBIE_KINDS, scaledHp } from './zombies'

const fightOf = (current: Model) =>
  Option.getOrThrow(Option.liftPredicate(current.boss, Boss.guards.Fighting))

const bossIn = (current: Model): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, ({ id }) => id === BOSS_ID),
  )

describe('telegraphed attacks', () => {
  const ready = BossMove.Stalking({ cooldownMs: 0 })

  const attackLog = (
    start: Model,
    frames: number,
  ): ReadonlyArray<ReadonlyArray<GameEvent['_tag']>> => {
    const log: Array<ReadonlyArray<GameEvent['_tag']>> = []
    story(
      update,
      given(start),
      ...Array.flatMap(ticks(frames, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          log.push(
            Array.filterMap(current.frameEvents, event =>
              GameEvent.isAnyOf(['BossWoundUp', 'BossStomped', 'BossBelched'])(
                event,
              )
                ? Result.succeed(event._tag)
                : Result.failVoid,
            ),
          )
        }),
      ]),
    )
    return log
  }

  const windUpFrames = (attack: BossAttack): number =>
    Math.ceil(BOSS_RULES.windUpMs[attack] / FRAME_MS)

  test('a stomp winds up for its whole wind-up before it lands', () => {
    const boss = bossAt(CENTER_X + 20, CENTER_Y)
    const log = attackLog(
      inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(ready), [boss]),
      windUpFrames('Stomp') + 2,
    )
    const flat = Array.flatten(log)
    expect(Array.take(flat, 2)).toEqual(['BossWoundUp', 'BossStomped'])
    const woundAt = Array.findFirstIndex(log, tags =>
      Array.contains(tags, 'BossWoundUp'),
    )
    const stompAt = Array.findFirstIndex(log, tags =>
      Array.contains(tags, 'BossStomped'),
    )
    expect(
      Option.getOrThrow(stompAt) - Option.getOrThrow(woundAt),
    ).toBeGreaterThanOrEqual(windUpFrames('Stomp') - 1)
  })

  test('a stomp hurts a player inside the ring and knocks them out of it', () => {
    const boss = bossAt(CENTER_X + 20, CENTER_Y)
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Stomp',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Stomp,
            }),
          ),
          [boss],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP - BOSS_RULES.stompDamage)
        expect(current.player.knockback.x).toBeLessThan(0)
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(1)
        expect(
          BossMove.isAnyOf(['Recovering'])(
            Option.getOrThrow(
              Option.liftPredicate(current.boss, Boss.guards.Fighting),
            ).move,
          ),
        ).toBe(true)
      }),
    )
  })

  test('a player who stepped out of the ring is not hurt', () => {
    const boss = bossAt(CENTER_X + BOSS_RULES.stompRadius + 12, CENTER_Y)
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Stomp',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Stomp,
            }),
          ),
          [boss],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(1)
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('once his belch is ready he winds up a belch, then burps up a Groaner', () => {
    const boss = bossAt(CENTER_X + 60, CENTER_Y)
    const start = inWave(
      FINAL_WAVE,
      [spawnAt(1e9, 0)],
      fightingWith(ready, { belchMs: 0 }),
      [boss],
    )
    const log = attackLog(start, windUpFrames('Belch') + 2)
    expect(Array.take(Array.flatten(log), 2)).toEqual([
      'BossWoundUp',
      'BossBelched',
    ])
    story(
      update,
      given(start),
      ...ticks(windUpFrames('Belch') + 2, FRAME_MS),
      model(current => {
        const groaners = Array.filter(
          current.zombies,
          ({ kind }) => kind === 'Shambler',
        )
        expect(groaners).toHaveLength(BOSS_RULES.belchCount)
        expect(
          Array.every(
            groaners,
            ({ hp }) =>
              hp === scaledHp(ZOMBIE_KINDS.Shambler.hp, WAVE_8_HP_SCALE),
          ),
        ).toBe(true)
        expect(fightOf(current).belchMs).toBeGreaterThan(
          BOSS_RULES.belchEveryMs - 2 * FRAME_MS,
        )
      }),
    )
  })

  test('it never belches past the alive cap', () => {
    const boss = bossAt(CENTER_X + 90, CENTER_Y)
    const crowd = Array.makeBy(ZOMBIE_ALIVE_MAX - 1, index =>
      zombieOf('Shambler', 200 + index, 30 + index * 4, 160, { hp: 3 }),
    )
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Belch',
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Belch,
            }),
          ),
          [boss, ...crowd],
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'BossBelched')).toHaveLength(1)
        expect(current.zombies.length).toBe(ZOMBIE_ALIVE_MAX)
      }),
    )
  })

  test('it stands still while it winds up and recovers', () => {
    const boss = modifyFields(bossAt(CENTER_X + 60, CENTER_Y), {
      speed: () => 10,
    })
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.WindingUp({
              attack: 'Belch',
              remainingMs: 500,
              durationMs: BOSS_RULES.windUpMs.Belch,
            }),
          ),
          [boss],
        ),
      ),
      ...ticks(10, FRAME_MS),
      model(current => {
        const moved = Option.getOrThrow(
          Array.findFirst(current.zombies, ({ id }) => id === BOSS_ID),
        )
        expect(moved.x).toBe(boss.x)
        expect(moved.y).toBe(boss.y)
      }),
    )
  })
})

describe('far attacks', () => {
  const ready = BossMove.Stalking({ cooldownMs: 0 })
  const FAR_X = CENTER_X + 90
  const PLAYER = { x: CENTER_X, y: CENTER_Y }

  const tagsLog = (
    start: Model,
    frames: number,
  ): ReadonlyArray<ReadonlyArray<GameEvent['_tag']>> => {
    const log: Array<ReadonlyArray<GameEvent['_tag']>> = []
    story(
      update,
      given(start),
      ...Array.flatMap(ticks(frames, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          log.push(Array.map(current.frameEvents, ({ _tag }) => _tag))
        }),
      ]),
    )
    return log
  }

  const firstFrameWith = (
    log: ReadonlyArray<ReadonlyArray<GameEvent['_tag']>>,
    tag: GameEvent['_tag'],
  ): number =>
    Option.getOrThrow(
      Array.findFirstIndex(log, tags => Array.contains(tags, tag)),
    )

  const framesOf = (ms: number): number => Math.ceil(ms / FRAME_MS)

  test('from far away he braces toward where the player stands, then rushes', () => {
    const start = inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(ready), [
      bossAt(FAR_X, CENTER_Y),
    ])
    story(
      update,
      given(start),
      tick(FRAME_MS),
      model(current => {
        const { move } = fightOf(current)
        expect(BossMove.isAnyOf(['Bracing'])(move)).toBe(true)
        expect(BossMove.isAnyOf(['Bracing'])(move) && move.target).toEqual(
          PLAYER,
        )
        expect(eventsTagged(current.frameEvents, 'BossWoundUp')).toEqual([
          GameEvent.BossWoundUp({ x: FAR_X, y: CENTER_Y, attack: 'Charge' }),
        ])
      }),
    )
    const log = tagsLog(sturdy(start), framesOf(BOSS_RULES.windUpMs.Charge) + 4)
    expect(
      firstFrameWith(log, 'BossRushed') - firstFrameWith(log, 'BossWoundUp'),
    ).toBeGreaterThanOrEqual(framesOf(BOSS_RULES.windUpMs.Charge) - 1)
  })

  test('the rush follows the line locked at the brace, not the player', () => {
    const offLine = { x: CENTER_X, y: CENTER_Y + 40 }
    const bystander = zombieOf('Shambler', 300, CENTER_X + 45, CENTER_Y + 4, {
      hp: 3,
    })
    const ys: Array<number> = []
    const moves: Array<BossMove['_tag']> = []
    const ends: Array<Model> = []
    story(
      update,
      given(
        modifyFields(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fighting(
              BossMove.Bracing({
                target: PLAYER,
                remainingMs: 10,
                durationMs: BOSS_RULES.windUpMs.Charge,
              }),
            ),
            [bossAt(FAR_X, CENTER_Y), bystander],
          ),
          {
            player: player =>
              modifyFields(player, { x: () => offLine.x, y: () => offLine.y }),
          },
        ),
      ),
      ...Array.flatMap(ticks(60, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          ys.push(bossIn(current).y)
          moves.push(fightOf(current).move._tag)
          ends.push(current)
        }),
      ]),
    )
    expect(moves).toContain('Rushing')
    expect(Array.every(ys, y => Math.abs(y - CENTER_Y) < 0.01)).toBe(true)
    const recovered = Option.getOrThrow(
      Array.findFirst(ends, current =>
        BossMove.isAnyOf(['Recovering'])(fightOf(current).move),
      ),
    )
    expect(bossIn(recovered).x).toBeCloseTo(
      PLAYER.x - BOSS_RULES.chargeOvershootPx,
      0,
    )
    expect(recovered.player.hp).toBe(PLAYER_MAX_HP)
    const bowled = Option.getOrThrow(
      Array.findFirst(recovered.zombies, ({ id }) => id === 300),
    )
    expect(bowled.y).toBeGreaterThan(CENTER_Y + 6)
  })

  test('a rush that reaches the player costs 2 hearts and throws them aside', () => {
    const hurtAt: Array<Model> = []
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.Bracing({
              target: PLAYER,
              remainingMs: 10,
              durationMs: BOSS_RULES.windUpMs.Charge,
            }),
          ),
          [bossAt(FAR_X, CENTER_Y + 2)],
        ),
      ),
      ...Array.flatMap(ticks(40, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          if (current.player.hp < PLAYER_MAX_HP) {
            hurtAt.push(current)
          }
        }),
      ]),
    )
    const hurt = Option.getOrThrow(Array.head(hurtAt))
    expect(hurt.player.hp).toBe(PLAYER_MAX_HP - BOSS_RULES.chargeDamage)
    expect(eventsTagged(hurt.frameEvents, 'BossRammed')).toHaveLength(1)
    expect(
      Math.hypot(hurt.player.knockback.x, hurt.player.knockback.y),
    ).toBeGreaterThan(PLAYER_KNOCKBACK_SPEED)
  })

  test('a rush into a wall stuns him, and shots hurt him double while he is dazed', () => {
    const wallBound = bossAt(100, 60)
    const states: Array<Model> = []
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fighting(
            BossMove.Rushing({ direction: { x: 0, y: -1 }, remainingPx: 100 }),
          ),
          [wallBound],
        ),
      ),
      ...Array.flatMap(ticks(20, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          states.push(current)
        }),
      ]),
    )
    const bonked = Option.getOrThrow(
      Array.findFirst(states, current =>
        Array.isReadonlyArrayNonEmpty(
          eventsTagged(current.frameEvents, 'BossBonked'),
        ),
      ),
    )
    expect(fightOf(bonked).move).toEqual(
      BossMove.Dazed({
        remainingMs: BOSS_RULES.dazedMs,
        durationMs: BOSS_RULES.dazedMs,
      }),
    )
    expect(bossIn(bonked).y).toBeLessThan(40)
    const dazedBoss = bossIn(bonked)
    story(
      update,
      given(
        modifyFields(bonked, {
          bullets: () => [bulletInto(1, dazedBoss)],
          frameEvents: () => [],
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(bossIn(current).hp).toBe(dazedBoss.hp - 2)
      }),
      ...ticks(framesOf(BOSS_RULES.dazedMs), FRAME_MS),
      model(current => {
        expect(BossMove.isAnyOf(['Dazed'])(fightOf(current).move)).toBe(false)
      }),
    )
  })

  test('he spits a glob at the player, its mark fills, then it lands and pools', () => {
    const start = sturdy(
      inWave(
        FINAL_WAVE,
        [spawnAt(1e9, 0)],
        fightingWith(ready, { nextFar: 'Spit' }),
        [bossAt(FAR_X, CENTER_Y)],
      ),
    )
    const log = tagsLog(
      start,
      framesOf(BOSS_RULES.windUpMs.Spit + BOSS_RULES.spitFlightMs) + 4,
    )
    const spatAt = firstFrameWith(log, 'BossSpat')
    const landedAt = firstFrameWith(log, 'GlobLanded')
    expect(spatAt).toBeGreaterThanOrEqual(
      framesOf(BOSS_RULES.windUpMs.Spit) - 1,
    )
    expect(landedAt - spatAt).toBeGreaterThanOrEqual(
      framesOf(BOSS_RULES.spitFlightMs) - 1,
    )
    story(
      update,
      given(start),
      ...ticks(spatAt + 1, FRAME_MS),
      model(current => {
        expect(fightOf(current).globs).toEqual([
          Glob.Flying({
            from: { x: FAR_X, y: CENTER_Y },
            to: PLAYER,
            remainingMs: BOSS_RULES.spitFlightMs,
            durationMs: BOSS_RULES.spitFlightMs,
          }),
        ])
      }),
      ...ticks(landedAt - spatAt, FRAME_MS),
      model(current => {
        expect(fightOf(current).globs).toEqual([
          Glob.Pooled({
            at: PLAYER,
            remainingMs: BOSS_RULES.puddleMs,
            durationMs: BOSS_RULES.puddleMs,
          }),
        ])
      }),
    )
  })

  const landing = (playerAt: { x: number; y: number }): Model =>
    modifyFields(
      inWave(
        FINAL_WAVE,
        [spawnAt(1e9, 0)],
        fightingWith(BossMove.Stalking({ cooldownMs: 60_000 }), {
          globs: [
            Glob.Flying({
              from: { x: FAR_X, y: CENTER_Y },
              to: PLAYER,
              remainingMs: 40,
              durationMs: BOSS_RULES.spitFlightMs,
            }),
          ],
        }),
        [bossAt(FAR_X, CENTER_Y)],
      ),
      {
        player: player =>
          modifyFields(player, { x: () => playerAt.x, y: () => playerAt.y }),
      },
    )

  test('a glob that lands on the player costs a heart, and one that misses does not', () => {
    story(
      update,
      given(landing(PLAYER)),
      tick(FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
      ...ticks(2, FRAME_MS),
      model(current => {
        expect(current.player.hp).toBe(PLAYER_MAX_HP - BOSS_RULES.spitDamage)
      }),
    )
    story(
      update,
      given(landing({ x: PLAYER.x, y: PLAYER.y + BOSS_RULES.spitRadius + 6 })),
      ...ticks(3, FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'GlobLanded')).toHaveLength(1)
        expect(current.player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('a puddle slows the player who walks through it, then dries up', () => {
    const walkedFrom = (globs: ReadonlyArray<Glob>): number => {
      const ends: Array<number> = []
      story(
        update,
        given(
          sturdy(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fightingWith(BossMove.Stalking({ cooldownMs: 60_000 }), {
                globs,
              }),
              [bossAt(FAR_X + 40, CENTER_Y - 60)],
            ),
          ),
        ),
        message(Message.PressedKey({ code: 'KeyA' })),
        ...ticks(6, FRAME_MS),
        model(current => {
          ends.push(current.player.x)
        }),
      )
      return CENTER_X - Option.getOrThrow(Array.head(ends))
    }
    const puddle = Glob.Pooled({
      at: PLAYER,
      remainingMs: BOSS_RULES.puddleMs,
      durationMs: BOSS_RULES.puddleMs,
    })
    expect(walkedFrom([puddle]) / walkedFrom([])).toBeCloseTo(
      BOSS_RULES.puddleSlow,
      1,
    )
    story(
      update,
      given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingWith(BossMove.Stalking({ cooldownMs: 60_000 }), {
            globs: [puddle],
          }),
          [bossAt(FAR_X + 40, CENTER_Y - 60)],
        ),
      ),
      ...ticks(framesOf(BOSS_RULES.puddleMs) + 1, FRAME_MS),
      model(current => {
        expect(fightOf(current).globs).toEqual([])
      }),
    )
  })

  test('while the player stays far his belch comes sooner', () => {
    const belchLeft = (bossX: number): number => {
      const lefts: Array<number> = []
      story(
        update,
        given(
          sturdy(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fighting(BossMove.Stalking({ cooldownMs: 60_000 })),
              [bossAt(bossX, CENTER_Y)],
            ),
          ),
        ),
        ...ticks(62, FRAME_MS),
        model(current => {
          lefts.push(fightOf(current).belchMs)
        }),
      )
      return Option.getOrThrow(Array.head(lefts))
    }
    const elapsed = 62 * FRAME_MS
    expect(belchLeft(CENTER_X + 60)).toBeCloseTo(
      BOSS_RULES.firstBelchMs - elapsed,
      6,
    )
    expect(belchLeft(FAR_X)).toBeCloseTo(
      BOSS_RULES.firstBelchMs - elapsed * BOSS_RULES.belchFarRate,
      6,
    )
  })
})

describe('enrage', () => {
  const third = BOSS_HP / 3

  test('he enrages once his health falls to a third, roaring once', () => {
    const calm = bossAt(CENTER_X + 60, CENTER_Y, Math.floor(third) + 1)
    const angry = bossAt(CENTER_X + 60, CENTER_Y, Math.floor(third))
    const quiet = BossMove.Stalking({ cooldownMs: 60_000 })
    story(
      update,
      given(inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(quiet), [calm])),
      tick(FRAME_MS),
      model(current => {
        expect(fightOf(current).mood).toBe('Calm')
        expect(eventsTagged(current.frameEvents, 'BossEnraged')).toEqual([])
      }),
    )
    story(
      update,
      given(inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fighting(quiet), [angry])),
      tick(FRAME_MS),
      model(current => {
        expect(fightOf(current).mood).toBe('Enraged')
        expect(eventsTagged(current.frameEvents, 'BossEnraged')).toHaveLength(1)
        expect(maybeBossBar(current)).toEqual(
          Option.some({
            name: 'Uncle Chunk',
            hp: Math.floor(third),
            maxHp: BOSS_HP,
            isEnraged: true,
          }),
        )
      }),
      tick(FRAME_MS),
      model(current => {
        expect(eventsTagged(current.frameEvents, 'BossEnraged')).toEqual([])
      }),
    )
  })

  test('enraged, he walks faster and waits less between attacks', () => {
    const walked = (mood: 'Calm' | 'Enraged'): number => {
      const xs: Array<number> = []
      story(
        update,
        given(
          sturdy(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fightingWith(BossMove.Stalking({ cooldownMs: 60_000 }), {
                mood,
              }),
              [
                modifyFields(bossAt(CENTER_X + 64, CENTER_Y), {
                  speed: () => 10,
                }),
              ],
            ),
          ),
        ),
        ...ticks(20, FRAME_MS),
        model(current => {
          xs.push(bossIn(current).x)
        }),
      )
      return CENTER_X + 64 - Option.getOrThrow(Array.head(xs))
    }
    expect(walked('Enraged') / walked('Calm')).toBeCloseTo(
      BOSS_RULES.enrageSpeedScale,
      1,
    )
    const gapAfterStomp = (mood: 'Calm' | 'Enraged'): number => {
      const gaps: Array<number> = []
      story(
        update,
        given(
          sturdy(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fightingWith(
                BossMove.WindingUp({
                  attack: 'Stomp',
                  remainingMs: 10,
                  durationMs: BOSS_RULES.windUpMs.Stomp,
                }),
                { mood },
              ),
              [bossAt(CENTER_X + 20, CENTER_Y)],
            ),
          ),
        ),
        tick(FRAME_MS),
        model(current => {
          const { move } = fightOf(current)
          gaps.push(
            BossMove.isAnyOf(['Recovering'])(move) ? move.cooldownMs : -1,
          )
        }),
      )
      return Option.getOrThrow(Array.head(gaps))
    }
    expect(gapAfterStomp('Calm')).toBe(BOSS_RULES.cooldownMs.Stomp)
    expect(gapAfterStomp('Enraged')).toBe(
      BOSS_RULES.cooldownMs.Stomp * BOSS_RULES.enrageGapScale,
    )
  })
})

describe('one tell at a time', () => {
  const tellsOf = (current: Model): number => {
    const fight = fightOf(current)
    const flying = Array.filter(fight.globs, Glob.isAnyOf(['Flying'])).length
    const moving = BossMove.isAnyOf(['WindingUp', 'Bracing', 'Rushing'])(
      fight.move,
    )
      ? 1
      : 0
    return flying + moving
  }

  test('he waits for a glob to land before he winds up a stomp', () => {
    story(
      update,
      given(
        sturdy(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingWith(BossMove.Stalking({ cooldownMs: 0 }), {
              globs: [
                Glob.Flying({
                  from: { x: CENTER_X + 20, y: CENTER_Y },
                  to: { x: CENTER_X - 60, y: CENTER_Y },
                  remainingMs: 300,
                  durationMs: BOSS_RULES.spitFlightMs,
                }),
              ],
            }),
            [bossAt(CENTER_X + 20, CENTER_Y)],
          ),
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(BossMove.isAnyOf(['Stalking'])(fightOf(current).move)).toBe(true)
      }),
      ...ticks(
        Math.ceil(300 / FRAME_MS) + Math.ceil(BOSS_RULES.retryMs / FRAME_MS),
        FRAME_MS,
      ),
      model(current => {
        expect(
          Array.filter(fightOf(current).globs, Glob.isAnyOf(['Flying'])),
        ).toEqual([])
        expect(BossMove.isAnyOf(['WindingUp'])(fightOf(current).move)).toBe(
          true,
        )
      }),
    )
  })

  test('across a whole fight, no frame shows two tells', () => {
    const tells: Array<number> = []
    const tags: Array<GameEvent['_tag']> = []
    story(
      update,
      given(
        sturdy(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingWith(BossMove.Stalking({ cooldownMs: 0 }), {
              nextFar: 'Spit',
              belchMs: 2000,
            }),
            [
              modifyFields(bossAt(CENTER_X + 120, CENTER_Y), {
                speed: () => 10,
              }),
            ],
          ),
        ),
      ),
      ...Array.flatMap(ticks(900, FRAME_MS), frame => [
        frame,
        model((current: Model) => {
          tells.push(tellsOf(current))
          tags.push(...Array.map(current.frameEvents, ({ _tag }) => _tag))
        }),
      ]),
    )
    expect(Math.max(...tells)).toBe(1)
    expect(tags).toContain('BossSpat')
    expect(tags).toContain('BossStomped')
    expect(tags).toContain('BossBelched')
  })
})
