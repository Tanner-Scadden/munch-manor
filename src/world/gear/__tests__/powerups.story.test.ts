import { Array, Effect, Option, Record } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Beat,
  type BoostKind,
  BoostTimer,
  type Boosts,
  DebutCard,
  GameEvent,
  HitStop,
  type Hold,
  type Loot,
  type Model,
  Phase,
  type Pickup,
  type PickupKind,
  Prize,
  Reload,
  ShopState,
  type Zombie,
  type ZombieKind,
  idleBoosts,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  isGoodieBeckoning,
  shownHints,
} from '../../../features/onboarding/onboarding'
import { pickupShapes } from '../../../render/powerupView'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  PISTOL_DAMAGE,
  PISTOL_MAGAZINE,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  PREPARATION_MS,
  ZOMBIE_KNOCKBACK_SPEED,
} from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  pickupAt,
  withPickups,
  withShopDialogOpen,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  SURFACE,
  bulletInto,
  holdFire,
  jsonOf,
  pistolOf,
  press,
  release,
  releaseFire,
  tagsOf,
  tick,
  ticks,
  ticksFor,
  withPistol,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { MANOR } from '../../level/arena'
import { focusOf, modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import {
  BOOSTS,
  BOOST_STACK_MAX,
  BURP_DAMAGE,
  BURP_RADIUS,
  DROP_RULES,
  PICKUP_BLINK_MS,
  PICKUP_LIFETIME_MS,
  TUTORIAL_DROP,
  TUTORIAL_DROP_KILL,
} from '../powerups'

// SETUP

const FRAME_MS = 50
// NOTE: a 50 ms frame is three 60 Hz ticks. A kill freezes the rest of its
// frame's ticks, so the tests that check one moment step a single tick.
const TICK_MS = FIXED_STEP_MS

const fightingWave = (wave: number): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    pacing: pacing =>
      modifyFields(pacing, { warnedPacks: () => [DISTANT_SPAWN.pack] }),
  })

const fighting = fightingWave(3)

const preparing: Model = modifyFields(fighting, {
  phase: () =>
    Phase.Preparation({
      wave: 3,
      remainingMs: 15_000,
      durationMs: PREPARATION_MS,
      spawns: [DISTANT_SPAWN],
    }),
})

const withLoot = (base: Model, loot: Partial<Loot>): Model =>
  modifyFields(base, {
    loot: current => ({
      ...current,
      rngState: loot.rngState ?? current.rngState,
      dryMs: loot.dryMs ?? current.dryMs,
      prize: loot.prize ?? current.prize,
    }),
  })

const victimsOf = (kind: ZombieKind, count: number): ReadonlyArray<Zombie> =>
  Array.makeBy(count, index =>
    zombieOf(kind, 100 + index, 30 + index * 22, 85, { hp: 1 }),
  )

const withKills = (base: Model, victims: ReadonlyArray<Zombie>): Model =>
  modifyFields(base, {
    zombies: () => victims,
    bullets: () =>
      Array.map(victims, victim =>
        bulletInto(victim.id + 500, victim, { knockback: 0 }),
      ),
  })

const underPlayer = (base: Model, kind: PickupKind): Model =>
  withPickups(base, [
    pickupAt(900, kind, focusOf(base).player.x, focusOf(base).player.y),
  ])

const withBoost = (base: Model, boost: BoostKind, remainingMs: number): Model =>
  modifyFocus(base, {
    boosts: boosts =>
      Record.map(boosts, (timer, kind) =>
        kind === boost
          ? BoostTimer.On({ remainingMs, durationMs: remainingMs })
          : timer,
      ),
  })

const remainingOf = (boosts: Boosts, kind: BoostKind): number =>
  BoostTimer.match(boosts[kind], {
    Off: () => 0,
    On: ({ remainingMs }) => remainingMs,
  })

type Drop = Readonly<{ kind: PickupKind; x: number; y: number }>

