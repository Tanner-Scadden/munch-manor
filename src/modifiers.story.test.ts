import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { addBot } from './bots'
import { FIXED_STEP_MS, PLAYER_MAX_HP, SHAMBLER_BOUNTY } from './constants'
import { advanceLobs } from './fridgeWeapons'
import { FRIDGE_RULES, pullFridge } from './leftovers'
import { Message } from './message'
import {
  type Bullet,
  Life,
  type Model,
  Phase,
  Pierce,
  RunMode,
  type Zombie,
} from './model'
import {
  DISTANT_SPAWN,
  atFridge,
  crewInWave,
  home,
  pipeline,
  placeSeat,
  readyAfterRead,
  withSeatLife,
} from './model.fixture'
import {
  MODIFIER_ORDER,
  type Modifiers,
  bonusPercentOf,
  brokenKillPay,
  isModifierOn,
  maskOfModifiers,
  modifiersOfMask,
  modifiersOn,
  noModifiers,
  toggledModifier,
} from './modifiers'
import { effectiveModifiersOf } from './onlineRun'
import {
  COOP_RULES,
  focusOf,
  focusSlotOf,
  isFriendlyFireOn,
  maybePlayerAt,
  playersOf,
} from './party'
import { DROP_RULES } from './powerups'
import { offersOf } from './purchase'
import { initialModel, update } from './pureApp'
import { playRoom } from './roomTesting'
import { roomSettingsOf, startRoomWorld } from './roomWorld'
import { startOrResume } from './runFlow'
import {
  HOLD_TICKS,
  bulletInto,
  openLobbyByKey,
  press,
  release,
  resolveFocusLobby,
  tick,
  ticks,
  zombieOf,
} from './testing'
import { asVeteran } from './veteran'
import { beginPreparation } from './waves'
import type { World } from './world'
import { type Lob, type PlannedSpawn } from './worldSchema'

// Run modifiers (src/modifiers.ts): the four opt-in rules, each played
// through the World the single player update and the co-op room both run,
// and the bonus they add to the pay.

const FRAME_MS = 50
const TICK_MS = FIXED_STEP_MS
const ROW_Y = 104

const only = (change: Partial<Modifiers>): Modifiers => ({
  ...noModifiers,
  ...change,
})

const withModifiers = (base: Model, modifiers: Modifiers): Model =>
  modifyFields(base, { modifiers: () => modifiers })

describe('the set and its bonus', () => {
  test('the bonuses add: 15, 25, 75, and 350 make 465', () => {
    expect(bonusPercentOf(noModifiers)).toBe(0)
    expect(bonusPercentOf(only({ friendlyFire: true }))).toBe(15)
    expect(bonusPercentOf(only({ bigCrowd: true }))).toBe(25)
    expect(bonusPercentOf(only({ broke: true }))).toBe(75)
    expect(bonusPercentOf(only({ glass: true }))).toBe(350)
    expect(
      bonusPercentOf({
        friendlyFire: true,
        bigCrowd: true,
        broke: true,
        glass: true,
      }),
    ).toBe(465)
  })

  test('a toggle turns one on and off and touches no other', () => {
    const on = toggledModifier(noModifiers, 'Broke')
    expect(on).toEqual(only({ broke: true }))
    expect(toggledModifier(on, 'Broke')).toEqual(noModifiers)
    expect(modifiersOn(toggledModifier(on, 'Glass'))).toEqual([
      'Broke',
      'Glass',
    ])
  })

  test('the lobby mask round trips every set, a bit for each in order', () => {
    Array.forEach(Array.range(0, 15), mask => {
      expect(maskOfModifiers(modifiersOfMask(mask))).toBe(mask)
    })
    Array.forEach(MODIFIER_ORDER, (modifier, index) => {
      expect(maskOfModifiers(toggledModifier(noModifiers, modifier))).toBe(
        1 << index,
      )
      expect(isModifierOn(modifiersOfMask(1 << index), modifier)).toBe(true)
    })
  })

  test('Broke halves a kill to the nearest dollar and never to nothing', () => {
    const broke = only({ broke: true })
    expect(brokenKillPay(broke, 150)).toBe(75)
    expect(brokenKillPay(broke, 4)).toBe(2)
    expect(brokenKillPay(broke, 3)).toBe(2)
    expect(brokenKillPay(broke, 1)).toBe(1)
    expect(brokenKillPay(broke, 0)).toBe(0)
    expect(brokenKillPay(noModifiers, 4)).toBe(4)
  })
})

