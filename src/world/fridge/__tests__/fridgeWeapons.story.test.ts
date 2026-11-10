import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Arsenal,
  type CarriedGun,
  Charge,
  GameEvent,
  Melee,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  APPLICATION,
  FIRE_LIFT,
  FIRE_PRESS,
  FIRE_PUSH,
  eventsOver,
  holdFire,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  playedThrough,
  releaseFire,
  settleRunCommands,
  tick,
  tickCountFor,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { WEAPONS, freshGun, magazineOf, maybePanOf } from '../../gear/weapons'
import { focusOf, modifyFocus } from '../../party/party'
import { SHATTER_SCALE } from '../../step/combat'
import { REELING_GUARD_MS } from '../../zombies/actions'
import {
  COOKER_RULES,
  FREEZE_RULES,
  PAN_RULES,
  lidBlastRadius,
} from '../fridgeWeapons'

// The Mystery Leftovers weapons (src/world/fridge/fridgeWeapons.ts), played through
// Block-aware Stories with a thumb on the aim stick: hold to charge or swing, lift to
// throw.

const FRAME_MS = FIXED_STEP_MS
const ROW_Y = 104
const PLAYER_X = 100

const holding = (
  spare: CarriedGun,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => zombies,
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_X,
          y: () => ROW_Y,
          facing: () => ({ x: 1, y: 0 }),
          ...(spare.kind === 'Pan'
            ? { melee: () => Melee.Pan({ pan: spare }), wield: () => 'Melee' }
            : { arsenal: () => holdingSecond(spare) }),
        }),
    },
  )

const nightmare = (current: Model): Model =>
  modifyFields(current, {
    difficulty: difficulty =>
      modifyFields(difficulty, { chosen: () => 'Nightmare' }),
  })

const zombieIn = (current: Model, id: number): Option.Option<Zombie> =>
  Array.findFirst(current.zombies, zombie => zombie.id === id)

const frames = (count: number): ReadonlyArray<Message> =>
  Array.makeBy(count, () => Message.TickedFrame({ deltaTime: FRAME_MS }))

const press: ReadonlyArray<Message> = [FIRE_PRESS, FIRE_PUSH]

// NOTE: the first Model, `start` included, where `isDone` holds as the
// Messages play through a Block-aware Story, or the last if it never does:
// the frame a shot first lands. The Story gathers each Model it passes in
// an array only it fills, as `recordTicks` does.
const firstModelWhere = (
  start: Model,
  messages: ReadonlyArray<Message>,
  isDone: (current: Model) => boolean,
): Effect.Effect<Model> =>
  Effect.suspend(() => {
    const seen: Array<Model> = [start]
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...Array.flatMap(messages, sent => [
        Story.message(sent),
        Story.model((current: Model) => {
          seen.push(current)
        }),
      ]),
      settleRunCommands,
    ).pipe(
      Effect.map(last =>
        Option.getOrElse(Array.findFirst(seen, isDone), () => last),
      ),
    )
  })

// NOTE: the Pan is in the melee slot, the Cooker and Brain Freeze in a gun
// slot.
const spareOf = (current: Model): CarriedGun =>
  Option.getOrThrow(
    Option.orElse(maybePanOf(focusOf(current).player), () =>
      maybeSpareGun(focusOf(current).player.arsenal),
    ),
  )