const dropsOf = (pickups: ReadonlyArray<Pickup>): ReadonlyArray<Drop> =>
  Array.map(pickups, ({ kind, x, y }) => ({ kind, x, y }))

// DROPS

describe('drops', () => {
  const tankRoom = (rngState: number): Model =>
    withLoot(withKills(fighting, victimsOf('Tank', 6)), {
      rngState,
      dryMs: DROP_RULES.gapMs,
    })

  const dropsFor = (rngState: number): Effect.Effect<ReadonlyArray<Drop>> =>
    Story.story(
      APPLICATION,
      Story.given(tankRoom(rngState)),
      tick(FRAME_MS),
    ).pipe(Effect.map(({ pickups }) => dropsOf(pickups)))

  it.effect(
    'the same seed drops the same pickups, and other seeds drop differently',
    () =>
      Effect.gen(function* () {
        const seeds = Array.makeBy(8, index => 1 + index * 7919)
        const first = yield* Effect.forEach(seeds, seed => dropsFor(seed))
        const second = yield* Effect.forEach(seeds, seed => dropsFor(seed))
        expect(second).toEqual(first)
        expect(Array.some(first, Array.isReadonlyArrayNonEmpty)).toBe(true)
        expect(
          Array.dedupeWith(first, (a, b) => jsonOf(a) === jsonOf(b)).length,
        ).toBeGreaterThan(1)
      }),
  )

  it.effect(
    'drops come from their own seeded stream and never touch the game seed',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withLoot(tankRoom(12345), { dryMs: DROP_RULES.pityMs })),
        tick(FRAME_MS),
        Story.model(({ loot, pickups }) => {
          expect(pickups).toHaveLength(1)
          expect(loot.rngState).not.toBe(12345)
          expect(loot.dryMs).toBe(0)
        }),
      ),
  )

  it.effect('random drops wait out the gap after the last drop', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withLoot(withKills(fighting, victimsOf('Tank', 6)), { dryMs: 0 }),
      ),
      tick(TICK_MS),
      Story.model(({ pickups, loot, frameEvents }) => {
        expect(
          Array.filter(frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toHaveLength(6)
        expect(pickups).toEqual([])
        expect(loot.dryMs).toBe(TICK_MS)
      }),
    ),
  )

  it.effect('the floor never holds more than the cap', () => {
    const full = Array.makeBy(DROP_RULES.floorMax, index =>
      pickupAt(800 + index, 'Speed', 60 + index * 20, 150),
    )
    return Story.story(
      APPLICATION,
      Story.given(
        withPickups(
          withLoot(withKills(fighting, victimsOf('Tank', 6)), {
            dryMs: DROP_RULES.pityMs,
            prize: Prize.Owed(),
          }),
          full,
        ),
      ),
      tick(TICK_MS),
      Story.model(({ pickups, loot }) => {
        expect(pickups).toHaveLength(DROP_RULES.floorMax)
        expect(loot.prize).toEqual(Prize.Owed())
        expect(loot.dryMs).toBe(DROP_RULES.pityMs + TICK_MS)
      }),
    )
  })

  it.effect(
    'a dry spell ends: once the pity time passes, the next kill drops for sure',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(withLoot(fighting, { dryMs: 0 })),
          ...ticks(10, FRAME_MS),
          Story.model(({ loot }) => {
            expect(loot.dryMs).toBeCloseTo(10 * FRAME_MS)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            withLoot(withKills(fighting, victimsOf('Shambler', 1)), {
              dryMs: DROP_RULES.pityMs,
            }),
          ),
          tick(FRAME_MS),
          Story.model(({ pickups, loot, frameEvents }) => {
            expect(pickups).toHaveLength(1)
            expect(tagsOf(frameEvents)).toContain('PickupDropped')
            expect(loot.dryMs).toBe(0)
          }),
        )
      }),
  )

  it.effect(
    'a peak owes a prize: the first kill after its fade begins rolls the prize odds',
    () =>
      Effect.gen(function* () {
        const hold: Hold = { atMs: 1000, releaseBelow: 4, relaxMs: 5000 }
        const crowd = Array.makeBy(5, index =>
          zombieOf('Tank', 300 + index, 40 + index * 20, 150, { hp: 30 }),
        )
        const target = zombieOf('Shambler', 400, 120, 85, { hp: 1 })
        const incoming = modifyFields(
          bulletInto(target.id + 500, target, { knockback: 0 }),
          {
            x: x => x - 18,
            velocityX: () => 240,
          },
        )
        const peakRoom = (rngState: number): Model =>
          modifyFields(withLoot(fighting, { dryMs: 0, rngState }), {
            phase: () =>
              Phase.Wave({ wave: 3, elapsedMs: 990, spawns: [DISTANT_SPAWN] }),
            pacing: pacing => modifyFields(pacing, { holds: () => [hold] }),
            zombies: () => [...crowd, target],
            bullets: () => [incoming],
          })
        const seeds = Array.makeBy(40, index => 11 + index * 7919)
        const dropped = yield* Effect.forEach(seeds, rngState =>
          Story.story(
            APPLICATION,
            Story.given(peakRoom(rngState)),
            tick(FRAME_MS),
            Story.model(({ pacing, loot, pickups }) => {
              expect(Beat.isAnyOf(['Fading'])(pacing.beat)).toBe(true)
              expect(loot.prize).toEqual(Prize.Owed())
              expect(pickups).toEqual([])
            }),
            tick(FRAME_MS),
            Story.model(({ loot, frameEvents }) => {
              expect(tagsOf(frameEvents)).toContain('ZombieKilled')
              expect(loot.prize).toEqual(Prize.Settled())
            }),
          ).pipe(Effect.map(({ pickups }) => pickups.length)),
        )
        const share = Array.reduce(dropped, 0, (sum, count) => sum + count) / 40
        expect(share).toBeGreaterThan(DROP_RULES.prizeChance - 0.2)
        expect(share).toBeLessThan(DROP_RULES.prizeChance + 0.2)
      }),
  )

  it.effect(
    'wave 1 drops one Hot Sauce on its third kill and nothing else',
    () => {
      const victims = victimsOf('Shambler', 5)
      return Story.story(
        APPLICATION,
        Story.given(
          withLoot(withKills(fightingWave(1), victims), {
            dryMs: DROP_RULES.pityMs,
            prize: Prize.Owed(),
          }),
        ),
        tick(FRAME_MS),
        Story.model(({ pickups }) => {
          expect(Array.map(pickups, ({ kind }) => kind)).toEqual([
            TUTORIAL_DROP,
          ])
          const third = Option.getOrThrow(
            Array.get(victims, TUTORIAL_DROP_KILL - 1),
          )
          expect(dropsOf(pickups)).toEqual([
            { kind: TUTORIAL_DROP, x: third.x, y: third.y },
          ])
        }),
      )
    },
  )

  it.effect(
    'a pickup lands inside the room, never in a wall or a doorway',
    () => {
      const atDoor = zombieOf('Tank', 100, MANOR.doors.North.center.x - 5, 4, {
        hp: 1,
      })
      return Story.story(
        APPLICATION,
        Story.given(
          withLoot(withKills(fighting, [atDoor]), { dryMs: DROP_RULES.pityMs }),
        ),
        tick(FRAME_MS),
        Story.model(({ pickups }) => {
          const pickup = Option.getOrThrow(Array.head(pickups))
          expect(pickup.y).toBeGreaterThanOrEqual(26)
          expect(pickup.x).toBeGreaterThan(10)
        }),
      )
    },
  )
})

