import { Array, Effect, Option, Result } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Boss,
  type BossAttack,
  BossMove,
  GameEvent,
  Glob,
  type Model,
  type Zombie,
} from '../../../app/model'
import {
  PLAYER_KNOCKBACK_SPEED,
  PLAYER_MAX_HP,
  ZOMBIE_ALIVE_MAX,
} from '../../../shared/constants'
import {
  APPLICATION,
  FRAME_MS,
  bulletInto,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { focusOf, modifyFocus } from '../../party/party'
import { DIFFICULTIES } from '../../run/difficulty'
import { FINAL_WAVE } from '../../waves/wavePlans'
import { maybeBossBar } from '../boss'
import { BOSS_RULES } from '../bossRules'
import { ZOMBIE_KINDS, scaledHp } from '../zombies'
import {
  BOSS_HP,
  BOSS_ID,
  CENTER_X,
  CENTER_Y,
  WAVE_8_HP_SCALE,
  bossAt,
  bossWithHpAt,
  eventsTagged,
  fightOf,
  fightingBoss,
  fightingWith,
  inWave,
  spawnAt,
  sturdy,
} from './boss.fixture'

const bossIn = (current: Model): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, ({ id }) => id === BOSS_ID),
  )

describe('telegraphed attacks', () => {
  const ready = BossMove.Stalking({ cooldownMs: 0 })

  // NOTE: each frame's attack tags, gathered in an array only this Story
  // fills.
  const attackLog = (start: Model, frames: number) =>
    Effect.suspend(() => {
      const log: Array<ReadonlyArray<GameEvent['_tag']>> = []
      return Story.story(
        APPLICATION,
        Story.given(start),
        ...Array.flatMap(ticks(frames, FRAME_MS), frame => [
          frame,
          Story.model((current: Model) => {
            log.push(
              Array.filterMap(current.frameEvents, event =>
                GameEvent.isAnyOf([
                  'BossWoundUp',
                  'BossStomped',
                  'BossBelched',
                ])(event)
                  ? Result.succeed(event._tag)
                  : Result.failVoid,
              ),
            )
          }),
        ]),
      ).pipe(Effect.as<ReadonlyArray<ReadonlyArray<GameEvent['_tag']>>>(log))
    })

  const windUpFrames = (attack: BossAttack): number =>
    Math.ceil(BOSS_RULES.windUpMs[attack] / FRAME_MS)

  it.effect('a stomp winds up for its whole wind-up before it lands', () =>
    Effect.gen(function* () {
      const boss = bossAt(CENTER_X + 20, CENTER_Y)
      const log = yield* attackLog(
        inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingBoss(ready), [boss]),
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
    }),
  )

  it.effect(
    'a stomp hurts a player inside the ring and knocks them out of it',
    () => {
      const boss = bossAt(CENTER_X + 20, CENTER_Y)
      return Story.story(
        APPLICATION,
        Story.given(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingBoss(
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
        Story.model(current => {
          expect(focusOf(current).player.hp).toBe(
            PLAYER_MAX_HP - BOSS_RULES.stompDamage,
          )
          expect(focusOf(current).player.knockback.x).toBeLessThan(0)
          expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(
            1,
          )
          expect(
            BossMove.isAnyOf(['Recovering'])(
              Option.getOrThrow(
                Option.liftPredicate(current.boss, Boss.guards.Fighting),
              ).move,
            ),
          ).toBe(true)
        }),
      )
    },
  )

  it.effect('a player who stepped out of the ring is not hurt', () => {
    const boss = bossAt(CENTER_X + BOSS_RULES.stompRadius + 12, CENTER_Y)
    return Story.story(
      APPLICATION,
      Story.given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingBoss(
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
      Story.model(current => {
        expect(eventsTagged(current.frameEvents, 'BossStomped')).toHaveLength(1)
        expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  it.effect(
    'once his belch is ready he winds up a belch, then burps up a Groaner',
    () =>
      Effect.gen(function* () {
        const boss = bossAt(CENTER_X + 60, CENTER_Y)
        const start = inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingWith(ready, { belchMs: 0 }),
          [boss],
        )
        const log = yield* attackLog(start, windUpFrames('Belch') + 2)
        expect(Array.take(Array.flatten(log), 2)).toEqual([
          'BossWoundUp',
          'BossBelched',
        ])
        return yield* Story.story(
          APPLICATION,
          Story.given(start),
          ...ticks(windUpFrames('Belch') + 2, FRAME_MS),
          Story.model(current => {
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
      }),
  )

  it.effect(
    "on Hard his Groaners take the level's health but not his boss health",
    () => {
      const { healthScale, bossHealthScale } = DIFFICULTIES.Hard
      const hardBossHp = scaledHp(
        ZOMBIE_KINDS.Boss.hp,
        WAVE_8_HP_SCALE * healthScale * bossHealthScale,
      )
      const boss = modifyFields(
        bossWithHpAt(hardBossHp, CENTER_X + 60, CENTER_Y),
        {
          maxHp: () => hardBossHp,
        },
      )
      const start = modifyFields(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingWith(ready, { belchMs: 0 }),
          [boss],
        ),
        {
          difficulty: setting =>
            modifyFields(setting, { chosen: () => 'Hard' }),
        },
      )
      return Story.story(
        APPLICATION,
        Story.given(start),
        ...ticks(windUpFrames('Belch') + 2, FRAME_MS),
        Story.model(current => {
          const groaners = Array.filter(
            current.zombies,
            ({ kind }) => kind === 'Shambler',
          )
          expect(groaners).toHaveLength(BOSS_RULES.belchCount)
          expect(Array.map(groaners, ({ hp }) => hp)).toEqual(
            Array.replicate(
              scaledHp(ZOMBIE_KINDS.Shambler.hp, WAVE_8_HP_SCALE * healthScale),
              BOSS_RULES.belchCount,
            ),
          )
        }),
      )
    },
  )

  it.effect('it never belches past the alive cap', () => {
    const boss = bossAt(CENTER_X + 90, CENTER_Y)
    const crowd = Array.makeBy(ZOMBIE_ALIVE_MAX - 1, index =>
      zombieOf('Shambler', 200 + index, 30 + index * 4, 160, { hp: 3 }),
    )
    return Story.story(
      APPLICATION,
      Story.given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingBoss(
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
      Story.model(current => {
        expect(eventsTagged(current.frameEvents, 'BossBelched')).toHaveLength(1)
        expect(current.zombies.length).toBe(ZOMBIE_ALIVE_MAX)
      }),
    )
  })

  it.effect('it stands still while it winds up and recovers', () => {
    const boss = modifyFields(bossAt(CENTER_X + 60, CENTER_Y), {
      speed: () => 10,
    })
    return Story.story(
      APPLICATION,
      Story.given(
        inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingBoss(
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
      Story.model(current => {
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

  // NOTE: each frame's event tags, gathered in an array only this Story
  // fills.
  const tagsLog = (start: Model, frames: number) =>
    Effect.suspend(() => {
      const log: Array<ReadonlyArray<GameEvent['_tag']>> = []
      return Story.story(
        APPLICATION,
        Story.given(start),
        ...Array.flatMap(ticks(frames, FRAME_MS), frame => [
          frame,
          Story.model((current: Model) => {
            log.push(Array.map(current.frameEvents, ({ _tag }) => _tag))
          }),
        ]),
      ).pipe(Effect.as<ReadonlyArray<ReadonlyArray<GameEvent['_tag']>>>(log))
    })

  const firstFrameWith = (
    log: ReadonlyArray<ReadonlyArray<GameEvent['_tag']>>,
    tag: GameEvent['_tag'],
  ): number =>
    Option.getOrThrow(
      Array.findFirstIndex(log, tags => Array.contains(tags, tag)),
    )

  const framesOf = (ms: number): number => Math.ceil(ms / FRAME_MS)

  it.effect(
    'from far away he braces toward where the player stands, then rushes',
    () =>
      Effect.gen(function* () {
        const start = inWave(
          FINAL_WAVE,
          [spawnAt(1e9, 0)],
          fightingBoss(ready),
          [bossAt(FAR_X, CENTER_Y)],
        )
        yield* Story.story(
          APPLICATION,
          Story.given(start),
          tick(FRAME_MS),
          Story.model(current => {
            const { move } = fightOf(current)
            expect(BossMove.isAnyOf(['Bracing'])(move)).toBe(true)
            expect(BossMove.isAnyOf(['Bracing'])(move) && move.target).toEqual(
              PLAYER,
            )
            expect(eventsTagged(current.frameEvents, 'BossWoundUp')).toEqual([
              GameEvent.BossWoundUp({
                x: FAR_X,
                y: CENTER_Y,
                attack: 'Charge',
              }),
            ])
          }),
        )
        const log = yield* tagsLog(
          sturdy(start),
          framesOf(BOSS_RULES.windUpMs.Charge) + 4,
        )
        expect(
          firstFrameWith(log, 'BossRushed') -
            firstFrameWith(log, 'BossWoundUp'),
        ).toBeGreaterThanOrEqual(framesOf(BOSS_RULES.windUpMs.Charge) - 1)
      }),
  )

  it.effect(
    'the rush follows the line locked at the brace, not the player',
    () =>
      Effect.gen(function* () {
        const offLine = { x: CENTER_X, y: CENTER_Y + 40 }
        const bystander = zombieOf(
          'Shambler',
          300,
          CENTER_X + 45,
          CENTER_Y + 4,
          {
            hp: 3,
          },
        )
        const ys: Array<number> = []
        const moves: Array<BossMove['_tag']> = []
        const ends: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFocus(
              inWave(
                FINAL_WAVE,
                [spawnAt(1e9, 0)],
                fightingBoss(
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
                  modifyFields(player, {
                    x: () => offLine.x,
                    y: () => offLine.y,
                  }),
              },
            ),
          ),
          ...Array.flatMap(ticks(60, FRAME_MS), frame => [
            frame,
            Story.model((current: Model) => {
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
        expect(focusOf(recovered).player.hp).toBe(PLAYER_MAX_HP)
        const bowled = Option.getOrThrow(
          Array.findFirst(recovered.zombies, ({ id }) => id === 300),
        )
        expect(bowled.y).toBeGreaterThan(CENTER_Y + 6)
      }),
  )

  it.effect(
    'a rush that reaches the player costs 2 hearts and throws them aside',
    () =>
      Effect.gen(function* () {
        const hurtAt: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fightingBoss(
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
            Story.model((current: Model) => {
              if (focusOf(current).player.hp < PLAYER_MAX_HP) {
                hurtAt.push(current)
              }
            }),
          ]),
        )
        const hurt = Option.getOrThrow(Array.head(hurtAt))
        expect(focusOf(hurt).player.hp).toBe(
          PLAYER_MAX_HP - BOSS_RULES.chargeDamage,
        )
        expect(eventsTagged(hurt.frameEvents, 'BossRammed')).toHaveLength(1)
        expect(
          Math.hypot(
            focusOf(hurt).player.knockback.x,
            focusOf(hurt).player.knockback.y,
          ),
        ).toBeGreaterThan(PLAYER_KNOCKBACK_SPEED)
      }),
  )

  it.effect(
    'a rush into a wall stuns him, and shots hurt him double while he is dazed',
    () =>
      Effect.gen(function* () {
        const wallBound = bossAt(100, 60)
        const states: Array<Model> = []
        yield* Story.story(
          APPLICATION,
          Story.given(
            inWave(
              FINAL_WAVE,
              [spawnAt(1e9, 0)],
              fightingBoss(
                BossMove.Rushing({
                  direction: { x: 0, y: -1 },
                  remainingPx: 100,
                }),
              ),
              [wallBound],
            ),
          ),
          ...Array.flatMap(ticks(20, FRAME_MS), frame => [
            frame,
            Story.model((current: Model) => {
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
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(bonked, {
              bullets: () => [bulletInto(1, dazedBoss)],
              frameEvents: () => [],
            }),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(bossIn(current).hp).toBe(dazedBoss.hp - 2)
          }),
          ...ticks(framesOf(BOSS_RULES.dazedMs), FRAME_MS),
          Story.model(current => {
            expect(BossMove.isAnyOf(['Dazed'])(fightOf(current).move)).toBe(
              false,
            )
          }),
        )
      }),
  )

  it.effect(
    'he spits a glob at the player, its mark fills, then it lands and pools',
    () =>
      Effect.gen(function* () {
        const start = sturdy(
          inWave(
            FINAL_WAVE,
            [spawnAt(1e9, 0)],
            fightingWith(ready, { nextFar: 'Spit' }),
            [bossAt(FAR_X, CENTER_Y)],
          ),
        )
        const log = yield* tagsLog(
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
        return yield* Story.story(
          APPLICATION,
          Story.given(start),
          ...ticks(spatAt + 1, FRAME_MS),
          Story.model(current => {
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
          Story.model(current => {
            expect(fightOf(current).globs).toEqual([
              Glob.Pooled({
                at: PLAYER,
                remainingMs: BOSS_RULES.puddleMs,
                durationMs: BOSS_RULES.puddleMs,
              }),
            ])
          }),
        )
      }),
  )

  const landing = (playerAt: { x: number; y: number }): Model =>
    modifyFocus(
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

  it.effect(
    'a glob that lands on the player costs a heart, and one that misses does not',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(landing(PLAYER)),
          tick(FRAME_MS),
          Story.model(current => {
            expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
          }),
          ...ticks(2, FRAME_MS),
          Story.model(current => {
            expect(focusOf(current).player.hp).toBe(
              PLAYER_MAX_HP - BOSS_RULES.spitDamage,
            )
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            landing({ x: PLAYER.x, y: PLAYER.y + BOSS_RULES.spitRadius + 6 }),
          ),
          ...ticks(3, FRAME_MS),
          Story.model(current => {
            expect(
              eventsTagged(current.frameEvents, 'GlobLanded'),
            ).toHaveLength(1)
            expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
          }),
        )
      }),
  )

  it.effect(
    'a puddle slows the player who walks through it, then dries up',
    () =>
      Effect.gen(function* () {
        const walkedFrom = (globs: ReadonlyArray<Glob>) =>
          Story.story(
            APPLICATION,
            Story.given(
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
            Story.message(Message.PressedKey({ code: 'KeyA' })),
            ...ticks(6, FRAME_MS),
          ).pipe(Effect.map(end => CENTER_X - focusOf(end).player.x))
        const puddle = Glob.Pooled({
          at: PLAYER,
          remainingMs: BOSS_RULES.puddleMs,
          durationMs: BOSS_RULES.puddleMs,
        })
        const slowed = yield* walkedFrom([puddle])
        const free = yield* walkedFrom([])
        expect(slowed / free).toBeCloseTo(BOSS_RULES.puddleSlow, 1)
        return yield* Story.story(
          APPLICATION,
          Story.given(
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
          Story.model(current => {
            expect(fightOf(current).globs).toEqual([])
          }),
        )
      }),
  )

  it.effect('while the player stays far his belch comes sooner', () =>
    Effect.gen(function* () {
      const belchLeft = (bossX: number) =>
        Story.story(
          APPLICATION,
          Story.given(
            sturdy(
              inWave(
                FINAL_WAVE,
                [spawnAt(1e9, 0)],
                fightingBoss(BossMove.Stalking({ cooldownMs: 60_000 })),
                [bossAt(bossX, CENTER_Y)],
              ),
            ),
          ),
          ...ticks(62, FRAME_MS),
        ).pipe(Effect.map(end => fightOf(end).belchMs))
      const elapsed = 62 * FRAME_MS
      const near = yield* belchLeft(CENTER_X + 60)
      const far = yield* belchLeft(FAR_X)
      expect(near).toBeCloseTo(BOSS_RULES.firstBelchMs - elapsed, 6)
      expect(far).toBeCloseTo(
        BOSS_RULES.firstBelchMs - elapsed * BOSS_RULES.belchFarRate,
        6,
      )
    }),
  )
})

describe('enrage', () => {
  const half = BOSS_HP * BOSS_RULES.enrageShare

  it.effect('he enrages once his health falls to half, roaring once', () =>
    Effect.gen(function* () {
      const calm = bossWithHpAt(Math.floor(half) + 1, CENTER_X + 60, CENTER_Y)
      const angry = bossWithHpAt(Math.floor(half), CENTER_X + 60, CENTER_Y)
      const quiet = BossMove.Stalking({ cooldownMs: 60_000 })
      yield* Story.story(
        APPLICATION,
        Story.given(
          inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingBoss(quiet), [calm]),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(fightOf(current).mood).toBe('Calm')
          expect(eventsTagged(current.frameEvents, 'BossEnraged')).toEqual([])
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingBoss(quiet), [angry]),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(fightOf(current).mood).toBe('Enraged')
          expect(eventsTagged(current.frameEvents, 'BossEnraged')).toHaveLength(
            1,
          )
          expect(maybeBossBar(current)).toEqual(
            Option.some({
              name: 'Uncle Chunk',
              hp: Math.floor(half),
              maxHp: BOSS_HP,
              isEnraged: true,
            }),
          )
        }),
        tick(FRAME_MS),
        Story.model(current => {
          expect(eventsTagged(current.frameEvents, 'BossEnraged')).toEqual([])
        }),
      )
    }),
  )

  it.effect('enraged, he walks faster and waits less between attacks', () =>
    Effect.gen(function* () {
      const walked = (mood: 'Calm' | 'Enraged') =>
        Story.story(
          APPLICATION,
          Story.given(
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
        ).pipe(Effect.map(end => CENTER_X + 64 - bossIn(end).x))
      const enraged = yield* walked('Enraged')
      const calm = yield* walked('Calm')
      expect(enraged / calm).toBeCloseTo(BOSS_RULES.enrageSpeedScale, 1)
      const gapAfterStomp = (mood: 'Calm' | 'Enraged') =>
        Story.story(
          APPLICATION,
          Story.given(
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
        ).pipe(
          Effect.map(end => {
            const { move } = fightOf(end)
            return BossMove.isAnyOf(['Recovering'])(move) ? move.cooldownMs : -1
          }),
        )
      const calmGap = yield* gapAfterStomp('Calm')
      const enragedGap = yield* gapAfterStomp('Enraged')
      expect(calmGap).toBe(BOSS_RULES.cooldownMs.Stomp)
      expect(enragedGap).toBe(
        BOSS_RULES.cooldownMs.Stomp * BOSS_RULES.enrageGapScale,
      )
    }),
  )
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

  it.effect('he waits for a glob to land before he winds up a stomp', () =>
    Story.story(
      APPLICATION,
      Story.given(
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
      Story.model(current => {
        expect(BossMove.isAnyOf(['Stalking'])(fightOf(current).move)).toBe(true)
      }),
      ...ticks(
        Math.ceil(300 / FRAME_MS) + Math.ceil(BOSS_RULES.retryMs / FRAME_MS),
        FRAME_MS,
      ),
      Story.model(current => {
        expect(
          Array.filter(fightOf(current).globs, Glob.isAnyOf(['Flying'])),
        ).toEqual([])
        expect(BossMove.isAnyOf(['WindingUp'])(fightOf(current).move)).toBe(
          true,
        )
      }),
    ),
  )

  it.effect('across a whole fight, no frame shows two tells', () =>
    Effect.gen(function* () {
      const tells: Array<number> = []
      const tags: Array<GameEvent['_tag']> = []
      yield* Story.story(
        APPLICATION,
        Story.given(
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
          Story.model((current: Model) => {
            tells.push(tellsOf(current))
            tags.push(...Array.map(current.frameEvents, ({ _tag }) => _tag))
          }),
        ]),
      )
      expect(Math.max(...tells)).toBe(1)
      expect(tags).toContain('BossSpat')
      expect(tags).toContain('BossStomped')
      expect(tags).toContain('BossBelched')
    }),
  )
})

describe('attack pace by difficulty', () => {
  const ready = BossMove.Stalking({ cooldownMs: 0 })

  const cooldownAfterStomp = (difficulty: 'Normal' | 'Hard' | 'Nightmare') => {
    const start = modifyFields(
      inWave(FINAL_WAVE, [spawnAt(1e9, 0)], fightingBoss(ready), [
        bossAt(CENTER_X + 20, CENTER_Y),
      ]),
      {
        difficulty: setting =>
          modifyFields(setting, { chosen: () => difficulty }),
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(sturdy(start)),
      ...ticks(Math.ceil(BOSS_RULES.windUpMs.Stomp / FRAME_MS) + 2, FRAME_MS),
      Story.model(current => {
        expect(fightOf(current).move._tag).toBe('Recovering')
      }),
    ).pipe(
      Effect.map(end => {
        const { move } = fightOf(end)
        return BossMove.isAnyOf(['Recovering'])(move) ? move.cooldownMs : -1
      }),
    )
  }

  it.effect('Normal keeps the table cooldown exactly', () =>
    Effect.gen(function* () {
      expect(DIFFICULTIES.Normal.bossAttackPace).toBe(1)
      expect(BOSS_RULES.cooldownMs).toEqual({
        Stomp: 1600,
        Slam: 2000,
        Belch: 1200,
        Spit: 4500,
        Charge: 3000,
      })
      const normal = yield* cooldownAfterStomp('Normal')
      expect(normal).toBe(BOSS_RULES.cooldownMs.Stomp)
    }),
  )

  it.effect('Hard and Nightmare rest for less, by the difficulty table', () =>
    Effect.gen(function* () {
      expect(DIFFICULTIES.Hard.bossAttackPace).toBeLessThan(1)
      expect(DIFFICULTIES.Nightmare.bossAttackPace).toBeLessThan(
        DIFFICULTIES.Hard.bossAttackPace,
      )
      const hard = yield* cooldownAfterStomp('Hard')
      const nightmare = yield* cooldownAfterStomp('Nightmare')
      expect(hard).toBeCloseTo(
        BOSS_RULES.cooldownMs.Stomp * DIFFICULTIES.Hard.bossAttackPace,
      )
      expect(nightmare).toBeCloseTo(
        BOSS_RULES.cooldownMs.Stomp * DIFFICULTIES.Nightmare.bossAttackPace,
      )
    }),
  )

  test('a faster pace leaves the tells alone', () => {
    expect(BOSS_RULES.windUpMs).toEqual({
      Stomp: 1000,
      Slam: 1200,
      Belch: 800,
      Spit: 500,
      Charge: 800,
    })
  })
})