describe('the Pressure Cooker', () => {
  it.effect(
    'holding builds pressure; lifting throws one lid along the aim',
    () =>
      Story.story(
        APPLICATION,
        Story.given(holding(freshGun('Cooker'))),
        holdFire,
        ...ticks(tickCountFor(COOKER_RULES.fullMs / 2), FRAME_MS),
        Story.model(current => {
          expect(
            Charge.isAnyOf(['Building'])(focusOf(current).player.charge),
          ).toBe(true)
          expect(current.lobs).toEqual([])
        }),
        releaseFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).player.charge).toEqual(Charge.Idle())
          expect(current.lobs.length).toBe(1)
          expect(spareOf(current).loaded).toBe(magazineOf('Cooker', 0) - 1)
          const lob = current.lobs[0]
          expect(lob?.to.x).toBeGreaterThan(PLAYER_X + COOKER_RULES.minThrowPx)
          expect(lob?.to.y).toBeCloseTo(ROW_Y, 5)
        }),
      ),
  )

  it.effect(
    'the lid bursts on the first zombie it meets, killing and paying',
    () =>
      Effect.gen(function* () {
        const groaner = zombieOf('Shambler', 900, PLAYER_X + 30, ROW_Y)
        const events = yield* eventsOver(
          holding(freshGun('Cooker'), [groaner]),
          [
            ...press,
            ...frames(tickCountFor(COOKER_RULES.fullMs)),
            FIRE_LIFT,
            ...frames(30),
          ],
        )
        expect(Array.some(events, GameEvent.isAnyOf(['LidBlasted']))).toBe(true)
        expect(Array.some(events, GameEvent.isAnyOf(['ZombieKilled']))).toBe(
          true,
        )
      }),
  )

  it.effect('more charge throws farther and blasts bigger', () =>
    Effect.gen(function* () {
      const throwAfter = (ms: number) =>
        playedThrough(holding(freshGun('Cooker')), [
          ...press,
          ...frames(tickCountFor(ms)),
          FIRE_LIFT,
          ...frames(1),
        ]).pipe(
          Effect.map(thrown => Option.getOrThrow(Array.head(thrown.lobs))),
        )
      const tap = yield* throwAfter(50)
      const full = yield* throwAfter(COOKER_RULES.fullMs)
      expect(full.to.x).toBeGreaterThan(tap.to.x)
      expect(lidBlastRadius(full.charge, 0)).toBeGreaterThan(
        lidBlastRadius(tap.charge, 0),
      )
      expect(lidBlastRadius(1, 1)).toBeGreaterThan(lidBlastRadius(1, 0))
    }),
  )

  it.effect(
    'held past full it pops in your hands: a shove and a lost lid, but no harm',
    () =>
      Story.story(
        APPLICATION,
        Story.given(holding(freshGun('Cooker'))),
        holdFire,
        ...ticks(
          tickCountFor(COOKER_RULES.fullMs + COOKER_RULES.overMs) + 2,
          FRAME_MS,
        ),
        Story.model(current => {
          expect(focusOf(current).player.charge).toEqual(Charge.Spent())
          expect(spareOf(current).loaded).toBe(magazineOf('Cooker', 0) - 1)
          expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
          expect(focusOf(current).player.x).toBeLessThan(PLAYER_X)
          expect(current.lobs).toEqual([])
        }),
        releaseFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).player.charge).toEqual(Charge.Idle())
          expect(current.lobs).toEqual([])
        }),
      ),
  )

  it.effect('the pop never hurts, on Nightmare too', () =>
    Effect.gen(function* () {
      const popped = yield* playedThrough(
        nightmare(holding(freshGun('Cooker'))),
        [
          ...press,
          ...frames(
            tickCountFor(COOKER_RULES.fullMs + COOKER_RULES.overMs) + 2,
          ),
        ],
      )
      expect(focusOf(popped).player.charge).toEqual(Charge.Spent())
      expect(focusOf(popped).player.x).toBeLessThan(PLAYER_X)
      expect(focusOf(popped).player.hp).toBe(PLAYER_MAX_HP)
    }),
  )

  it.effect('the dial fills in 550 ms, and in 400 ms on the DELUXE', () =>
    Effect.gen(function* () {
      const chargeAfter = (tier: number, ms: number) =>
        playedThrough(
          holding(modifyFields(freshGun('Cooker'), { tier: () => tier })),
          [...press, ...frames(tickCountFor(ms)), FIRE_LIFT, ...frames(1)],
        ).pipe(
          Effect.map(
            thrown => Option.getOrThrow(Array.head(thrown.lobs)).charge,
          ),
        )
      const full = yield* Effect.forEach(
        [
          [0, 550],
          [1, 550],
          [2, 400],
          [3, 400],
        ] as const,
        ([tier, ms]) => chargeAfter(tier, ms),
      )
      expect(full).toEqual([1, 1, 1, 1])
      const short = yield* chargeAfter(0, 400)
      expect(short).toBeLessThan(1)
    }),
  )

  it.effect(
    'a lid that lands at your feet never hurts you, on Nightmare too',
    () =>
      Effect.gen(function* () {
        const wall = zombieOf('Tank', 901, PLAYER_X + 12, ROW_Y, { hp: 999 })
        const hpAfterBlastAtFeet = (start: Model) =>
          playedThrough(start, [
            ...press,
            ...frames(3),
            FIRE_LIFT,
            ...frames(20),
          ]).pipe(Effect.map(blasted => focusOf(blasted).player.hp))
        const normalHp = yield* hpAfterBlastAtFeet(
          holding(freshGun('Cooker'), [wall]),
        )
        expect(normalHp).toBe(PLAYER_MAX_HP)
        const nightmareHp = yield* hpAfterBlastAtFeet(
          nightmare(holding(freshGun('Cooker'), [wall])),
        )
        expect(nightmareHp).toBe(PLAYER_MAX_HP)
      }),
  )

  it.effect('an empty pot reloads, four lids a load', () => {
    const empty = modifyFields(freshGun('Cooker'), { loaded: () => 0 })
    return Story.story(
      APPLICATION,
      Story.given(holding(empty)),
      holdFire,
      tick(FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.reload._tag).toBe('Reloading')
      }),
    )
  })
})