// GRABBING

describe('grabbing', () => {
  it.effect('walking over a pickup grabs it and announces its name', () => {
    const { x, y } = focusOf(fighting).player
    return Story.story(
      APPLICATION,
      Story.given(
        withPickups(fighting, [pickupAt(900, 'RapidFire', x + 14, y)]),
      ),
      tick(FRAME_MS),
      Story.model(({ pickups }) => {
        expect(pickups).toHaveLength(1)
      }),
      press('KeyD'),
      ...ticks(3, FRAME_MS),
      Story.model(({ pickups, seats: [{ boosts }], callouts, lessons }) => {
        expect(pickups).toEqual([])
        expect(remainingOf(boosts, 'RapidFire')).toBeGreaterThan(0)
        expect(Array.map(callouts, ({ kind }) => kind)).toEqual(['RapidFire'])
        expect(lessons.pickup._tag).toBe('Learned')
      }),
    )
  })

  it.effect('a thumb on the move stick grabs a pickup the same way', () => {
    const { x, y } = focusOf(fighting).player
    return Story.story(
      APPLICATION,
      Story.given(withPickups(fighting, [pickupAt(900, 'Speed', x + 14, y)])),
      Story.message(
        Message.PressedPointer({
          pointerId: 7,
          device: 'Touch',
          clientX: 100,
          clientY: 300,
        }),
      ),
      Story.message(
        Message.MovedPointer({ pointerId: 7, clientX: 160, clientY: 300 }),
      ),
      ...ticks(4, FRAME_MS),
      Story.model(({ pickups, seats: [{ boosts }] }) => {
        expect(pickups).toEqual([])
        expect(remainingOf(boosts, 'Speed')).toBeGreaterThan(0)
      }),
    )
  })

  it.effect('a pickup out of reach stays on the floor', () => {
    const { x, y } = focusOf(fighting).player
    return Story.story(
      APPLICATION,
      Story.given(withPickups(fighting, [pickupAt(900, 'Damage', x + 20, y)])),
      ...ticks(5, FRAME_MS),
      Story.model(({ pickups, seats: [{ boosts }] }) => {
        expect(pickups).toHaveLength(1)
        expect(boosts).toEqual(idleBoosts)
      }),
    )
  })

  it.effect('the first pickup ever wears an arrow until one is grabbed', () => {
    const { x, y } = focusOf(fighting).player
    return Story.story(
      APPLICATION,
      Story.given(withPickups(fighting, [pickupAt(900, 'Damage', x + 14, y)])),
      tick(FRAME_MS),
      Story.model(current => {
        expect(shownHints(current)).toEqual([])
        expect(isGoodieBeckoning(current)).toBe(true)
      }),
      press('KeyD'),
      ...ticks(3, FRAME_MS),
      release('KeyD'),
      Story.model(current => {
        expect(isGoodieBeckoning(current)).toBe(false)
      }),
    )
  })
})

