import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { LobbyBinding } from '../../../app/bindings'
import {
  type Bullet,
  Life,
  type Model,
  Phase,
  Pierce,
  RunMode,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { startOrResume } from '../../../app/runFlow'
import { addBot } from '../../../domain/bots'
import { effectiveModifiersOf } from '../../../domain/onlineRun'
import { Message as LobbyMessage } from '../../../features/lobby/message'
import { FIXED_STEP_MS, PLAYER_MAX_HP } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atFridge,
  crewInWave,
  home,
  pipeline,
  placeSeat,
  readyAfterRead,
  withSeatLife,
} from '../../../test/model.fixture'
import { playRoom } from '../../../test/roomTesting'
import {
  APPLICATION,
  HOLD_TICKS,
  bulletInto,
  openLobbyByKey,
  press,
  release,
  resolveFocusLobby,
  throughIntro,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { advanceLobs } from '../../fridge/fridgeWeapons'
import { FRIDGE_RULES, pullFridge } from '../../fridge/leftovers'
import { DROP_RULES } from '../../gear/powerups'
import { roomSettingsOf, startRoomWorld } from '../../net/roomWorld'
import {
  COOP_RULES,
  focusOf,
  focusSlotOf,
  isFriendlyFireOn,
  maybePlayerAt,
  playersOf,
} from '../../party/party'
import type { World } from '../../schema/world'
import { type Lob, type PlannedSpawn } from '../../schema/worldSchema'
import { offersOf } from '../../shop/purchase'
import { beginPreparation } from '../../waves/waves'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import { endArrival } from '../arrival'
import {
  MODIFIER_ORDER,
  type Modifiers,
  bonusPercentOf,
  brokeKeyScaleOf,
  isModifierOn,
  maskOfModifiers,
  modifiersOfMask,
  modifiersOn,
  noModifiers,
  toggledModifier,
} from '../modifiers'

// Run modifiers (src/world/run/modifiers.ts): the four opt-in rules, each played
// through the World the single player update and the co-op room both run,
// and the bonus they add to the pay.

const FRAME_MS = 50
const TICK_MS = FIXED_STEP_MS
// NOTE: the open floor between the dining room's table and the start spot,
// which runs the whole width of the room.
const ROW_Y = 130

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

  test('Broke halves the key odds', () => {
    expect(brokeKeyScaleOf(only({ broke: true }))).toBe(0.5)
    expect(brokeKeyScaleOf(noModifiers)).toBe(1)
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

  it.effect(
    'on, a teammate’s shot wounds the player it reaches and stops there',
    () =>
      Story.story(
        APPLICATION,
        Story.given(inTheLine(only({ friendlyFire: true }))),
        ...ticks(2, TICK_MS),
        Story.model(current => {
          expect(hpOf(current, 1)).toBe(PLAYER_MAX_HP - 1)
          expect(hpOf(current, 0)).toBe(PLAYER_MAX_HP)
          expect(current.bullets).toEqual([])
        }),
      ),
  )

  it.effect('off, the same shot passes through', () =>
    Story.story(
      APPLICATION,
      Story.given(inTheLine(noModifiers)),
      ...ticks(2, TICK_MS),
      Story.model(current => {
        expect(hpOf(current, 1)).toBe(PLAYER_MAX_HP)
      }),
    ),
  )

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

  it.effect(
    'with nobody to hit it does nothing: one seat never shoots itself',
    () => {
      const solo = pipeline(placeSeat(0, 150, ROW_Y), current =>
        modifyFields(current, { bullets: () => [bulletFrom(0, 140)] }),
      )(withModifiers(crewInWave(1), only({ friendlyFire: true })))
      return Story.story(
        APPLICATION,
        Story.given(solo),
        ...ticks(2, TICK_MS),
        Story.model(current => {
          expect(focusOf(current).player.hp).toBe(PLAYER_MAX_HP)
        }),
      )
    },
  )

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

  const bigLugDown = (modifiers: Modifiers): Model => {
    const victim: Zombie = zombieOf('Tank', 100, 60, 85, { hp: 1 })
    return withModifiers(
      modifyFields(fighting, {
        zombies: () => [victim],
        bullets: () => [bulletInto(500, victim, { knockback: 0 })],
      }),
      modifiers,
    )
  }

  const paidFor = (modifiers: Modifiers) =>
    Story.story(
      APPLICATION,
      Story.given(bigLugDown(modifiers)),
      tick(FRAME_MS),
    ).pipe(Effect.map(current => current.keys.held))

  it.effect('a Big Lug drops half its keys', () =>
    Effect.gen(function* () {
      const full = yield* paidFor(noModifiers)
      const broke = yield* paidFor(only({ broke: true }))
      expect(full).toBe(ZOMBIE_KINDS.Tank.keys)
      expect(broke).toBe(ZOMBIE_KINDS.Tank.keys / 2)
    }),
  )

  const isFridgeOffered = (current: Model): boolean =>
    Array.some(
      offersOf(current, focusSlotOf(current)),
      ({ target }) => target._tag === 'Fridge',
    )

  it.effect(
    'the fridge is not for sale, and holding at it pulls nothing',
    () => {
      expect(isFridgeOffered(atFridge(100))).toBe(true)
      const broke = withModifiers(atFridge(100), only({ broke: true }))
      expect(isFridgeOffered(broke)).toBe(false)
      return Story.story(
        APPLICATION,
        Story.given(broke),
        press('Enter'),
        ...ticks(HOLD_TICKS, FRAME_MS),
        release('Enter'),
        throughIntro,
        Story.model(current => {
          expect(current.keys.held).toBe(100)
          expect(current.fridge.pulls).toBe(0)
          expect(FRIDGE_RULES.keys).toBeGreaterThan(0)
        }),
      )
    },
  )
})

describe('Glass', () => {
  const glass = only({ glass: true })

  test('a run starts on one heart, whatever the hero’s hearts', () => {
    const started = startOrResume(
      withModifiers(readyAfterRead, glass),
      RunMode.Campaign(),
    )
    expect(Phase.guards.Arriving(started.phase)).toBe(true)
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

  const dropsFor = (modifiers: Modifiers, rngState: number) => {
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
    return Story.story(APPLICATION, Story.given(hurt), tick(FRAME_MS)).pipe(
      Effect.map(({ pickups }) => Array.map(pickups, ({ kind }) => kind)),
    )
  }

  // NOTE: the first seed among these that drops a heart with no Glass,
  // so the sweep with Glass is known to have had the chance. One Story a
  // seed, stopping at the first heart.
  const firstHeartSeed = (
    seeds: ReadonlyArray<number>,
  ): Effect.Effect<Option.Option<number>> =>
    Array.match(seeds, {
      onEmpty: () => Effect.succeedNone,
      onNonEmpty: ([seed, ...rest]) =>
        Effect.flatMap(dropsFor(noModifiers, seed), drops =>
          Array.contains(drops, 'Heart')
            ? Effect.succeedSome(seed)
            : firstHeartSeed(rest),
        ),
    })

  it.effect(
    'no heart drops, where a hurt player would otherwise find some',
    () =>
      Effect.gen(function* () {
        const seeds = Array.makeBy(80, index => 11 + index * 7919)
        const withGlass = yield* Effect.forEach(seeds, seed =>
          dropsFor(glass, seed),
        ).pipe(Effect.map(Array.flatten))
        const maybeHeartSeed = yield* firstHeartSeed(seeds)
        expect(Option.isSome(maybeHeartSeed)).toBe(true)
        expect(withGlass.length).toBeGreaterThan(0)
        expect(withGlass).not.toContain('Heart')
      }),
  )

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
          pullFridge(facing, focusSlotOf(facing), FRIDGE_RULES.keys),
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

  it.effect('a revived teammate gets up on one heart', () => {
    const reviveTicks = Math.ceil(COOP_RULES.reviveMs / TICK_MS)
    return Story.story(
      APPLICATION,
      Story.given(
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
      Story.model(current => {
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

  it.effect('the fallen come back at the break on one heart', () =>
    Story.story(
      APPLICATION,
      Story.given(
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
      Story.model(current => {
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
    ),
  )
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
      const { phase } = endArrival(
        startRoomWorld([0, 1], 7, settingsWith(modifiers)).world,
      )
      return phase._tag === 'Preparation' ? phase.spawns.length : 0
    }
    expect(spawnsIn(only({ bigCrowd: true }))).toBeGreaterThan(
      spawnsIn(noModifiers),
    )
  })
})

describe('the solo lobby', () => {
  const crewed = addBot(readyAfterRead)

  it.effect('a tile turns a modifier on and off where it sits', () =>
    Story.story(
      APPLICATION,
      Story.given(readyAfterRead),
      openLobbyByKey,
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedModifierButton({ modifier: 'Glass' }),
      ),
      Story.model(current => {
        expect(current.modifiers).toEqual(only({ glass: true }))
      }),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedModifierButton({ modifier: 'Broke' }),
      ),
      Story.model(current => {
        expect(current.modifiers).toEqual(only({ glass: true, broke: true }))
      }),
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedModifierButton({ modifier: 'Glass' }),
      ),
      Story.model(current => {
        expect(current.modifiers).toEqual(only({ broke: true }))
      }),
    ),
  )

  it.effect('Friendly Fire is dim until a bot sits in the crew', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(readyAfterRead),
        openLobbyByKey,
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedModifierButton({ modifier: 'FriendlyFire' }),
        ),
        Story.model(current => {
          expect(current.modifiers).toEqual(noModifiers)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(crewed),
        openLobbyByKey,
        Story.messageIn(
          LobbyBinding,
          LobbyMessage.ClickedModifierButton({ modifier: 'FriendlyFire' }),
        ),
        Story.model(current => {
          expect(current.modifiers).toEqual(only({ friendlyFire: true }))
        }),
      )
    }),
  )

  it.effect('sending the last bot home turns Friendly Fire off with it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withModifiers(crewed, only({ friendlyFire: true, glass: true })),
      ),
      openLobbyByKey,
      Story.messageIn(
        LobbyBinding,
        LobbyMessage.ClickedDropBotButton({ index: 0 }),
      ),
      resolveFocusLobby(),
      Story.model(current => {
        expect(current.modifiers).toEqual(only({ glass: true }))
      }),
    ),
  )

  it.effect('START plays what the tiles hold, in the run’s World', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withModifiers(readyAfterRead, only({ glass: true, bigCrowd: true })),
      ),
      openLobbyByKey,
      Story.messageIn(LobbyBinding, LobbyMessage.ClickedStartButton()),
      throughIntro,
      Story.model(current => {
        expect(Phase.guards.Preparation(current.phase)).toBe(true)
        expect(current.modifiers).toEqual(only({ glass: true, bigCrowd: true }))
        expect(focusOf(current).player.hp).toBe(1)
      }),
    ),
  )

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
