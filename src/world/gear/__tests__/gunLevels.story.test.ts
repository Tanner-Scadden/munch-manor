import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { NEUTRAL_INPUT } from '@munch/netcode'

import {
  Arsenal,
  type Bullet,
  type CarriedGun,
  GameEvent,
  Melee,
  type Model,
  Phase,
  type WeaponKind,
  type Zombie,
} from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  atOpenedCase,
  newPlayerReady,
  quietWave,
  withSeat,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  RESTART_GRACE_TICKS,
  bulletInto,
  doomed,
  holdEnter,
  holdFire,
  holdingSecond,
  maybeSpareGun,
  pistolOf,
  pistolOnly,
  press,
  tick,
  zombieAt,
} from '../../../test/testing'
import { TIER_LADDER } from '../../names'
import {
  DEFAULT_ROOM_SETTINGS,
  startRoomWorld,
  stepRoomWorld,
} from '../../net/roomWorld'
import { focusOf, maybePlayerAt, modifyFocus } from '../../party/party'
import { settledLessons } from '../../run/lessons'
import { maybeLevelProgress, tierForKills } from '../gunLevels'
import {
  STARTING_PISTOL,
  TIER_KILLS,
  WEAPONS,
  freshGun,
  magazineOf,
  maxTier,
  maybePanOf,
  statsAt,
  tierName,
  tierOf,
} from '../weapons'

// Guns level up with kills (src/world/gear/gunLevels.ts): each carried gun
// counts its own kills and climbs Beefy, DELUXE, and 3000 at 40, 120, and
// 250 of them, in single player and in a co-op room alike.

const FRAME_MS = FIXED_STEP_MS
const GRACE_TICK_MS = 50

const gun = (kind: WeaponKind, tier: number, kills: number): CarriedGun => ({
  ...freshGun(kind),
  loaded: magazineOf(kind, tier),
  tier,
  kills,
})

// NOTE: a shot from `weapon` about to land on a one-health zombie in front
// of the player, fired by `shooter` in a co-op room.
const shotWith = (
  weapon: WeaponKind,
  target: Zombie = doomed,
  shooter?: number,
): Bullet => ({
  ...bulletInto(500, target),
  weapon,
  ...(shooter === undefined ? {} : { shooter }),
})

const killShot = (arsenal: Arsenal, weapon: WeaponKind): Model =>
  modifyFocus(
    modifyFields(quietWave(3), {
      zombies: () => [doomed],
      bullets: () => [shotWith(weapon)],
    }),
    { player: player => modifyFields(player, { arsenal: () => arsenal }) },
  )

const smgOf = (current: Model): CarriedGun =>
  Option.getOrThrow(maybeSpareGun(focusOf(current).player.arsenal))

const leveledIn = (current: Model) =>
  Array.filter(current.frameEvents, GameEvent.isAnyOf(['GunLeveled']))

describe('the ladder', () => {
  test('Beefy at 40 kills, DELUXE at 120, 3000 at 250', () => {
    expect(TIER_KILLS).toEqual([40, 120, 250])
    expect(
      Array.map([0, 39, 40, 119, 120, 249, 250, 999], kills =>
        tierForKills('Smg', kills),
      ),
    ).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
    expect(tierForKills('Freeze', 999)).toBe(0)
  })

  test("the HUD's bar runs from the last tier's kills to the next", () => {
    expect(maybeLevelProgress(gun('Smg', 0, 20))).toEqual(Option.some(0.5))
    expect(maybeLevelProgress(gun('Smg', 1, 80))).toEqual(Option.some(0.5))
    expect(maybeLevelProgress(gun('Smg', 3, 300))).toEqual(Option.none())
    expect(maybeLevelProgress(gun('Freeze', 0, 50))).toEqual(Option.none())
  })

  test('every gun in the shop or a case has three tiers, each changing its stats', () => {
    const GUNS: ReadonlyArray<WeaponKind> = [
      'Pistol',
      'Shotgun',
      'Smg',
      'Rifle',
      'Blunderbuss',
    ]
    Array.forEach(GUNS, kind => {
      expect(maxTier(kind)).toBe(3)
      Array.forEach([0, 1, 2], tier => {
        expect(statsAt(kind, tier + 1)).not.toEqual(statsAt(kind, tier))
      })
    })
  })

  test('every Barn Buster tier reloads faster than the one before', () => {
    Array.forEach([1, 2, 3], tier => {
      expect(statsAt('Shotgun', tier).reloadMs).toBeLessThan(
        statsAt('Shotgun', tier - 1).reloadMs,
      )
    })
  })
})