describe('explaining a power-up once', () => {
  const afterGrabbing = (base: Model, kind: PickupKind): Effect.Effect<Model> =>
    Story.story(
      APPLICATION,
      Story.given(underPlayer(base, kind)),
      tick(FRAME_MS),
    )

  const looksOf = (current: Model) =>
    Array.map(current.callouts, ({ kind, look }) => ({ kind, look }))

  it.effect(
    'the first grab explains a kind, the next only names it, and a new kind is explained',
    () =>
      Effect.gen(function* () {
        const first = yield* afterGrabbing(fighting, 'RapidFire')
        expect(looksOf(first)).toEqual([
          { kind: 'RapidFire', look: 'Explained' },
        ])
        expect(first.seenPowerUps).toEqual(['RapidFire'])

        const again = yield* afterGrabbing(first, 'RapidFire')
        expect(looksOf(again)).toEqual([{ kind: 'RapidFire', look: 'Named' }])
        expect(again.seenPowerUps).toBe(first.seenPowerUps)
        expect(remainingOf(focusOf(again).boosts, 'RapidFire')).toBeGreaterThan(
          remainingOf(focusOf(first).boosts, 'RapidFire'),
        )

        const other = yield* afterGrabbing(again, 'Burp')
        expect(looksOf(other)).toEqual([{ kind: 'Burp', look: 'Explained' }])
        expect(other.seenPowerUps).toEqual(['RapidFire', 'Burp'])
      }),
  )

  it.effect('a name pop goes sooner than an explanation', () =>
    Effect.gen(function* () {
      const grabbed = yield* afterGrabbing(fighting, 'Speed')
      const named = modifyFields(grabbed, {
        callouts: callouts =>
          Array.map(callouts, callout => ({
            ...callout,
            look: 'Named' as const,
          })),
      })
      const explained = yield* afterGrabbing(fighting, 'Speed')
      yield* Story.story(
        APPLICATION,
        Story.given(named),
        ...ticksFor(1100, FRAME_MS),
        Story.model(({ callouts }) => {
          expect(callouts).toEqual([])
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(explained),
        ...ticksFor(1100, FRAME_MS),
        Story.model(({ callouts }) => {
          expect(Array.map(callouts, ({ look }) => look)).toEqual(['Explained'])
        }),
      )
    }),
  )

  it.effect('a new run keeps the kinds seen', () =>
    Effect.gen(function* () {
      const grabbed = yield* afterGrabbing(fighting, 'Pierce')
      const seen = modifyFields(grabbed, {
        phase: () => Phase.GameOver({ wave: 3 }),
        screenMs: () => 5000,
      })
      return yield* Story.story(
        APPLICATION,
        Story.given(seen),
        press('Enter'),
        Story.model(({ seenPowerUps, callouts }) => {
          expect(seenPowerUps).toEqual(['Pierce'])
          expect(callouts).toEqual([])
        }),
      )
    }),
  )
})

// EFFECTS

describe('effects', () => {
  it.effect(
    'Hot Sauce tops off the magazine, fires faster, spends no rounds, and never reloads',
    () => {
      const loaded = modifyFocus(fighting, {
        player: player =>
          withPistol(player, pistol => ({ ...pistol, loaded: 2 })),
      })
      return Story.story(
        APPLICATION,
        Story.given(withBoost(loaded, 'RapidFire', 5000)),
        holdFire,
        ...ticksFor(2000, FRAME_MS),
        Story.model(({ stats, seats: [{ player }] }) => {
          const plainShots = 2000 / FIRE_INTERVAL_MS
          expect(stats.shotsFired).toBeGreaterThan(plainShots * 1.6)
          expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
          expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        }),
      )
    },
  )

  it.effect('grabbing Hot Sauce mid-reload fills the magazine at once', () => {
    const reloading = modifyFocus(fighting, {
      player: player =>
        modifyFields(
          withPistol(player, pistol => ({ ...pistol, loaded: 0 })),
          {
            reload: () =>
              Reload.Reloading({ remainingMs: 700, durationMs: 800 }),
          },
        ),
    })
    return Story.story(
      APPLICATION,
      Story.given(underPlayer(reloading, 'RapidFire')),
      tick(FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        expect(pistolOf(player).loaded).toBeGreaterThan(0)
      }),
    )
  })

  it.effect(
    'Mean Beans doubles the damage and adds knockback to every shot',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withBoost(fighting, 'Damage', 5000)),
        holdFire,
        tick(FRAME_MS),
        Story.model(({ bullets }) => {
          const bullet = Option.getOrThrow(Array.head(bullets))
          expect(bullet.damage).toBe(PISTOL_DAMAGE * 2)
          expect(bullet.knockback).toBe(ZOMBIE_KNOCKBACK_SPEED * 1.5)
          expect(bullet.glaze).toBe('Mean')
        }),
      ),
  )

  it.effect('Zoomy Socks make the player run faster', () => {
    // NOTE: a step up from the start spot, onto the open floor below the
    // table, so the run east meets no candelabra.
    const onOpenFloor = modifyFocus(withBoost(fighting, 'Speed', 5000), {
      player: player => modifyFields(player, { y: () => 130 }),
    })
    const startX = focusOf(onOpenFloor).player.x
    return Story.story(
      APPLICATION,
      Story.given(onOpenFloor),
      press('KeyD'),
      ...ticksFor(1000, FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.x - startX).toBeCloseTo(
          PLAYER_SPEED * BOOSTS.Speed.speedScale,
          5,
        )
      }),
    )
  })

  const skewerLine = (base: Model): Model =>
    modifyFields(base, {
      zombies: () =>
        Array.makeBy(5, index =>
          zombieOf(
            'Shambler',
            200 + index,
            focusOf(base).player.x + 20 + index * 10,
            focusOf(base).player.y,
            { hp: 1 },
          ),
        ),
    })

  it.effect('Shish Kebullets send one shot through four zombies', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(withBoost(skewerLine(fighting), 'Pierce', 5000)),
        holdFire,
        tick(FRAME_MS),
        releaseFire,
        ...ticks(30, FRAME_MS),
        Story.model(({ zombies, stats }) => {
          expect(stats.shotsFired).toBe(1)
          expect(stats.kills.Shambler).toBe(1 + BOOSTS.Pierce.pierce)
          expect(Array.filter(zombies, ({ hp }) => hp > 0)).toHaveLength(1)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(skewerLine(fighting)),
        holdFire,
        tick(FRAME_MS),
        releaseFire,
        ...ticks(30, FRAME_MS),
        Story.model(({ zombies, stats }) => {
          expect(stats.shotsFired).toBe(1)
          expect(stats.kills.Shambler).toBe(1)
          expect(Array.filter(zombies, ({ hp }) => hp > 0)).toHaveLength(4)
        }),
      )
    }),
  )

  it.effect(
    'a Big Burp blasts every zombie in reach and pays for the kills',
    () => {
      const { x, y } = focusOf(fighting).player
      const near = zombieOf('Shambler', 300, x + 50, y, { hp: BURP_DAMAGE })
      const far = zombieOf('Shambler', 301, x - BURP_RADIUS - 20, y, { hp: 3 })
      return Story.story(
        APPLICATION,
        Story.given(
          modifyFields(underPlayer(fighting, 'Burp'), {
            zombies: () => [near, far],
          }),
        ),
        tick(FRAME_MS),
        Story.model(({ zombies, seats: [{ wallet, boosts }], frameEvents }) => {
          const byId = (id: number) =>
            Option.getOrThrow(
              Array.findFirst(zombies, zombie => zombie.id === id),
            )
          expect(byId(near.id).hp).toBe(0)
          expect(byId(far.id).hp).toBe(far.hp)
          expect(wallet.earned).toBe(ZOMBIE_KINDS.Shambler.bounty)
          expect(tagsOf(frameEvents)).toEqual(
            expect.arrayContaining(['PickupGrabbed', 'Burped', 'ZombieKilled']),
          )
          expect(boosts).toEqual(idleBoosts)
        }),
      )
    },
  )

  it.effect('a Pickled Heart heals one heart, never past the maximum', () =>
    Effect.gen(function* () {
      const hurt = modifyFocus(fighting, {
        player: player => modifyFields(player, { hp: () => 2 }),
      })
      yield* Story.story(
        APPLICATION,
        Story.given(underPlayer(hurt, 'Heart')),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.hp).toBe(3)
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(underPlayer(fighting, 'Heart')),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }], pickups }) => {
          expect(player.hp).toBe(PLAYER_MAX_HP)
          expect(pickups).toEqual([])
        }),
      )
    }),
  )
})

