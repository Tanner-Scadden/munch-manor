import { Array, Option } from 'effect'
import { given, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

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
import { initialModel, update } from '../../../app/pureApp'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../../shared/constants'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  FIRE_LIFT,
  FIRE_PRESS,
  FIRE_PUSH,
  eventsOver,
  holdFire,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  releaseFire,
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
// `update` with a thumb on the aim stick: hold to charge or swing, lift to
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

// NOTE: the Pan is in the melee slot, the Cooker and Brain Freeze in a gun
// slot.
const spareOf = (current: Model): CarriedGun =>
  Option.getOrThrow(
    Option.orElse(maybePanOf(focusOf(current).player), () =>
      maybeSpareGun(focusOf(current).player.arsenal),
    ),
  )

describe('the Pressure Cooker', () => {
  test('holding builds pressure; lifting throws one lid along the aim', () => {
    story(
      update,
      given(holding(freshGun('Cooker'))),
      holdFire,
      ...ticks(tickCountFor(COOKER_RULES.fullMs / 2), FRAME_MS),
      model(current => {
        expect(
          Charge.isAnyOf(['Building'])(focusOf(current).player.charge),
        ).toBe(true)
        expect(current.lobs).toEqual([])
      }),
      releaseFire,
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).player.charge).toEqual(Charge.Idle())
        expect(current.lobs.length).toBe(1)
        expect(spareOf(current).loaded).toBe(magazineOf('Cooker', 0) - 1)
        const lob = current.lobs[0]
        expect(lob?.to.x).toBeGreaterThan(PLAYER_X + COOKER_RULES.minThrowPx)
        expect(lob?.to.y).toBeCloseTo(ROW_Y, 5)
      }),
    )
  })

  test('the lid bursts on the first zombie it meets, killing and paying', () => {
    const groaner = zombieOf('Shambler', 900, PLAYER_X + 30, ROW_Y)
    const events = eventsOver(holding(freshGun('Cooker'), [groaner]), [
      ...press,
      ...frames(tickCountFor(COOKER_RULES.fullMs)),
      FIRE_LIFT,
      ...frames(30),
    ])
    expect(Array.some(events, GameEvent.isAnyOf(['LidBlasted']))).toBe(true)
    expect(Array.some(events, GameEvent.isAnyOf(['ZombieKilled']))).toBe(true)
  })

  test('more charge throws farther and blasts bigger', () => {
    const throwAfter = (ms: number) => {
      const start = holding(freshGun('Cooker'))
      const thrown = Array.reduce(
        [
          ...press,
          ...frames(tickCountFor(ms)),
          FIRE_LIFT,
          tick(FRAME_MS).message,
        ],
        start,
        (current, sent) => update(current, sent).model,
      )
      return Option.getOrThrow(Array.head(thrown.lobs))
    }
    const tap = throwAfter(50)
    const full = throwAfter(COOKER_RULES.fullMs)
    expect(full.to.x).toBeGreaterThan(tap.to.x)
    expect(lidBlastRadius(full.charge, 0)).toBeGreaterThan(
      lidBlastRadius(tap.charge, 0),
    )
    expect(lidBlastRadius(1, 1)).toBeGreaterThan(lidBlastRadius(1, 0))
  })

  test('held past full it pops in your hands: a shove and a lost lid, but no harm', () => {
    story(
      update,
      given(holding(freshGun('Cooker'))),
      holdFire,
      ...ticks(
        tickCountFor(COOKER_RULES.fullMs + COOKER_RULES.overMs) + 2,
        FRAME_MS,
      ),
      model(current => {
        expect(focusOf(current).player.charge).toEqual(Charge.Spent())
        expect(spareOf(current).loaded).toBe(magazineOf('Cooker', 0) - 1)
        expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
        expect(focusOf(current).player.x).toBeLessThan(PLAYER_X)
        expect(current.lobs).toEqual([])
      }),
      releaseFire,
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).player.charge).toEqual(Charge.Idle())
        expect(current.lobs).toEqual([])
      }),
    )
  })

  test('the pop never hurts, on Nightmare too', () => {
    const popped = Array.reduce(
      [
        ...press,
        ...frames(tickCountFor(COOKER_RULES.fullMs + COOKER_RULES.overMs) + 2),
      ],
      nightmare(holding(freshGun('Cooker'))),
      (current, sent) => update(current, sent).model,
    )
    expect(focusOf(popped).player.charge).toEqual(Charge.Spent())
    expect(focusOf(popped).player.x).toBeLessThan(PLAYER_X)
    expect(focusOf(popped).player.hp).toBe(PLAYER_MAX_HP)
  })

  test('the dial fills in 550 ms, and in 400 ms on the DELUXE', () => {
    const chargeAfter = (tier: number, ms: number): number => {
      const thrown = Array.reduce(
        [...press, ...frames(tickCountFor(ms)), FIRE_LIFT, ...frames(1)],
        holding(modifyFields(freshGun('Cooker'), { tier: () => tier })),
        (current: Model, sent) => update(current, sent).model,
      )
      return Option.getOrThrow(Array.head(thrown.lobs)).charge
    }
    expect(chargeAfter(0, 550)).toBe(1)
    expect(chargeAfter(1, 550)).toBe(1)
    expect(chargeAfter(2, 400)).toBe(1)
    expect(chargeAfter(3, 400)).toBe(1)
    expect(chargeAfter(0, 400)).toBeLessThan(1)
  })

  test('a lid that lands at your feet never hurts you, on Nightmare too', () => {
    const wall = zombieOf('Tank', 901, PLAYER_X + 12, ROW_Y, { hp: 999 })
    const blastAtFeet = (start: Model): Model =>
      Array.reduce(
        [...press, ...frames(3), FIRE_LIFT, ...frames(20)],
        start,
        (current, sent) => update(current, sent).model,
      )
    expect(
      focusOf(blastAtFeet(holding(freshGun('Cooker'), [wall]))).player.hp,
    ).toBe(PLAYER_MAX_HP)
    expect(
      focusOf(blastAtFeet(nightmare(holding(freshGun('Cooker'), [wall]))))
        .player.hp,
    ).toBe(PLAYER_MAX_HP)
  })

  test('an empty pot reloads, four lids a load', () => {
    const empty = modifyFields(freshGun('Cooker'), { loaded: () => 0 })
    story(
      update,
      given(holding(empty)),
      holdFire,
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).player.reload._tag).toBe('Reloading')
      }),
    )
  })
})