describe('the Clang Pan', () => {
  it.effect(
    'holding swings on repeat, shoving what is in front far and dazing a small one',
    () => {
      const groaner = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, {
        hp: 99,
      })
      return Story.story(
        APPLICATION,
        Story.given(holding(freshGun('Pan'), [groaner])),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          const hit = Option.getOrThrow(zombieIn(current, 900))
          expect(hit.hp).toBe(99 - PAN_RULES.damage)
          expect(hit.knockback.x).toBeGreaterThan(PAN_RULES.knockback * 0.7)
          expect(ZombieAction.isAnyOf(['Reeling'])(hit.action)).toBe(true)
          expect(spareOf(current).loaded).toBe(magazineOf('Pan', 0) - 1)
        }),
      )
    },
  )

  it.effect(
    'a zombie the Pan rang gets up Winded and cannot be dazed again at once',
    () =>
      Effect.gen(function* () {
        const groaner = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, {
          hp: 99,
        })
        const swings = yield* playedThrough(
          holding(freshGun('Pan'), [groaner]),
          [...press, ...frames(tickCountFor(PAN_RULES.dazeMs) + 2)],
        )
        const rung = Option.getOrThrow(zombieIn(swings, 900))
        expect(ZombieAction.isAnyOf(['Winded', 'Reeling'])(rung.action)).toBe(
          true,
        )
        const later = yield* playedThrough(
          modifyFields(swings, {
            zombies: zombies =>
              Array.map(zombies, zombie =>
                modifyFields(zombie, {
                  x: () => PLAYER_X + 10,
                  y: () => ROW_Y,
                  action: () =>
                    ZombieAction.Winded({ remainingMs: REELING_GUARD_MS }),
                }),
              ),
          }),
          frames(tickCountFor(PAN_RULES.swingMs) + 2),
        )
        const again = Option.getOrThrow(zombieIn(later, 900))
        expect(again.hp).toBeLessThan(rung.hp)
        expect(ZombieAction.isAnyOf(['Reeling'])(again.action)).toBe(false)
      }),
  )

  it.effect(
    'a Big Lug takes the clang but barely budges and keeps its feet',
    () => {
      const lug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y)
      return Story.story(
        APPLICATION,
        Story.given(holding(freshGun('Pan'), [lug])),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          const hit = Option.getOrThrow(zombieIn(current, 900))
          expect(hit.hp).toBeLessThan(lug.hp)
          expect(hit.knockback.x).toBeLessThan(PAN_RULES.knockback * 0.2)
          expect(ZombieAction.isAnyOf(['Roaming'])(hit.action)).toBe(true)
        }),
        settleRunCommands,
      )
    },
  )

  it.effect('a thrown Groaner is swatted out of the air for a home run', () =>
    Effect.gen(function* () {
      const flying = modifyFields(
        zombieOf('Shambler', 900, PLAYER_X + 12, ROW_Y),
        {
          action: () =>
            ZombieAction.Flying({
              from: { x: PLAYER_X + 80, y: ROW_Y },
              to: { x: PLAYER_X, y: ROW_Y },
              remainingMs: 200,
              durationMs: 600,
            }),
        },
      )
      const events = yield* eventsOver(holding(freshGun('Pan'), [flying]), [
        ...press,
        ...frames(2),
      ])
      expect(Array.some(events, GameEvent.isAnyOf(['HomeRun']))).toBe(true)
      expect(Array.some(events, GameEvent.isAnyOf(['ZombieKilled']))).toBe(true)
    }),
  )

  it.effect(
    'each swing that lands dents it; fully dented it swings slower; the break bangs it flat',
    () =>
      Effect.gen(function* () {
        const dented = modifyFields(freshGun('Pan'), { loaded: () => 0 })
        const target = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 999 })
        const swingsIn = (spare: CarriedGun, ms: number) =>
          eventsOver(holding(spare, [target]), [
            ...press,
            ...frames(tickCountFor(ms)),
          ]).pipe(
            Effect.map(
              events =>
                Array.filter(events, GameEvent.isAnyOf(['PanSwung'])).length,
            ),
          )
        const dentedSwings = yield* swingsIn(dented, 3000)
        const freshSwings = yield* swingsIn(freshGun('Pan'), 3000)
        expect(dentedSwings).toBeLessThan(freshSwings)
        const breakStarts = modifyFields(holding(dented), {
          phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [] }),
        })
        const flattened = yield* playedThrough(breakStarts, frames(240))
        expect(Phase.isAnyOf(['Preparation'])(flattened.phase)).toBe(true)
        expect(spareOf(flattened).loaded).toBe(magazineOf('Pan', 0))
      }),
  )

  it.effect('the 3000 turns a long hold into a ground smash all round', () =>
    Effect.gen(function* () {
      const behind = zombieOf('Shambler', 900, PLAYER_X - 14, ROW_Y, {
        hp: 99,
      })
      const events = yield* eventsOver(
        holding(modifyFields(freshGun('Pan'), { tier: () => 3 }), [behind]),
        [...press, ...frames(tickCountFor(PAN_RULES.smashHoldMs) + 30)],
      )
      expect(Array.some(events, GameEvent.isAnyOf(['PanSmashed']))).toBe(true)
    }),
  )
})