describe('Friendly Fire', () => {
  const bulletFrom = (shooter: number, x: number): Bullet => ({
    id: 800,
    x,
    y: ROW_Y,
    velocityX: 300,
    velocityY: 0,
    remainingMs: 1000,
    weapon: 'Pistol',
    damage: 1,
    knockback: 0,
    glaze: 'Plain',
    pierce: Pierce.Stops(),
    shooter,
  })

  const inTheLine = (modifiers: Modifiers): Model =>
    pipeline(placeSeat(0, 60, ROW_Y), placeSeat(1, 150, ROW_Y), current =>
      modifyFields(current, { bullets: () => [bulletFrom(0, 140)] }),
    )(withModifiers(crewInWave(2), modifiers))

  const hpOf = (current: Model, slot: number): number =>
    Option.getOrThrow(maybePlayerAt(current, slot)).player.hp

  test('on, a teammate’s shot wounds the player it reaches and stops there', () => {
    story(
      update,
      given(inTheLine(only({ friendlyFire: true }))),
      ...ticks(2, TICK_MS),
      model(current => {
        expect(hpOf(current, 1)).toBe(PLAYER_MAX_HP - 1)
        expect(hpOf(current, 0)).toBe(PLAYER_MAX_HP)
        expect(current.bullets).toEqual([])
      }),
    )
  })

  test('off, the same shot passes through', () => {
    story(
      update,
      given(inTheLine(noModifiers)),
      ...ticks(2, TICK_MS),
      model(current => {
        expect(hpOf(current, 1)).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  test('it bites only with a teammate to hit, a player or a bot', () => {
    const friendly = only({ friendlyFire: true })
    expect(isFriendlyFireOn(withModifiers(crewInWave(1), friendly))).toBe(false)
    expect(isFriendlyFireOn(withModifiers(crewInWave(2), friendly))).toBe(true)
    expect(isFriendlyFireOn(withModifiers(crewInWave(2), noModifiers))).toBe(
      false,
    )
    expect(
      effectiveModifiersOf(withModifiers(crewInWave(1), friendly)),
    ).toEqual(noModifiers)
    expect(
      effectiveModifiersOf(withModifiers(crewInWave(3), friendly)),
    ).toEqual(friendly)
  })

  test('with nobody to hit it does nothing: one seat never shoots itself', () => {
    const solo = pipeline(placeSeat(0, 150, ROW_Y), current =>
      modifyFields(current, { bullets: () => [bulletFrom(0, 140)] }),
    )(withModifiers(crewInWave(1), only({ friendlyFire: true })))
    story(
      update,
      given(solo),
      ...ticks(2, TICK_MS),
      model(current => {
        expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
      }),
    )
  })

  const lidAt = (x: number): Lob => ({
    id: 900,
    x,
    y: ROW_Y,
    from: { x, y: ROW_Y },
    to: { x, y: ROW_Y },
    remainingMs: 1,
    durationMs: 100,
    charge: 1,
    tier: 0,
    shooter: 0,
  })

  const huddled = (modifiers: Modifiers): World =>
    pipeline(placeSeat(0, 60, ROW_Y), placeSeat(1, 64, ROW_Y), current =>
      modifyFields(current, { lobs: () => [lidAt(62)] }),
    )(withModifiers(crewInWave(2), modifiers))

  const onNightmare = (world: World): World =>
    modifyFields(world, {
      difficulty: difficulty =>
        modifyFields(difficulty, { chosen: () => 'Nightmare' }),
    })

  test('on, a lid’s blast hurts a teammate but never its thrower, on any difficulty', () => {
    Array.forEach(
      [
        huddled(only({ friendlyFire: true })),
        onNightmare(huddled(only({ friendlyFire: true }))),
      ],
      start => {
        const burst = advanceLobs(start, TICK_MS)
        expect(burst.lobs).toEqual([])
        expect(Option.getOrThrow(maybePlayerAt(burst, 0)).player.hp).toBe(
          PLAYER_MAX_HP,
        )
        expect(
          Option.getOrThrow(maybePlayerAt(burst, 1)).player.hp,
        ).toBeLessThan(PLAYER_MAX_HP)
      },
    )
  })

  test('off, a lid’s blast hurts no one, Nightmare included', () => {
    Array.forEach(
      [huddled(noModifiers), onNightmare(huddled(noModifiers))],
      start => {
        const burst = advanceLobs(start, TICK_MS)
        expect(burst.lobs).toEqual([])
        Array.forEach(playersOf(burst), ({ player }) => {
          expect(player.hp).toBe(PLAYER_MAX_HP)
        })
      },
    )
  })
})

describe('Big Crowd', () => {
  const spawnsOf = (world: World): ReadonlyArray<PlannedSpawn> =>
    world.phase._tag === 'Preparation' ? world.phase.spawns : []

  const rolled = (count: number, modifiers: Modifiers, wave = 4) =>
    spawnsOf(
      beginPreparation(
        withModifiers(crewInWave(count, Phase.Ready()), modifiers),
        wave,
        30_000,
      ),
    )

  test('brings half as many zombies again to a wave played alone', () => {
    const plain = rolled(1, noModifiers)
    const crowded = rolled(1, only({ bigCrowd: true }))
    expect(plain.length).toBeGreaterThan(4)
    expect(crowded).toHaveLength(Math.floor(plain.length * 1.5))
  })

  test('stacks on a crew’s count, and the copies are no tougher than the crew’s', () => {
    const solo = rolled(1, noModifiers)
    const plain = rolled(2, noModifiers)
    const crowded = rolled(2, only({ bigCrowd: true }))
    expect(plain).toHaveLength(Math.floor(solo.length * 1.6))
    expect(crowded).toHaveLength(Math.floor(solo.length * 1.6 * 1.5))
    expect(crowded[0]?.hpScale).toBeCloseTo(plain[0]?.hpScale ?? 1)
  })

  test('brings them to Endless waves as well', () => {
    const endless = (modifiers: Modifiers) =>
      spawnsOf(
        beginPreparation(
          modifyFields(withModifiers(crewInWave(1, Phase.Ready()), modifiers), {
            mode: () => RunMode.Endless(),
          }),
          12,
          30_000,
        ),
      )
    expect(endless(only({ bigCrowd: true })).length).toBeGreaterThan(
      endless(noModifiers).length,
    )
  })
})

describe('Broke', () => {
  const fighting: Model = modifyFields(asVeteran(initialModel), {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    pacing: pacing =>
      modifyFields(pacing, { warnedPacks: () => [DISTANT_SPAWN.pack] }),
  })

  const shamblerDown = (modifiers: Modifiers): Model => {
    const victim: Zombie = zombieOf('Shambler', 100, 60, 85, { hp: 1 })
    return withModifiers(
      modifyFields(fighting, {
        zombies: () => [victim],
        bullets: () => [bulletInto(500, victim, { knockback: 0 })],
      }),
      modifiers,
    )
  }

  const paidFor = (modifiers: Modifiers): number => {
    let paid = -1
    story(
      update,
      given(shamblerDown(modifiers)),
      tick(FRAME_MS),
      model(current => {
        paid = focusOf(current).wallet.balance
      }),
    )
    return paid
  }

  test('a kill pays half', () => {
    const full = paidFor(noModifiers)
    expect(full).toBe(SHAMBLER_BOUNTY)
    expect(paidFor(only({ broke: true }))).toBe(
      brokenKillPay(only({ broke: true }), SHAMBLER_BOUNTY),
    )
    expect(paidFor(only({ broke: true }))).toBeLessThan(full)
  })

  const isFridgeOffered = (current: Model): boolean =>
    Array.some(
      offersOf(current, focusSlotOf(current)),
      ({ target }) => target._tag === 'Fridge',
    )

  test('the fridge is not for sale, and holding at it pulls nothing', () => {
    expect(isFridgeOffered(atFridge(100))).toBe(true)
    const broke = withModifiers(atFridge(100), only({ broke: true }))
    expect(isFridgeOffered(broke)).toBe(false)
    story(
      update,
      given(broke),
      press('Enter'),
      ...ticks(HOLD_TICKS, FRAME_MS),
      release('Enter'),
      model(current => {
        expect(focusOf(current).wallet.balance).toBe(100)
        expect(current.fridge.pulls).toBe(0)
        expect(FRIDGE_RULES.price).toBeGreaterThan(0)
      }),
    )
  })
})

describe('Glass', () => {
  const glass = only({ glass: true })

  test('a run starts on one heart, whatever the hero’s hearts', () => {
    const started = startOrResume(
      withModifiers(readyAfterRead, glass),
      RunMode.Campaign(),
    )
    expect(Phase.guards.Preparation(started.phase)).toBe(true)
    expect(focusOf(started).player.hp).toBe(1)
    const plain = startOrResume(readyAfterRead, RunMode.Campaign())
    expect(focusOf(plain).player.hp).toBe(PLAYER_MAX_HP)
  })

  test('a bot teammate starts on one heart too', () => {
    const crew = addBot(withModifiers(readyAfterRead, glass))
    const started = startOrResume(crew, RunMode.Campaign())
    expect(playersOf(started)).toHaveLength(2)
    Array.forEach(playersOf(started), ({ player }) => {
      expect(player.hp).toBe(1)
    })
  })

  test('a co-op room starts every seat on one heart', () => {
    const room = startRoomWorld(
      [0, 1, 2],
      7,
      roomSettingsOf('Campaign', 'Normal', [], maskOfModifiers(glass)),
    )
    expect(room.world.modifiers).toEqual(glass)
    Array.forEach(playersOf(room.world), ({ player }) => {
      expect(player.hp).toBe(1)
    })
  })

  const dropsFor = (
    modifiers: Modifiers,
    rngState: number,
  ): ReadonlyArray<string> => {
    const victims = Array.makeBy(2, index =>
      zombieOf('Tank', 100 + index, 30 + index * 22, 85, { hp: 1 }),
    )
    const hurt = pipeline(
      current =>
        modifyFields(current, {
          zombies: () => victims,
          bullets: () =>
            Array.map(victims, victim =>
              bulletInto(victim.id + 500, victim, { knockback: 0 }),
            ),
          loot: loot => ({
            ...loot,
            rngState,
            dryMs: DROP_RULES.pityMs,
          }),
        }),
      placeSeat(0, 160, 120, 2),
    )(
      withModifiers(
        modifyFields(asVeteran(initialModel), {
          phase: () =>
            Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
          pacing: pacing =>
            modifyFields(pacing, { warnedPacks: () => [DISTANT_SPAWN.pack] }),
        }),
        modifiers,
      ),
    )
    const kinds: Array<string> = []
    story(
      update,
      given(hurt),
      tick(FRAME_MS),
      model(current => {
        Array.forEach(current.pickups, ({ kind }) => kinds.push(kind))
      }),
    )
    return kinds
  }

  test('no heart drops, where a hurt player would otherwise find some', () => {
    const seeds = Array.makeBy(80, index => 11 + index * 7919)
    const withGlass = Array.flatMap(seeds, seed => dropsFor(glass, seed))
    const without = Array.flatMap(seeds, seed => dropsFor(noModifiers, seed))
    expect(without).toContain('Heart')
    expect(withGlass.length).toBeGreaterThan(0)
    expect(withGlass).not.toContain('Heart')
  })

  const prizesFor = (modifiers: Modifiers): ReadonlyArray<string> =>
    Array.map(
      Array.makeBy(200, index => 3 + index * 7919),
      seed => {
        const facing = withModifiers(
          modifyFields(atFridge(1000), {
            loot: loot => ({ ...loot, fridgeRngState: seed }),
          }),
          modifiers,
        )
        return Option.match(
          pullFridge(facing, focusSlotOf(facing), FRIDGE_RULES.price),
          {
            onNone: () => 'None',
            onSome: pulled =>
              pulled.fridge.door._tag === 'Open'
                ? pulled.fridge.door.prize
                : 'None',
          },
        )
      },
    )

  test('the fridge never pulls the healing Sandwich', () => {
    const withGlass = prizesFor(glass)
    expect(prizesFor(noModifiers)).toContain('Sandwich')
    expect(withGlass).not.toContain('None')
    expect(withGlass).not.toContain('Sandwich')
  })

  test('a revived teammate gets up on one heart', () => {
    const reviveTicks = Math.ceil(COOP_RULES.reviveMs / TICK_MS)
    story(
      update,
      given(
        pipeline(
          placeSeat(0, 232, ROW_Y),
          placeSeat(1, 240, ROW_Y, 0),
          withSeatLife(
            1,
            Life.Downed({
              bleedMs: COOP_RULES.bleedOutMs,
              reviveMs: 0,
              callMs: 0,
            }),
          ),
        )(withModifiers(crewInWave(2), glass)),
      ),
      ...ticks(reviveTicks, TICK_MS),
      model(current => {
        const risen = Array.findFirst(
          playersOf(current),
          ({ seat }) => seat.slot === 1,
        )
        expect(Option.map(risen, ({ seat }) => seat.life._tag)).toEqual(
          Option.some('Standing'),
        )
        expect(Option.map(risen, ({ player }) => player.hp)).toEqual(
          Option.some(1),
        )
      }),
    )
  })

  test('the fallen come back at the break on one heart', () => {
    story(
      update,
      given(
        pipeline(
          withSeatLife(1, Life.BledOut()),
          placeSeat(1, 240, ROW_Y, 0),
        )(
          withModifiers(
            crewInWave(2, Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [] })),
            glass,
          ),
        ),
      ),
      ...ticks(1, TICK_MS),
      model(current => {
        expect(current.phase._tag).toBe('Preparation')
        const back = Array.findFirst(
          playersOf(current),
          ({ seat }) => seat.slot === 1,
        )
        expect(Option.map(back, ({ seat }) => seat.life._tag)).toEqual(
          Option.some('Standing'),
        )
        expect(Option.map(back, ({ player }) => player.hp)).toEqual(
          Option.some(1),
        )
      }),
    )
  })
})

describe('the modifiers in a room', () => {
  const settingsWith = (modifiers: Modifiers) =>
    roomSettingsOf('Campaign', 'Normal', [], maskOfModifiers(modifiers))

  test('a room starts with the host’s pick in its World', () => {
    const room = startRoomWorld(
      [0, 1],
      7,
      settingsWith(only({ bigCrowd: true, broke: true })),
    )
    expect(room.world.modifiers).toEqual(only({ bigCrowd: true, broke: true }))
    expect(
      startRoomWorld([0, 1], 7, settingsWith(noModifiers)).world.modifiers,
    ).toEqual(noModifiers)
  })

  test('a room of three plays on with every modifier on, the same every time', () => {
    const everything = only({
      friendlyFire: true,
      bigCrowd: true,
      broke: true,
      glass: true,
    })
    const room = startRoomWorld([0, 1, 2], 7, settingsWith(everything))
    const played = playRoom(room, 900)
    expect(played.tick).toBe(900)
    expect(played.world.modifiers).toEqual(everything)
    expect(playRoom(room, 900).world).toEqual(played.world)
    expect(played.world.elapsedMs).toBeGreaterThan(0)
  })

  test('Big Crowd fills the room’s first wave', () => {
    const spawnsIn = (modifiers: Modifiers): number => {
      const { phase } = startRoomWorld([0, 1], 7, settingsWith(modifiers)).world
      return phase._tag === 'Preparation' ? phase.spawns.length : 0
    }
    expect(spawnsIn(only({ bigCrowd: true }))).toBeGreaterThan(
      spawnsIn(noModifiers),
    )
  })
})

describe('the solo lobby', () => {
  const crewed = addBot(readyAfterRead)

  test('a tile turns a modifier on and off where it sits', () => {
    story(
      update,
      given(readyAfterRead),
      openLobbyByKey,
      message(Message.ClickedLobbyModifierButton({ modifier: 'Glass' })),
      model(current => {
        expect(current.modifiers).toEqual(only({ glass: true }))
      }),
      message(Message.ClickedLobbyModifierButton({ modifier: 'Broke' })),
      model(current => {
        expect(current.modifiers).toEqual(only({ glass: true, broke: true }))
      }),
      message(Message.ClickedLobbyModifierButton({ modifier: 'Glass' })),
      model(current => {
        expect(current.modifiers).toEqual(only({ broke: true }))
      }),
    )
  })

  test('Friendly Fire is dim until a bot sits in the crew', () => {
    story(
      update,
      given(readyAfterRead),
      openLobbyByKey,
      message(Message.ClickedLobbyModifierButton({ modifier: 'FriendlyFire' })),
      model(current => {
        expect(current.modifiers).toEqual(noModifiers)
      }),
    )
    story(
      update,
      given(crewed),
      openLobbyByKey,
      message(Message.ClickedLobbyModifierButton({ modifier: 'FriendlyFire' })),
      model(current => {
        expect(current.modifiers).toEqual(only({ friendlyFire: true }))
      }),
    )
  })

  test('sending the last bot home turns Friendly Fire off with it', () => {
    story(
      update,
      given(withModifiers(crewed, only({ friendlyFire: true, glass: true }))),
      openLobbyByKey,
      message(Message.ClickedLobbyDropBotButton({ index: 0 })),
      resolveFocusLobby(),
      model(current => {
        expect(current.modifiers).toEqual(only({ glass: true }))
      }),
    )
  })

  test('START plays what the tiles hold, in the run’s World', () => {
    story(
      update,
      given(
        withModifiers(readyAfterRead, only({ glass: true, bigCrowd: true })),
      ),
      openLobbyByKey,
      message(Message.ClickedLobbyStartButton()),
      model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.modifiers).toEqual(only({ glass: true, bigCrowd: true }))
        expect(focusOf(current).player.hp).toBe(1)
      }),
    )
  })

  test('the picks stay for a second run in the same launch', () => {
    const picked = withModifiers(home, only({ broke: true }))
    const first = startOrResume(picked, RunMode.Campaign())
    const again = startOrResume(
      modifyFields(first, { phase: () => Phase.GameOver({ wave: 2 }) }),
      RunMode.Campaign(),
    )
    expect(again.modifiers).toEqual(only({ broke: true }))
  })
})