describe('the Clang Pan', () => {
  test('holding swings on repeat, shoving what is in front far and dazing a small one', () => {
    const groaner = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, { hp: 99 })
    story(
      update,
      given(holding(freshGun('Pan'), [groaner])),
      holdFire,
      tick(FRAME_MS),
      model(current => {
        const hit = Option.getOrThrow(zombieIn(current, 900))
        expect(hit.hp).toBe(99 - PAN_RULES.damage)
        expect(hit.knockback.x).toBeGreaterThan(PAN_RULES.knockback * 0.7)
        expect(ZombieAction.isAnyOf(['Reeling'])(hit.action)).toBe(true)
        expect(spareOf(current).loaded).toBe(magazineOf('Pan', 0) - 1)
      }),
    )
  })

  test('a zombie the Pan rang gets up Winded and cannot be dazed again at once', () => {
    const groaner = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, { hp: 99 })
    const swings = Array.reduce(
      [...press, ...frames(tickCountFor(PAN_RULES.dazeMs) + 2)],
      holding(freshGun('Pan'), [groaner]),
      (current, sent) => update(current, sent).model,
    )
    const rung = Option.getOrThrow(zombieIn(swings, 900))
    expect(ZombieAction.isAnyOf(['Winded', 'Reeling'])(rung.action)).toBe(true)
    const later = Array.reduce(
      frames(tickCountFor(PAN_RULES.swingMs) + 2),
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
      (current: Model, sent) => update(current, sent).model,
    )
    const again = Option.getOrThrow(zombieIn(later, 900))
    expect(again.hp).toBeLessThan(rung.hp)
    expect(ZombieAction.isAnyOf(['Reeling'])(again.action)).toBe(false)
  })

  test('a Big Lug takes the clang but barely budges and keeps its feet', () => {
    const lug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y)
    const swung = update(
      Array.reduce(
        press,
        holding(freshGun('Pan'), [lug]),
        (current, sent) => update(current, sent).model,
      ),
      tick(FRAME_MS).message,
    ).model
    const hit = Option.getOrThrow(zombieIn(swung, 900))
    expect(hit.hp).toBeLessThan(lug.hp)
    expect(hit.knockback.x).toBeLessThan(PAN_RULES.knockback * 0.2)
    expect(ZombieAction.isAnyOf(['Roaming'])(hit.action)).toBe(true)
  })

  test('a thrown Groaner is swatted out of the air for a home run', () => {
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
    const events = eventsOver(holding(freshGun('Pan'), [flying]), [
      ...press,
      ...frames(2),
    ])
    expect(Array.some(events, GameEvent.isAnyOf(['HomeRun']))).toBe(true)
    expect(Array.some(events, GameEvent.isAnyOf(['ZombieKilled']))).toBe(true)
  })

  test('each swing that lands dents it; fully dented it swings slower; the break bangs it flat', () => {
    const dented = modifyFields(freshGun('Pan'), { loaded: () => 0 })
    const target = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 999 })
    const swingsIn = (spare: CarriedGun, ms: number): number =>
      Array.filter(
        eventsOver(holding(spare, [target]), [
          ...press,
          ...frames(tickCountFor(ms)),
        ]),
        GameEvent.isAnyOf(['PanSwung']),
      ).length
    expect(swingsIn(dented, 3000)).toBeLessThan(swingsIn(freshGun('Pan'), 3000))
    const breakStarts = modifyFields(holding(dented), {
      phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [] }),
    })
    const flattened = Array.reduce(
      frames(240),
      breakStarts,
      (current: Model, sent) => update(current, sent).model,
    )
    expect(Phase.isAnyOf(['Preparation'])(flattened.phase)).toBe(true)
    expect(spareOf(flattened).loaded).toBe(magazineOf('Pan', 0))
  })

  test('the 3000 turns a long hold into a ground smash all round', () => {
    const behind = zombieOf('Shambler', 900, PLAYER_X - 14, ROW_Y, { hp: 99 })
    const events = eventsOver(
      holding(modifyFields(freshGun('Pan'), { tier: () => 3 }), [behind]),
      [...press, ...frames(tickCountFor(PAN_RULES.smashHoldMs) + 30)],
    )
    expect(Array.some(events, GameEvent.isAnyOf(['PanSmashed']))).toBe(true)
  })
})

