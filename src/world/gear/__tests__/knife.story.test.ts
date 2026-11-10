import { Array, Effect, Function, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { NEUTRAL_INPUT, type PlayerInput } from '@munch/netcode'

import { Message } from '../../../app/message'
import {
  type CarriedGun,
  GameEvent,
  type Model,
  Phase,
  ShopState,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { Message as ShopMessage } from '../../../features/shop/message'
import { FocusItem } from '../../../features/shop/steps'
import { FIXED_STEP_MS, PISTOL_MAGAZINE } from '../../../shared/constants'
import { DISTANT_SPAWN, withSeat } from '../../../test/model.fixture'
import {
  APPLICATION,
  FIRE_LIFT,
  FIRE_PRESS,
  FIRE_PUSH,
  SURFACE,
  buyAtCounter,
  holdFire,
  holdingFirst,
  holdingSecond,
  pistolOnly,
  playedThrough,
  press,
  release,
  settleRunCommands,
  tick,
  tickCountFor,
  zombieById,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  startRoomWorld,
  stepRoomWorld,
} from '../../net/roomWorld'
import {
  focusOf,
  focusSlotOf,
  maybePlayerAt,
  modifyFocus,
} from '../../party/party'
import { Arsenal, type Player, Reload } from '../../schema/worldSchema'
import { SHOP_ITEMS, verdictFor } from '../../shop/shop'
import { SeatAction } from '../../step/stepWorld'
import { KNIFE_RULES } from '../knife'
import {
  STARTING_PISTOL,
  freshGun,
  gunsOf,
  heldGun,
  heldWeapon,
  inHandOf,
  magazineOf,
} from '../weapons'

// The knife (src/world/gear/knife.ts) and the two gun slots (src/world/gear/weapons.ts), played
// through Block-aware Stories the way a player plays them: F or a tap on the knife's
// slot to draw it, fire to stab, Q or a gun's slot to go back, and the
// shop's GUNS tab trading one gun for another.

const FRAME_MS = FIXED_STEP_MS
const ROW_Y = 104
const PLAYER_X = 100

const fightingWith = (zombies: ReadonlyArray<Zombie>): Model =>
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
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
        }),
    },
  )

// NOTE: the Model each of `count` frames leaves, played through a
// Block-aware Story from `start`, gathered in an array only the Story
// fills, as `recordTicks` does.
const frames = (
  start: Model,
  count: number,
): Effect.Effect<ReadonlyArray<Model>> =>
  Effect.suspend(() => {
    const seen: Array<Model> = []
    return Story.story(
      APPLICATION,
      Story.given(start),
      ...Array.flatMap(Array.makeBy(count, Function.constVoid), () => [
        tick(FRAME_MS),
        Story.model((current: Model) => {
          seen.push(current)
        }),
      ]),
      settleRunCommands,
    ).pipe(Effect.as<ReadonlyArray<Model>>(seen))
  })

const lastOf = (seen: ReadonlyArray<Model>): Model =>
  Option.getOrThrow(Array.last(seen))

const stabsIn = (seen: ReadonlyArray<Model>): number =>
  Array.reduce(
    seen,
    0,
    (count, current) =>
      count +
      Array.filter(current.frameEvents, GameEvent.isAnyOf(['KnifeStabbed']))
        .length,
  )

const tough = (id: number, x: number, y = ROW_Y): Zombie =>
  zombieOf('Shambler', id, x, y, { hp: 99 })

const send = (
  start: Model,
  ...messages: ReadonlyArray<Message>
): Effect.Effect<Model> => playedThrough(start, messages)

const knifed = (zombies: ReadonlyArray<Zombie>): Effect.Effect<Model> =>
  send(fightingWith(zombies), Message.PressedKey({ code: 'KeyF' }))