describe('Brain Freeze', () => {
  it.effect(
    'the cone freezes a small zombie solid and only chills a Big Lug',
    () => {
      const groaner = zombieOf('Shambler', 900, PLAYER_X + 20, ROW_Y)
      const lug = zombieOf('Tank', 901, PLAYER_X + 30, ROW_Y + 6)
      return Story.story(
        APPLICATION,
        Story.given(holding(freshGun('Freeze'), [groaner, lug])),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(
            ZombieAction.isAnyOf(['Frozen'])(
              Option.getOrThrow(zombieIn(current, 900)).action,
            ),
          ).toBe(true)
          expect(
            ZombieAction.isAnyOf(['Chilled'])(
              Option.getOrThrow(zombieIn(current, 901)).action,
            ),
          ).toBe(true)
          expect(spareOf(current).loaded).toBe(17)
        }),
      )
    },
  )

  it.effect(
    'any hit on a frozen zombie shatters it for four times the damage',
    () =>
      Effect.gen(function* () {
        const frozen = modifyFields(
          zombieOf('Thrower', 900, PLAYER_X + 40, ROW_Y),
          {
            action: () =>
              ZombieAction.Frozen({
                remainingMs: FREEZE_RULES.frozenMs,
                durationMs: FREEZE_RULES.frozenMs,
              }),
          },
        )
        const pistol = modifyFocus(holding(freshGun('Freeze'), [frozen]), {
          player: player =>
            modifyFields(player, {
              arsenal: () => holdingFirst(freshGun('Freeze')),
            }),
        })
        const events = yield* eventsOver(pistol, [...press, ...frames(20)])
        expect(Array.some(events, GameEvent.isAnyOf(['ZombieShattered']))).toBe(
          true,
        )
        const firstHit = yield* firstModelWhere(
          pistol,
          [...press, ...frames(20)],
          current => Option.getOrThrow(zombieIn(current, 900)).hp < frozen.hp,
        )
        const hit = Option.getOrThrow(zombieIn(firstHit, 900))
        expect(SHATTER_SCALE).toBe(4)
        expect(frozen.hp - hit.hp).toBe(SHATTER_SCALE * WEAPONS.Pistol.damage)
        expect(frozen.hp - hit.hp).toBeGreaterThan(WEAPONS.Pistol.damage)
        expect(ZombieAction.isAnyOf(['Frozen'])(hit.action)).toBe(false)
      }),
  )

  it.effect(
    'eighteen charges a load: empty, it reloads in hand and never runs dry',
    () =>
      Effect.gen(function* () {
        const empty = modifyFields(freshGun('Freeze'), { loaded: () => 0 })
        yield* Story.story(
          APPLICATION,
          Story.given(holding(empty)),
          holdFire,
          tick(FRAME_MS),
          Story.model(current => {
            expect(focusOf(current).player.reload._tag).toBe('Reloading')
            expect(
              Arsenal.isAnyOf(['HoldingSecond'])(
                focusOf(current).player.arsenal,
              ),
            ).toBe(true)
          }),
          ...ticks(Math.ceil(WEAPONS.Freeze.reloadMs / FRAME_MS) + 1, FRAME_MS),
          Story.model(current => {
            expect(spareOf(current).kind).toBe('Freeze')
            expect(spareOf(current).loaded).toBeGreaterThan(0)
          }),
        )
        expect(magazineOf('Freeze', 0)).toBe(18)
      }),
  )

  it.effect(
    'the spray stings each zombie for a point and keeps it frozen, spray after spray',
    () =>
      Effect.gen(function* () {
        const groaner = zombieOf('Shambler', 900, PLAYER_X + 20, ROW_Y, {
          hp: 9,
        })
        const twice = [
          ...press,
          ...frames(tickCountFor(FREEZE_RULES.intervalMs) + 2),
        ]
        const sprayed = yield* playedThrough(
          holding(freshGun('Freeze'), [groaner]),
          twice,
        )
        const iced = Option.getOrThrow(zombieIn(sprayed, 900))
        expect(iced.hp).toBe(9 - 2)
        expect(ZombieAction.isAnyOf(['Frozen'])(iced.action)).toBe(true)
        expect(spareOf(sprayed).loaded).toBe(magazineOf('Freeze', 0) - 2)
        const events = yield* eventsOver(
          holding(freshGun('Freeze'), [groaner]),
          twice,
        )
        expect(Array.some(events, GameEvent.isAnyOf(['ZombieShattered']))).toBe(
          false,
        )
      }),
  )

  it.effect('the spray reaches 75 px', () => {
    const far = zombieOf('Shambler', 900, PLAYER_X + 75, ROW_Y, { hp: 9 })
    return Story.story(
      APPLICATION,
      Story.given(holding(freshGun('Freeze'), [far])),
      holdFire,
      tick(FRAME_MS),
      Story.model(current => {
        expect(
          ZombieAction.isAnyOf(['Frozen'])(
            Option.getOrThrow(zombieIn(current, 900)).action,
          ),
        ).toBe(true)
      }),
      settleRunCommands,
    )
  })

  it.effect(
    'a shatter splashes half its damage on the small zombies beside it',
    () =>
      Effect.gen(function* () {
        const iced = ZombieAction.Frozen({
          remainingMs: FREEZE_RULES.frozenMs,
          durationMs: FREEZE_RULES.frozenMs,
        })
        const frozen = modifyFields(
          zombieOf('Shambler', 900, PLAYER_X + 40, ROW_Y, { hp: 99 }),
          { action: () => iced },
        )
        const beside = zombieOf('Runner', 901, PLAYER_X + 40, ROW_Y + 14, {
          hp: 99,
        })
        const lug = zombieOf('Tank', 902, PLAYER_X + 52, ROW_Y - 14, { hp: 99 })
        const away = zombieOf('Shambler', 903, PLAYER_X + 40, ROW_Y + 60, {
          hp: 99,
        })
        const pistol = modifyFocus(
          holding(freshGun('Freeze'), [frozen, beside, lug, away]),
          {
            player: player =>
              modifyFields(player, {
                arsenal: () => holdingFirst(freshGun('Freeze')),
              }),
          },
        )
        const firstHit = yield* firstModelWhere(
          pistol,
          [...press, ...frames(20)],
          current => Option.getOrThrow(zombieIn(current, 900)).hp < frozen.hp,
        )
        const shattered = Option.getOrThrow(zombieIn(firstHit, 900))
        const shards = Math.round(
          (frozen.hp - shattered.hp) * FREEZE_RULES.splashShare,
        )
        expect(shards).toBe(2 * WEAPONS.Pistol.damage)
        expect(Option.getOrThrow(zombieIn(firstHit, 901)).hp).toBe(99 - shards)
        expect(Option.getOrThrow(zombieIn(firstHit, 902)).hp).toBe(99)
        expect(Option.getOrThrow(zombieIn(firstHit, 903)).hp).toBe(99)
      }),
  )

  it.effect(
    'a Big Lug sprayed again while still chilled freezes solid; Uncle Chunk never does',
    () =>
      Effect.gen(function* () {
        const twice = [
          ...press,
          ...frames(tickCountFor(FREEZE_RULES.intervalMs) + 2),
        ]
        const sprayTwice = (zombie: Zombie) =>
          playedThrough(holding(freshGun('Freeze'), [zombie]), twice).pipe(
            Effect.map(sprayed =>
              Option.getOrThrow(zombieIn(sprayed, zombie.id)),
            ),
          )
        const lug = yield* sprayTwice(
          zombieOf('Tank', 900, PLAYER_X + 30, ROW_Y, { hp: 99 }),
        )
        expect(ZombieAction.isAnyOf(['Frozen'])(lug.action)).toBe(true)
        expect(lug.action).toMatchObject({ durationMs: 1500 })
        const chunk = yield* sprayTwice(
          zombieOf('Boss', 901, PLAYER_X + 30, ROW_Y, { hp: 99 }),
        )
        expect(ZombieAction.isAnyOf(['Chilled'])(chunk.action)).toBe(true)
      }),
  )
})