describe('Brain Freeze', () => {
  test('the cone freezes a small zombie solid and only chills a Big Lug', () => {
    const groaner = zombieOf('Shambler', 900, PLAYER_X + 20, ROW_Y)
    const lug = zombieOf('Tank', 901, PLAYER_X + 30, ROW_Y + 6)
    story(
      update,
      given(holding(freshGun('Freeze'), [groaner, lug])),
      holdFire,
      tick(FRAME_MS),
      model(current => {
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
  })

  test('any hit on a frozen zombie shatters it for four times the damage', () => {
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
    const events = eventsOver(pistol, [...press, ...frames(20)])
    expect(Array.some(events, GameEvent.isAnyOf(['ZombieShattered']))).toBe(
      true,
    )
    const firstHit = Array.reduce(
      [...press, ...frames(20)],
      pistol,
      (current: Model, sent) =>
        Option.getOrThrow(zombieIn(current, 900)).hp < frozen.hp
          ? current
          : update(current, sent).model,
    )
    const hit = Option.getOrThrow(zombieIn(firstHit, 900))
    expect(SHATTER_SCALE).toBe(4)
    expect(frozen.hp - hit.hp).toBe(SHATTER_SCALE * WEAPONS.Pistol.damage)
    expect(frozen.hp - hit.hp).toBeGreaterThan(WEAPONS.Pistol.damage)
    expect(ZombieAction.isAnyOf(['Frozen'])(hit.action)).toBe(false)
  })

  test('eighteen charges, never refilled: empty, it clicks and swaps to the pistol', () => {
    const empty = modifyFields(freshGun('Freeze'), {
      loaded: () => 0,
      rounds: () => 0,
    })
    story(
      update,
      given(holding(empty)),
      holdFire,
      tick(FRAME_MS),
      model(current => {
        expect(focusOf(current).player.reload._tag).toBe('Ready')
        expect(
          Arsenal.isAnyOf(['HoldingFirst'])(focusOf(current).player.arsenal),
        ).toBe(true)
      }),
    )
    expect(magazineOf('Freeze', 0)).toBe(18)
  })

  test('the spray stings each zombie for a point and keeps it frozen, spray after spray', () => {
    const groaner = zombieOf('Shambler', 900, PLAYER_X + 20, ROW_Y, { hp: 9 })
    const twice = [
      ...press,
      ...frames(tickCountFor(FREEZE_RULES.intervalMs) + 2),
    ]
    const sprayed = Array.reduce(
      twice,
      holding(freshGun('Freeze'), [groaner]),
      (current: Model, sent) => update(current, sent).model,
    )
    const iced = Option.getOrThrow(zombieIn(sprayed, 900))
    expect(iced.hp).toBe(9 - 2)
    expect(ZombieAction.isAnyOf(['Frozen'])(iced.action)).toBe(true)
    expect(spareOf(sprayed).loaded).toBe(magazineOf('Freeze', 0) - 2)
    const events = eventsOver(holding(freshGun('Freeze'), [groaner]), twice)
    expect(Array.some(events, GameEvent.isAnyOf(['ZombieShattered']))).toBe(
      false,
    )
  })

  test('the spray reaches 75 px', () => {
    const far = zombieOf('Shambler', 900, PLAYER_X + 75, ROW_Y, { hp: 9 })
    const sprayed = update(
      Array.reduce(
        press,
        holding(freshGun('Freeze'), [far]),
        (current: Model, sent) => update(current, sent).model,
      ),
      tick(FRAME_MS).message,
    ).model
    expect(
      ZombieAction.isAnyOf(['Frozen'])(
        Option.getOrThrow(zombieIn(sprayed, 900)).action,
      ),
    ).toBe(true)
  })

  test('a shatter splashes half its damage on the small zombies beside it', () => {
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
    const firstHit = Array.reduce(
      [...press, ...frames(20)],
      pistol,
      (current: Model, sent) =>
        Option.getOrThrow(zombieIn(current, 900)).hp < frozen.hp
          ? current
          : update(current, sent).model,
    )
    const shattered = Option.getOrThrow(zombieIn(firstHit, 900))
    const shards = Math.round(
      (frozen.hp - shattered.hp) * FREEZE_RULES.splashShare,
    )
    expect(shards).toBe(2 * WEAPONS.Pistol.damage)
    expect(Option.getOrThrow(zombieIn(firstHit, 901)).hp).toBe(99 - shards)
    expect(Option.getOrThrow(zombieIn(firstHit, 902)).hp).toBe(99)
    expect(Option.getOrThrow(zombieIn(firstHit, 903)).hp).toBe(99)
  })

  test('a Big Lug sprayed again while still chilled freezes solid; Uncle Chunk never does', () => {
    const twice = [
      ...press,
      ...frames(tickCountFor(FREEZE_RULES.intervalMs) + 2),
    ]
    const sprayTwice = (zombie: Zombie): Zombie =>
      Option.getOrThrow(
        zombieIn(
          Array.reduce(
            twice,
            holding(freshGun('Freeze'), [zombie]),
            (current: Model, sent) => update(current, sent).model,
          ),
          zombie.id,
        ),
      )
    const lug = sprayTwice(
      zombieOf('Tank', 900, PLAYER_X + 30, ROW_Y, { hp: 99 }),
    )
    expect(ZombieAction.isAnyOf(['Frozen'])(lug.action)).toBe(true)
    expect(lug.action).toMatchObject({ durationMs: 1500 })
    const chunk = sprayTwice(
      zombieOf('Boss', 901, PLAYER_X + 30, ROW_Y, { hp: 99 }),
    )
    expect(ZombieAction.isAnyOf(['Chilled'])(chunk.action)).toBe(true)
  })
})