describe('the knife', () => {
  it.effect(
    'F puts the knife in hand, and a reload carries on while it is out',
    () =>
      Effect.gen(function* () {
        const reloading = modifyFocus(fightingWith([]), {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
              reload: () =>
                Reload.Reloading({ remainingMs: 600, durationMs: 800 }),
            }),
        })
        const drawn = yield* send(
          reloading,
          Message.PressedKey({ code: 'KeyF' }),
        )
        expect(focusOf(drawn).player.wield).toBe('Melee')
        expect(inHandOf(focusOf(drawn).player)).toBe('Knife')
        expect(focusOf(drawn).player.reload._tag).toBe('Reloading')
        const seen = yield* frames(drawn, tickCountFor(600) + 1)
        const reloaded = lastOf(seen)
        expect(focusOf(reloaded).player.reload._tag).toBe('Ready')
        expect(heldGun(focusOf(reloaded).player.arsenal).loaded).toBe(
          PISTOL_MAGAZINE,
        )
        expect(focusOf(reloaded).player.wield).toBe('Melee')
      }),
  )

  it.effect(
    'changing guns from the knife stops the reload of the last gun',
    () =>
      Effect.gen(function* () {
        const reloading = modifyFocus(fightingWith([]), {
          player: player =>
            modifyFields(player, {
              arsenal: () => holdingSecond(freshGun('Smg')),
              reload: () =>
                Reload.Reloading({ remainingMs: 600, durationMs: 800 }),
              wield: () => 'Melee',
            }),
        })
        const toPistol = yield* send(
          reloading,
          Message.ClickedGunSlot({ slot: 'First' }),
        )
        expect(heldWeapon(focusOf(toPistol).player.arsenal)).toBe('Pistol')
        expect(focusOf(toPistol).player.reload._tag).toBe('Ready')
        const back = yield* send(
          reloading,
          Message.ClickedGunSlot({ slot: 'Second' }),
        )
        expect(focusOf(back).player.reload._tag).toBe('Reloading')
      }),
  )

  it.effect('a tap on the knife slot puts the knife in hand', () =>
    Story.story(
      APPLICATION,
      Story.given(fightingWith([])),
      Story.message(Message.ClickedMeleeSlot()),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.wield).toBe('Melee')
      }),
    ),
  )

  it.effect(
    'a second tap on the knife slot does nothing, not even a reload',
    () => {
      const emptyPistol = modifyFocus(fightingWith([]), {
        player: player =>
          modifyFields(player, {
            arsenal: () =>
              pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
          }),
      })
      return Story.story(
        APPLICATION,
        Story.given(emptyPistol),
        Story.message(Message.ClickedMeleeSlot()),
        settleRunCommands,
        Story.models(
          Story.steps(Story.message(Message.ClickedMeleeSlot())),
          (drawn: Model, again: Model) => {
            expect(focusOf(again).player).toEqual(focusOf(drawn).player)
            expect(focusOf(again).player.reload._tag).toBe('Ready')
          },
        ),
        Story.Command.expectNone(),
      )
    },
  )

  it.effect('with a gun in hand, fire shoots and never stabs', () =>
    Effect.gen(function* () {
      const firing = yield* send(
        fightingWith([tough(900, PLAYER_X + 10)]),
        FIRE_PRESS,
        FIRE_PUSH,
      )
      const seen = yield* frames(firing, 3)
      expect(stabsIn(seen)).toBe(0)
      expect(
        Array.some(seen, current =>
          Array.some(current.frameEvents, GameEvent.isAnyOf(['Fired'])),
        ),
      ).toBe(true)
    }),
  )

  it.effect('F alone does not stab: the knife waits for the trigger', () =>
    Effect.gen(function* () {
      const drawn = yield* knifed([tough(900, PLAYER_X + 10)])
      const seen = yield* frames(drawn, 3)
      expect(stabsIn(seen)).toBe(0)
    }),
  )

  it.effect(
    'in hand, fire stabs the zombie in front for a little damage and a small shove',
    () =>
      Effect.gen(function* () {
        const drawn = yield* knifed([tough(900, PLAYER_X + 10)])
        return yield* Story.story(
          APPLICATION,
          Story.given(drawn),
          holdFire,
          tick(FRAME_MS),
          Story.model(current => {
            const hit = zombieById(current, 900)
            expect(hit.hp).toBe(99 - KNIFE_RULES.damage)
            expect(hit.knockback.x).toBeGreaterThan(0)
            expect(hit.knockback.x).toBeLessThanOrEqual(KNIFE_RULES.knockback)
            expect(Array.map(current.frameEvents, ({ _tag }) => _tag)).toEqual(
              expect.arrayContaining(['KnifeStabbed', 'KnifeHit', 'ZombieHit']),
            )
            expect(current.bullets).toHaveLength(0)
            expect(heldGun(focusOf(current).player.arsenal).loaded).toBe(
              PISTOL_MAGAZINE,
            )
          }),
        )
      }),
  )

  it.effect(
    'a stab meets only the nearest zombie in front, never one behind',
    () =>
      Effect.gen(function* () {
        const near = tough(900, PLAYER_X + 9)
        const farther = tough(901, PLAYER_X + 14, ROW_Y + 2)
        const behind = tough(902, PLAYER_X - 9)
        const drawn = yield* knifed([near, farther, behind])
        return yield* Story.story(
          APPLICATION,
          Story.given(drawn),
          holdFire,
          tick(FRAME_MS),
          Story.model(current => {
            expect(zombieById(current, 900).hp).toBe(98)
            expect(zombieById(current, 901).hp).toBe(99)
            expect(zombieById(current, 902).hp).toBe(99)
          }),
        )
      }),
  )

  it.effect(
    'fire held stabs on repeat, one stab per cooldown and no faster',
    () =>
      Effect.gen(function* () {
        const lug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 99 })
        const drawn = yield* knifed([lug])
        const held = yield* send(drawn, FIRE_PRESS, FIRE_PUSH)
        const seen = yield* frames(
          held,
          tickCountFor(KNIFE_RULES.intervalMs * 3 - FRAME_MS),
        )
        expect(stabsIn(seen)).toBe(3)
        expect(zombieById(lastOf(seen), 900).hp).toBe(
          99 - 3 * KNIFE_RULES.damage,
        )
      }),
  )

  it.effect('letting go of fire stops the stabbing', () =>
    Effect.gen(function* () {
      const drawn = yield* knifed([tough(900, PLAYER_X + 10)])
      const held = yield* send(drawn, FIRE_PRESS, FIRE_PUSH)
      const stabbed = yield* frames(held, 1)
      const letGo = yield* send(lastOf(stabbed), FIRE_LIFT)
      const after = yield* frames(
        letGo,
        tickCountFor(KNIFE_RULES.intervalMs * 3),
      )
      expect(stabsIn(after)).toBe(0)
    }),
  )

  it.effect('another finger lifting does not let go of the trigger', () =>
    Effect.gen(function* () {
      const drawn = yield* knifed([tough(900, PLAYER_X + 10)])
      const held = yield* send(
        drawn,
        FIRE_PRESS,
        FIRE_PUSH,
        Message.ReleasedPointer({ pointerId: 7 }),
      )
      const seen = yield* frames(held, tickCountFor(KNIFE_RULES.intervalMs * 2))
      expect(stabsIn(seen)).toBe(2)
    }),
  )

  it.effect('Q puts the knife away for the last gun held', () => {
    const smg = freshGun('Smg')
    return Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(fightingWith([]), {
          player: player =>
            modifyFields(player, { arsenal: () => holdingSecond(smg) }),
        }),
      ),
      press('KeyF'),
      release('KeyF'),
      press('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.wield).toBe('Gun')
        expect(heldGun(player.arsenal)).toEqual(smg)
      }),
      release('KeyQ'),
      press('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(heldWeapon(player.arsenal)).toBe('Pistol')
      }),
    )
  })

  it.effect('a tap on either gun slot leaves the knife for that gun', () =>
    Effect.gen(function* () {
      const smg = freshGun('Smg')
      const armed = modifyFocus(fightingWith([]), {
        player: player =>
          modifyFields(player, { arsenal: () => holdingSecond(smg) }),
      })
      yield* Story.story(
        APPLICATION,
        Story.given(armed),
        Story.message(Message.ClickedMeleeSlot()),
        Story.message(Message.ClickedGunSlot({ slot: 'First' })),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Gun')
          expect(heldWeapon(player.arsenal)).toBe('Pistol')
        }),
      )
      const emptySmg = modifyFields(smg, { loaded: () => 0 })
      yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(armed, {
            player: player =>
              modifyFields(player, { arsenal: () => holdingSecond(emptySmg) }),
          }),
        ),
        Story.message(Message.ClickedMeleeSlot()),
        Story.message(Message.ClickedGunSlot({ slot: 'Second' })),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Gun')
          expect(heldGun(player.arsenal)).toEqual(emptySmg)
          expect(player.reload._tag).toBe('Ready')
        }),
      )
    }),
  )

  it.effect(
    'R with the knife out puts the last gun back and reloads it',
    () => {
      const empty = modifyFocus(fightingWith([]), {
        player: player =>
          modifyFields(player, {
            arsenal: () =>
              pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
            wield: () => 'Melee',
          }),
      })
      return Story.story(
        APPLICATION,
        Story.given(empty),
        press('KeyR'),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Gun')
          expect(player.reload._tag).toBe('Reloading')
        }),
      )
    },
  )

  it.effect(
    'with both magazines empty, the next pull reloads, and the knife stays put',
    () =>
      Effect.gen(function* () {
        const empty = (gun: CarriedGun): CarriedGun =>
          modifyFields(gun, { loaded: () => 0 })
        const allEmpty = modifyFocus(
          fightingWith([tough(900, PLAYER_X + 10)]),
          {
            player: player =>
              modifyFields(player, {
                arsenal: () =>
                  Arsenal.HoldingSecond({
                    first: empty(freshGun('Smg')),
                    second: empty(freshGun('Shotgun')),
                  }),
              }),
          },
        )
        const pulling = yield* send(allEmpty, FIRE_PRESS, FIRE_PUSH)
        const seen = yield* frames(pulling, 1)
        const pulled = lastOf(seen)
        expect(focusOf(pulled).player.wield).toBe('Gun')
        expect(focusOf(pulled).player.reload._tag).toBe('Reloading')
        expect(heldWeapon(focusOf(pulled).player.arsenal)).toBe('Shotgun')
      }),
  )

  it.effect('it rests while the player browses the shop', () =>
    Effect.gen(function* () {
      const drawn = yield* knifed([tough(900, PLAYER_X + 10)])
      return yield* Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(drawn, {
            shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
          }),
        ),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(zombieById(current, 900).hp).toBe(99)
        }),
      )
    }),
  )

  it.effect('a kill with the knife pays the bounty', () =>
    Effect.gen(function* () {
      const doomed = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, { hp: 1 })
      const drawn = yield* knifed([doomed])
      return yield* Story.story(
        APPLICATION,
        Story.given(drawn),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).wallet.earned).toBeGreaterThan(0)
          expect(
            Array.some(
              current.frameEvents,
              GameEvent.isAnyOf(['ZombieKilled']),
            ),
          ).toBe(true)
        }),
      )
    }),
  )

  it.effect('a new gun goes in hand, putting the knife away', () =>
    Effect.gen(function* () {
      const drawn = yield* knifed([])
      const shopping = modifyFocus(
        modifyFields(drawn, {
          phase: () =>
            Phase.Preparation({
              wave: 2,
              remainingMs: 15_000,
              durationMs: 20_000,
              spawns: [DISTANT_SPAWN],
            }),
        }),
        {
          wallet: () => ({ balance: 200, earned: 200, shown: 200 }),
          shop: () => ShopState.Browsing({ focusedItem: 'Smg' }),
        },
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(shopping),
        buyAtCounter('Smg'),
        Story.Command.resolve(FocusItem, ShopMessage.CompletedFocusItem()),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Gun')
          expect(heldWeapon(player.arsenal)).toBe('Smg')
        }),
      )
    }),
  )
})