describe('kills level a gun', () => {
  it.effect(
    'the 40th kill makes it Beefy, with a callout and a bigger magazine',
    () =>
      Story.story(
        APPLICATION,
        Story.given(killShot(holdingSecond(gun('Smg', 0, 39)), 'Smg')),
        tick(FRAME_MS),
        Story.model(current => {
          const smg = smgOf(current)
          expect([smg.tier, smg.kills]).toEqual([1, 40])
          expect(smg.loaded).toBe(magazineOf('Smg', 1))
          expect(
            Array.map(leveledIn(current), ({ weapon, tier }) => [weapon, tier]),
          ).toEqual([['Smg', 1]])
          expect(
            Array.map(current.levelCallouts, ({ weapon, tier }) => [
              weapon,
              tier,
            ]),
          ).toEqual([['Smg', 1]])
          expect(tierName('Smg', smg.tier)).toBe('Beefy Chatterbox')
        }),
      ),
  )

  it.effect(
    "the old manor's guns level the same way: a 40th kill makes them Beefy",
    () =>
      Effect.forEach(['Rifle', 'Blunderbuss'] as const, kind =>
        Story.story(
          APPLICATION,
          Story.given(killShot(holdingSecond(gun(kind, 0, 39)), kind)),
          tick(FRAME_MS),
          Story.model(current => {
            const leveled = smgOf(current)
            expect([leveled.kind, leveled.tier, leveled.kills]).toEqual([
              kind,
              1,
              40,
            ])
            expect(
              Array.map(leveledIn(current), ({ weapon, tier }) => [
                weapon,
                tier,
              ]),
            ).toEqual([[kind, 1]])
          }),
        ),
      ),
  )

  it.effect('a kill short of the next tier only counts', () =>
    Story.story(
      APPLICATION,
      Story.given(killShot(holdingSecond(gun('Smg', 1, 118)), 'Smg')),
      tick(FRAME_MS),
      Story.model(current => {
        expect([smgOf(current).tier, smgOf(current).kills]).toEqual([1, 119])
        expect(leveledIn(current)).toEqual([])
        expect(current.levelCallouts).toEqual([])
      }),
    ),
  )

  it.effect('the 250th kill makes it 3000, and it climbs no further', () =>
    Story.story(
      APPLICATION,
      Story.given(killShot(holdingSecond(gun('Smg', 2, 249)), 'Smg')),
      tick(FRAME_MS),
      Story.model(current => {
        expect(smgOf(current).tier).toBe(3)
        expect(smgOf(current).kills).toBe(250)
        expect(maybeLevelProgress(smgOf(current))).toEqual(Option.none())
      }),
    ),
  )

  it.effect('a kill levels the gun that made it, not the one beside it', () =>
    Story.story(
      APPLICATION,
      Story.given(
        killShot(
          Arsenal.HoldingFirst({
            first: { ...STARTING_PISTOL, kills: 39 },
            second: gun('Smg', 0, 10),
          }),
          'Pistol',
        ),
      ),
      tick(FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(pistolOf(player).tier).toBe(1)
        expect(pistolOf(player).kills).toBe(40)
        expect(tierOf(player, 'Smg')).toBe(0)
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ kills }) => kills),
        ).toEqual(Option.some(10))
      }),
    ),
  )
})

describe('a gun keeps its level while carried', () => {
  it.effect('a swapped-out gun keeps its kills and tier', () =>
    Story.story(
      APPLICATION,
      Story.given(killShot(holdingSecond(gun('Smg', 1, 50)), 'Pistol')),
      press('KeyQ'),
      tick(FRAME_MS),
      Story.model(current => {
        const { player } = focusOf(current)
        expect(pistolOf(player).kills).toBe(1)
        expect(smgOf(current)).toEqual(gun('Smg', 1, 50))
      }),
      press('KeyQ'),
      tick(FRAME_MS),
      Story.model(current => {
        expect(smgOf(current).tier).toBe(1)
        expect(smgOf(current).kills).toBe(50)
      }),
    ),
  )

  it.effect(
    'a gun from a case replaces the gun in hand, which takes its kills and level with it, and arrives fresh',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          atOpenedCase(
            modifyFocus(
              modifyFields(newPlayerReady, {
                lessons: () => settledLessons,
              }),
              {
                player: player =>
                  modifyFields(player, {
                    arsenal: () => holdingSecond(gun('Smg', 2, 130)),
                  }),
              },
            ),
            'Shotgun',
          ),
        ),
        ...holdEnter(HOLD_TICKS),
        Story.model(current => {
          expect(maybeSpareGun(focusOf(current).player.arsenal)).toEqual(
            Option.some(freshGun('Shotgun')),
          )
          expect(tierOf(focusOf(current).player, 'Smg')).toBe(0)
        }),
      ),
  )

  it.effect('a new run starts every gun at its base tier with no kills', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(newPlayerReady, {
            phase: () => Phase.GameOver({ wave: 5 }),
          }),
          {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  Arsenal.HoldingSecond({
                    first: { ...STARTING_PISTOL, tier: 3, kills: 260 },
                    second: gun('Smg', 2, 150),
                  }),
              }),
          },
        ),
      ),
      ...Array.makeBy(RESTART_GRACE_TICKS, () => tick(GRACE_TICK_MS)),
      press('Enter'),
      Story.model(({ phase, seats: [{ player }] }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    ),
  )

  it.effect('firing reads the stats of the held gun at its tier', () =>
    Effect.gen(function* () {
      const firing = (arsenal: Arsenal): Model =>
        modifyFocus(quietWave(3), {
          player: player => modifyFields(player, { arsenal: () => arsenal }),
        })
      yield* Story.story(
        APPLICATION,
        Story.given(firing(pistolOnly({ ...STARTING_PISTOL, tier: 3 }))),
        holdFire,
        tick(FRAME_MS),
        Story.model(({ bullets }) => {
          expect(
            Array.map(bullets, ({ damage, knockback }) => [damage, knockback]),
          ).toEqual([[2, statsAt('Pistol', 3).knockback]])
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(firing(holdingSecond(gun('Shotgun', 1, 40)))),
        holdFire,
        tick(FRAME_MS),
        Story.model(({ bullets }) => {
          expect(bullets.length).toBe(statsAt('Shotgun', 1).pellets)
          expect(bullets.length).toBeGreaterThan(statsAt('Shotgun', 0).pellets)
        }),
      )
    }),
  )
})