// TIMERS

describe('timers', () => {
  it.effect('a boost counts down and runs out after its duration', () => {
    const durationMs = BOOSTS.Damage.durationMs
    return Story.story(
      APPLICATION,
      Story.given(underPlayer(fighting, 'Damage')),
      tick(TICK_MS),
      Story.model(({ seats: [{ boosts }] }) => {
        expect(remainingOf(boosts, 'Damage')).toBe(durationMs)
      }),
      ...ticksFor(durationMs - FRAME_MS, FRAME_MS),
      Story.model(({ seats: [{ boosts }] }) => {
        expect(remainingOf(boosts, 'Damage')).toBeCloseTo(FRAME_MS)
      }),
      tick(FRAME_MS),
      Story.model(({ seats: [{ boosts }], frameEvents }) => {
        expect(boosts.Damage).toEqual(BoostTimer.Off())
        expect(tagsOf(frameEvents)).toContain('BoostFaded')
      }),
      holdFire,
      tick(FRAME_MS),
      Story.model(({ bullets }) => {
        const bullet = Option.getOrThrow(Array.last(bullets))
        expect(bullet.damage).toBe(PISTOL_DAMAGE)
        expect(bullet.glaze).toBe('Plain')
      }),
    )
  })

  const timersOf = (current: Model) => ({
    remainingMs: remainingOf(focusOf(current).boosts, 'RapidFire'),
    pickupAges: Array.map(current.pickups, ({ ageMs }) => ageMs),
    calloutAges: Array.map(current.callouts, ({ ageMs }) => ageMs),
  })

  const frozenRoom = (base: Model): Model =>
    modifyFields(
      withPickups(withBoost(base, 'RapidFire', 4000), [
        pickupAt(901, 'Damage', 40, 150, 2000),
      ]),
      {
        callouts: () => [
          { kind: 'RapidFire', look: 'Explained', x: 100, y: 100, ageMs: 300 },
        ],
      },
    )

  const expectStaysFrozen = (base: Model) => {
    const before = timersOf(frozenRoom(base))
    return Story.story(
      APPLICATION,
      Story.given(frozenRoom(base)),
      ...ticks(10, FRAME_MS),
      Story.model(current => {
        expect(timersOf(current)).toEqual(before)
      }),
    )
  }

  it.effect('boosts, pickups, and callouts stand still while paused', () =>
    expectStaysFrozen(
      modifyFields(fighting, {
        phase: () =>
          Phase.Paused({
            round: Phase.Wave({
              wave: 3,
              elapsedMs: 0,
              spawns: [DISTANT_SPAWN],
            }),
          }),
      }),
    ),
  )

  it.effect(
    'boosts, pickups, and callouts stand still while the shop is open',
    () =>
      expectStaysFrozen(
        modifyFocus(withShopDialogOpen(preparing), {
          shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
        }),
      ),
  )

  it.effect('boosts, pickups, and callouts stand still during hit-stop', () =>
    expectStaysFrozen(
      modifyFields(fighting, {
        hitStop: () => HitStop.Frozen({ remainingMs: 10 * FRAME_MS + 1 }),
      }),
    ),
  )

  it.effect(
    'boosts, pickups, and callouts stand still under the new zombie card',
    () =>
      expectStaysFrozen(
        modifyFields(fighting, {
          debutCard: () => DebutCard.Showing({ kind: 'Tank', ageMs: 0 }),
        }),
      ),
  )

  it.effect(
    'a boost holds its time through the break and runs again in the wave',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(withBoost(preparing, 'Speed', 4000)),
          ...ticks(10, FRAME_MS),
          Story.model(({ seats: [{ boosts }] }) => {
            expect(remainingOf(boosts, 'Speed')).toBe(4000)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(withBoost(fighting, 'Speed', 4000)),
          ...ticks(10, FRAME_MS),
          Story.model(({ seats: [{ boosts }] }) => {
            expect(remainingOf(boosts, 'Speed')).toBeCloseTo(
              4000 - 10 * FRAME_MS,
            )
          }),
        )
      }),
  )

  it.effect(
    'the same kind again adds its duration, up to one and a half times',
    () =>
      Effect.gen(function* () {
        const durationMs = BOOSTS.RapidFire.durationMs
        const elapsedMs = 2000
        const secondGrab = (current: Model): Model =>
          underPlayer(current, 'RapidFire')
        yield* Story.story(
          APPLICATION,
          Story.given(
            secondGrab(
              withBoost(fighting, 'RapidFire', durationMs - elapsedMs),
            ),
          ),
          tick(TICK_MS),
          Story.model(({ seats: [{ boosts }] }) => {
            expect(remainingOf(boosts, 'RapidFire')).toBe(
              durationMs * BOOST_STACK_MAX,
            )
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(secondGrab(withBoost(fighting, 'RapidFire', 1000))),
          tick(TICK_MS),
          Story.model(({ seats: [{ boosts }] }) => {
            expect(remainingOf(boosts, 'RapidFire')).toBeCloseTo(
              1000 - TICK_MS + durationMs,
            )
          }),
        )
      }),
  )

  it.effect('different kinds run side by side on their own timers', () =>
    Story.story(
      APPLICATION,
      Story.given(underPlayer(withBoost(fighting, 'Speed', 3000), 'Damage')),
      tick(TICK_MS),
      Story.model(({ seats: [{ boosts }] }) => {
        expect(remainingOf(boosts, 'Speed')).toBeCloseTo(3000 - TICK_MS)
        expect(remainingOf(boosts, 'Damage')).toBe(BOOSTS.Damage.durationMs)
      }),
    ),
  )
})

// FLOOR

describe('the floor', () => {
  const isDimmed = (pickup: Pickup): boolean =>
    Array.some(
      pickupShapes(pickup),
      shape => shape._tag === 'Group' && shape.opacity !== undefined,
    )

  const isDimmedAt = (ageMs: number): boolean =>
    isDimmed(pickupAt(900, 'Pierce', 40, 150, ageMs))

  it.effect(
    'an ungrabbed pickup blinks for its last seconds, then fizzles',
    () => {
      const blinkStartMs = PICKUP_LIFETIME_MS - PICKUP_BLINK_MS
      const steadyAges = Array.makeBy(blinkStartMs / 10, step => step * 10)
      const blinkingAges = Array.makeBy(
        PICKUP_BLINK_MS / 10,
        step => blinkStartMs + step * 10,
      )
      expect(Array.some(steadyAges, isDimmedAt)).toBe(false)
      expect(Array.some(blinkingAges, isDimmedAt)).toBe(true)
      expect(Array.every(blinkingAges, isDimmedAt)).toBe(false)
      return Story.story(
        APPLICATION,
        Story.given(withPickups(fighting, [pickupAt(900, 'Pierce', 40, 150)])),
        ...ticksFor(PICKUP_LIFETIME_MS - FRAME_MS, FRAME_MS),
        Story.model(({ pickups }) => {
          expect(pickups).toHaveLength(1)
          expect(pickups[0]?.ageMs).toBeCloseTo(PICKUP_LIFETIME_MS - FRAME_MS)
        }),
        // NOTE: summed 60 Hz ticks land a hair short of the lifetime, so it
        // fizzles within one tick of it.
        tick(FRAME_MS),
        tick(TICK_MS),
        Story.model(({ pickups, frameEvents }) => {
          expect(pickups).toEqual([])
          expect(tagsOf(frameEvents)).toContain('PickupFizzled')
        }),
      )
    },
  )

  it.effect('a new run clears the floor, the boosts, and the callouts', () => {
    const over = modifyFields(
      withBoost(
        withPickups(fighting, [pickupAt(900, 'Pierce', 40, 150)]),
        'Damage',
        3000,
      ),
      {
        phase: () => Phase.GameOver({ wave: 3 }),
        screenMs: () => 5000,
        callouts: () => [
          { kind: 'Damage', look: 'Explained', x: 10, y: 10, ageMs: 0 },
        ],
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(over),
      press('Enter'),
      Story.model(({ pickups, seats: [{ boosts }], callouts, loot }) => {
        expect(pickups).toEqual([])
        expect(boosts).toEqual(idleBoosts)
        expect(callouts).toEqual([])
        expect(loot.dryMs).toBe(0)
      }),
    )
  })
})