describe('two gun slots', () => {
  const browsing = (base: Model, balance: number): Model =>
    modifyFocus(
      modifyFields(base, {
        phase: () =>
          Phase.Preparation({
            wave: 2,
            remainingMs: 15_000,
            durationMs: 20_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      {
        wallet: () => ({ balance, earned: balance, shown: balance }),
        shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
      },
    )

  const armed = (arsenal: Player['arsenal']): Model =>
    modifyFocus(fightingWith([]), {
      player: player => modifyFields(player, { arsenal: () => arsenal }),
    })

  it.effect('the first gun bought fills the empty second slot', () =>
    Story.story(
      APPLICATION,
      Story.given(browsing(armed(pistolOnly()), 200)),
      buyAtCounter('Smg'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(holdingSecond(freshGun('Smg')))
      }),
    ),
  )

  it.effect(
    'with both slots full, a third gun replaces the pistol held in hand',
    () =>
      Story.story(
        APPLICATION,
        Story.given(browsing(armed(holdingFirst(freshGun('Smg'))), 200)),
        buyAtCounter('Shotgun'),
        Story.Command.resolve(FocusItem, ShopMessage.CompletedFocusItem()),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.arsenal).toEqual(
            Arsenal.HoldingFirst({
              first: freshGun('Shotgun'),
              second: freshGun('Smg'),
            }),
          )
          expect(
            Array.some(gunsOf(player.arsenal), gun => gun.kind === 'Pistol'),
          ).toBe(false)
        }),
      ),
  )

  it.effect(
    'Rattles sells the pistol back for $0, even to an empty wallet',
    () => {
      const traded = browsing(
        armed(
          Arsenal.HoldingSecond({
            first: freshGun('Smg'),
            second: freshGun('Shotgun'),
          }),
        ),
        0,
      )
      expect(SHOP_ITEMS.Pistol.price).toBe(0)
      expect(verdictFor(traded, focusSlotOf(traded), 'Pistol')._tag).toBe(
        'Available',
      )
      return Story.story(
        APPLICATION,
        Story.given(traded),
        buyAtCounter('Pistol'),
        Story.model(({ seats: [{ player, wallet }] }) => {
          expect(player.arsenal).toEqual(
            Arsenal.HoldingSecond({
              first: freshGun('Smg'),
              second: STARTING_PISTOL,
            }),
          )
          expect(heldGun(player.arsenal).loaded).toBe(PISTOL_MAGAZINE)
          expect(wallet.balance).toBe(0)
        }),
      )
    },
  )

  test('the pistol is not sold to a player who carries it', () => {
    expect(
      verdictFor(
        browsing(armed(pistolOnly()), 50),
        focusSlotOf(browsing(armed(pistolOnly()), 50)),
        'Pistol',
      )._tag,
    ).toBe('Refused')
  })

  it.effect('an empty gun reloads in hand, and never hands over', () =>
    Effect.gen(function* () {
      const empty = modifyFields(freshGun('Smg'), { loaded: () => 0 })
      const mouseDown = Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 600,
        clientY: 200,
      })
      const pulling = yield* send(
        armed(holdingSecond(empty)),
        Message.PressedKey({ code: 'KeyW' }),
        mouseDown,
      )
      const seen = yield* frames(pulling, 2)
      const after = focusOf(lastOf(seen)).player
      expect(heldWeapon(after.arsenal)).toBe('Smg')
      expect(after.wield).toBe('Gun')
      expect(after.reload._tag).toBe('Reloading')
    }),
  )

  it.effect('the pistol upgrade goes with the pistol, wherever it sits', () =>
    Story.story(
      APPLICATION,
      Story.given(browsing(armed(holdingSecond(freshGun('Smg'))), 1000)),
      buyAtCounter('PistolUpgrade'),
      Story.model(({ seats: [{ player }] }) => {
        expect(gunsOf(player.arsenal)[0]).toEqual(
          modifyFields(STARTING_PISTOL, { tier: () => 1 }),
        )
        expect(magazineOf('Pistol', 1)).toBeGreaterThan(PISTOL_MAGAZINE)
      }),
    ),
  )
})