describe('a fridge weapon levels on its own kills', () => {
  it.effect("the Clang Pan's 40th kill makes it Beefy", () => {
    const ahead = zombieAt(300, doomed.x - 2, doomed.y, { hp: 1 })
    const swinging = modifyFocus(
      modifyFields(quietWave(4), { zombies: () => [ahead] }),
      {
        player: player =>
          modifyFields(player, {
            facing: () => ({ x: 1, y: 0 }),
            melee: () => Melee.Pan({ pan: gun('Pan', 0, 39) }),
            wield: () => 'Melee',
          }),
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(swinging),
      holdFire,
      tick(FRAME_MS),
      Story.model(current => {
        const pan = Option.getOrThrow(maybePanOf(focusOf(current).player))
        expect([pan.tier, pan.kills]).toEqual([1, 40])
        expect(Array.map(leveledIn(current), ({ weapon }) => weapon)).toEqual([
          'Pan',
        ])
        expect(pistolOf(focusOf(current).player).kills).toBe(0)
      }),
    )
  })
})

describe('kills in a co-op room', () => {
  test("a kill levels the killer's own gun, not a teammate's", () => {
    const WAVE = Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] })
    const target = zombieAt(400, 220, 45, { hp: 1 })
    const started = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const armed = (slot: number) => (world: typeof started.world) =>
      withSeat(world, slot, seatWorld =>
        modifyFocus(seatWorld, {
          player: player =>
            modifyFields(player, {
              arsenal: () => holdingSecond(gun('Smg', 0, 39)),
            }),
        }),
      )
    const room = modifyFields(started, {
      world: world =>
        modifyFields(armed(1)(armed(0)(world)), {
          phase: () => WAVE,
          zombies: () => [target],
          bullets: () => [shotWith('Smg', target, 1)],
        }),
    })
    const stepped = stepRoomWorld(
      room,
      Array.map([0, 1], slot => ({
        slot,
        input: NEUTRAL_INPUT,
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      })),
    )
    const smgAt = (slot: number) =>
      Option.getOrThrow(
        Option.flatMap(maybePlayerAt(stepped.world, slot), ({ player }) =>
          maybeSpareGun(player.arsenal),
        ),
      )
    expect([smgAt(1).tier, smgAt(1).kills]).toEqual([1, 40])
    expect([smgAt(0).tier, smgAt(0).kills]).toEqual([0, 39])
  })
})

describe('tier names', () => {
  const GUNS: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

  const namesOf = (kind: WeaponKind): ReadonlyArray<string> =>
    Array.makeBy(maxTier(kind) + 1, tier => tierName(kind, tier))

  test('every gun climbs the same ladder of tier words around its base name', () => {
    expect(Array.map(GUNS, namesOf)).toEqual([
      [
        'Pop Pistol',
        'Beefy Pop Pistol',
        'Pop Pistol DELUXE',
        'Pop Pistol 3000',
      ],
      [
        'Barn Buster',
        'Beefy Barn Buster',
        'Barn Buster DELUXE',
        'Barn Buster 3000',
      ],
      [
        'Chatterbox',
        'Beefy Chatterbox',
        'Chatterbox DELUXE',
        'Chatterbox 3000',
      ],
    ])
  })

  test('the ladder has a word for every tier of every gun', () => {
    Array.forEach(GUNS, kind => {
      expect(maxTier(kind)).toBeLessThan(TIER_LADDER.length)
      Array.forEach(namesOf(kind), (name, tier) =>
        expect(name).toBe(TIER_LADDER[tier]?.(WEAPONS[kind].name)),
      )
    })
  })
})