describe('the knife in co-op', () => {
  const WAVE = Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

  const room = (): RoomWorld => {
    const started = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const placed = (slot: number, x: number) => (world: RoomWorld['world']) =>
      withSeat(world, slot, seatWorld =>
        modifyFocus(seatWorld, {
          player: player =>
            modifyFields(player, {
              x: () => x,
              y: () => ROW_Y,
              facing: () => ({ x: 1, y: 0 }),
            }),
        }),
      )
    return modifyFields(started, {
      world: world =>
        modifyFields(placed(1, 200)(placed(0, 60)(world)), {
          phase: () => WAVE,
          zombies: () => [tough(900, 210), tough(901, 70)],
        }),
    })
  }

  const stepWith = (
    current: RoomWorld,
    slotInput: (slot: number) => Partial<PlayerInput>,
  ): RoomWorld =>
    stepRoomWorld(
      current,
      Array.map([0, 1], slot => ({
        slot,
        input: { ...NEUTRAL_INPUT, aimX: AIM_REACH, ...slotInput(slot) },
        presence: 'Here' as const,
        viewLagTicks: 0,
        rttMs: 0,
      })),
    )

  const pressed = (action: SeatAction, count: number): number =>
    heldAction(actionCodeOf(action), count)

  test('a seat draws its own knife and its fire stabs in front of its own player only', () => {
    const stepped = stepWith(room(), slot =>
      slot === 1
        ? { action: pressed(SeatAction.Melee(), 1), buttons: FIRE_BUTTON }
        : {},
    )
    const hpOf = (id: number): number =>
      Option.getOrThrow(
        Array.findFirst(stepped.world.zombies, zombie => zombie.id === id),
      ).hp
    expect(hpOf(900)).toBe(99 - KNIFE_RULES.damage)
    expect(hpOf(901)).toBe(99)
    const stabber = Option.getOrThrow(maybePlayerAt(stepped.world, 1))
    const other = Option.getOrThrow(maybePlayerAt(stepped.world, 0))
    expect(stabber.player.wield).toBe('Melee')
    expect(stabber.player.knifeCooldownMs).toBeGreaterThan(0)
    expect(other.player.wield).toBe('Gun')
    expect(other.player.knifeCooldownMs).toBe(0)
  })

  test('a seat goes back to a gun by its slot', () => {
    const drawn = stepWith(room(), slot =>
      slot === 1 ? { action: pressed(SeatAction.Melee(), 1) } : {},
    )
    const back = stepWith(drawn, slot =>
      slot === 1
        ? { action: pressed(SeatAction.Draw({ slot: 'First' }), 2) }
        : {},
    )
    const seat = Option.getOrThrow(maybePlayerAt(back.world, 1))
    expect(seat.player.wield).toBe('Gun')
    expect(heldWeapon(seat.player.arsenal)).toBe('Pistol')
  })
})
