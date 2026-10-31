import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { NEUTRAL_INPUT, type PlayerInput } from '@munch/netcode'

import { FIXED_STEP_MS, PISTOL_MAGAZINE } from './constants'
import { KNIFE_RULES } from './knife'
import { update } from './main'
import { Message } from './message'
import {
  type CarriedGun,
  GameEvent,
  type Model,
  Phase,
  ShopState,
  type Zombie,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import { maybePlayerAt, withSeat } from './party'
import {
  AIM_REACH,
  DEFAULT_ROOM_SETTINGS,
  FIRE_BUTTON,
  type RoomWorld,
  actionCodeOf,
  heldAction,
  startRoomWorld,
  stepRoomWorld,
} from './roomWorld'
import { SHOP_ITEMS, verdictFor } from './shop'
import { SeatAction } from './stepWorld'
import {
  SURFACE,
  holdingFirst,
  holdingSecond,
  pistolOnly,
  press,
  release,
  tick,
  tickCountFor,
  zombieById,
  zombieOf,
} from './testing'
import { FocusShopItem } from './update/shop'
import { asVeteran } from './veteran'
import {
  STARTING_PISTOL,
  freshGun,
  gunsOf,
  heldGun,
  heldWeapon,
  inHandOf,
  magazineOf,
} from './weapons'
import { Reload } from './worldSchema'

// The knife (src/knife.ts) and the two gun slots (src/weapons.ts), played
// through `update` the way a player plays them: F or a tap on the knife's
// slot to draw it, fire to stab, Q or a gun's slot to go back, and the
// shop's GUNS tab trading one gun for another.

const FRAME_MS = FIXED_STEP_MS
const ROW_Y = 104
const PLAYER_X = 100

const fightingWith = (zombies: ReadonlyArray<Zombie>): Model =>
  modifyFields(asVeteran(initialModel), {
    maybeSurface: () => Option.some(SURFACE),
    phase: () => Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => zombies,
    player: player =>
      modifyFields(player, {
        x: () => PLAYER_X,
        y: () => ROW_Y,
        facing: () => ({ x: 1, y: 0 }),
      }),
  })

const frames = (start: Model, count: number): ReadonlyArray<Model> =>
  Array.scan(
    Array.makeBy(count, () => 0),
    start,
    current =>
      update(current, Message.TickedFrame({ deltaTime: FRAME_MS })).model,
  ).slice(1)

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

const FIRE_THUMB = 70

const fire = Message.PressedPointer({
  pointerId: FIRE_THUMB,
  device: 'Touch',
  clientX: 600,
  clientY: 200,
})

const letGoOfFire = Message.ReleasedPointer({ pointerId: FIRE_THUMB })

const send = (start: Model, ...messages: ReadonlyArray<Message>): Model =>
  Array.reduce(messages, start, (current, next) => update(current, next).model)

const knifed = (zombies: ReadonlyArray<Zombie>): Model =>
  send(fightingWith(zombies), Message.PressedKey({ code: 'KeyF' }))

describe('the knife', () => {
  test('F puts the knife in hand, and a reload carries on while it is out', () => {
    const reloading = modifyFields(fightingWith([]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
          reload: () => Reload.Reloading({ remainingMs: 600, durationMs: 800 }),
        }),
    })
    const drawn = send(reloading, Message.PressedKey({ code: 'KeyF' }))
    expect(drawn.player.wield).toBe('Melee')
    expect(inHandOf(drawn.player)).toBe('Knife')
    expect(drawn.player.reload._tag).toBe('Reloading')
    const reloaded = lastOf(frames(drawn, tickCountFor(600) + 1))
    expect(reloaded.player.reload._tag).toBe('Ready')
    expect(heldGun(reloaded.player.arsenal).loaded).toBe(PISTOL_MAGAZINE)
    expect(reloaded.player.wield).toBe('Melee')
  })

  test('changing guns from the knife stops the reload of the last gun', () => {
    const reloading = modifyFields(fightingWith([]), {
      player: player =>
        modifyFields(player, {
          arsenal: () => holdingSecond(freshGun('Smg')),
          reload: () => Reload.Reloading({ remainingMs: 600, durationMs: 800 }),
          wield: () => 'Melee',
        }),
    })
    const toPistol = send(reloading, Message.ClickedGunSlot({ slot: 'First' }))
    expect(heldWeapon(toPistol.player.arsenal)).toBe('Pistol')
    expect(toPistol.player.reload._tag).toBe('Ready')
    const back = send(reloading, Message.ClickedGunSlot({ slot: 'Second' }))
    expect(back.player.reload._tag).toBe('Reloading')
  })

  test('a tap on the knife slot puts the knife in hand', () => {
    story(
      update,
      given(fightingWith([])),
      message(Message.ClickedMeleeSlot()),
      model(({ player }) => {
        expect(player.wield).toBe('Melee')
      }),
    )
  })

  test('a second tap on the knife slot does nothing, not even a reload', () => {
    const emptyPistol = modifyFields(fightingWith([]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
        }),
    })
    const drawn = update(emptyPistol, Message.ClickedMeleeSlot()).model
    const again = update(drawn, Message.ClickedMeleeSlot())
    expect(again.model.player).toEqual(drawn.player)
    expect(again.model.player.reload._tag).toBe('Ready')
    expect(again.commands ?? []).toHaveLength(0)
  })

  test('with a gun in hand, fire shoots and never stabs', () => {
    const seen = frames(
      send(fightingWith([tough(900, PLAYER_X + 10)]), fire),
      3,
    )
    expect(stabsIn(seen)).toBe(0)
    expect(
      Array.some(seen, current =>
        Array.some(current.frameEvents, GameEvent.isAnyOf(['Fired'])),
      ),
    ).toBe(true)
  })

  test('F alone does not stab: the knife waits for the trigger', () => {
    const seen = frames(knifed([tough(900, PLAYER_X + 10)]), 3)
    expect(stabsIn(seen)).toBe(0)
  })

  test('in hand, fire stabs the zombie in front for a little damage and a small shove', () => {
    story(
      update,
      given(knifed([tough(900, PLAYER_X + 10)])),
      message(fire),
      tick(FRAME_MS),
      model(current => {
        const hit = zombieById(current, 900)
        expect(hit.hp).toBe(99 - KNIFE_RULES.damage)
        expect(hit.knockback.x).toBeGreaterThan(0)
        expect(hit.knockback.x).toBeLessThanOrEqual(KNIFE_RULES.knockback)
        expect(Array.map(current.frameEvents, ({ _tag }) => _tag)).toEqual(
          expect.arrayContaining(['KnifeStabbed', 'KnifeHit', 'ZombieHit']),
        )
        expect(current.bullets).toHaveLength(0)
        expect(heldGun(current.player.arsenal).loaded).toBe(PISTOL_MAGAZINE)
      }),
    )
  })

  test('a stab meets only the nearest zombie in front, never one behind', () => {
    const near = tough(900, PLAYER_X + 9)
    const farther = tough(901, PLAYER_X + 14, ROW_Y + 2)
    const behind = tough(902, PLAYER_X - 9)
    story(
      update,
      given(knifed([near, farther, behind])),
      message(fire),
      tick(FRAME_MS),
      model(current => {
        expect(zombieById(current, 900).hp).toBe(98)
        expect(zombieById(current, 901).hp).toBe(99)
        expect(zombieById(current, 902).hp).toBe(99)
      }),
    )
  })

  test('fire held stabs on repeat, one stab per cooldown and no faster', () => {
    const lug = zombieOf('Tank', 900, PLAYER_X + 12, ROW_Y, { hp: 99 })
    const held = send(knifed([lug]), fire)
    const seen = frames(
      held,
      tickCountFor(KNIFE_RULES.intervalMs * 3 - FRAME_MS),
    )
    expect(stabsIn(seen)).toBe(3)
    expect(zombieById(lastOf(seen), 900).hp).toBe(99 - 3 * KNIFE_RULES.damage)
  })

  test('letting go of fire stops the stabbing', () => {
    const firstStab = lastOf(
      frames(send(knifed([tough(900, PLAYER_X + 10)]), fire), 1),
    )
    const letGo = send(firstStab, letGoOfFire)
    expect(
      stabsIn(frames(letGo, tickCountFor(KNIFE_RULES.intervalMs * 3))),
    ).toBe(0)
  })

  test('another finger lifting does not let go of the trigger', () => {
    const held = send(
      knifed([tough(900, PLAYER_X + 10)]),
      fire,
      Message.ReleasedPointer({ pointerId: 7 }),
    )
    expect(
      stabsIn(frames(held, tickCountFor(KNIFE_RULES.intervalMs * 2))),
    ).toBe(2)
  })

  test('Q puts the knife away for the last gun held', () => {
    const smg = freshGun('Smg')
    story(
      update,
      given(
        modifyFields(fightingWith([]), {
          player: player =>
            modifyFields(player, { arsenal: () => holdingSecond(smg) }),
        }),
      ),
      press('KeyF'),
      release('KeyF'),
      press('KeyQ'),
      model(({ player }) => {
        expect(player.wield).toBe('Gun')
        expect(heldGun(player.arsenal)).toEqual(smg)
      }),
      release('KeyQ'),
      press('KeyQ'),
      model(({ player }) => {
        expect(heldWeapon(player.arsenal)).toBe('Pistol')
      }),
    )
  })

  test('a tap on either gun slot leaves the knife for that gun', () => {
    const smg = freshGun('Smg')
    const armed = modifyFields(fightingWith([]), {
      player: player =>
        modifyFields(player, { arsenal: () => holdingSecond(smg) }),
    })
    story(
      update,
      given(armed),
      message(Message.ClickedMeleeSlot()),
      message(Message.ClickedGunSlot({ slot: 'First' })),
      model(({ player }) => {
        expect(player.wield).toBe('Gun')
        expect(heldWeapon(player.arsenal)).toBe('Pistol')
      }),
    )
    const emptySmg = modifyFields(smg, { loaded: () => 0 })
    story(
      update,
      given(
        modifyFields(armed, {
          player: player =>
            modifyFields(player, { arsenal: () => holdingSecond(emptySmg) }),
        }),
      ),
      message(Message.ClickedMeleeSlot()),
      message(Message.ClickedGunSlot({ slot: 'Second' })),
      model(({ player }) => {
        expect(player.wield).toBe('Gun')
        expect(heldGun(player.arsenal)).toEqual(emptySmg)
        expect(player.reload._tag).toBe('Ready')
      }),
    )
  })

  test('R with the knife out puts the last gun back and reloads it', () => {
    const empty = modifyFields(fightingWith([]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            pistolOnly(modifyFields(STARTING_PISTOL, { loaded: () => 0 })),
          wield: () => 'Melee',
        }),
    })
    story(
      update,
      given(empty),
      press('KeyR'),
      model(({ player }) => {
        expect(player.wield).toBe('Gun')
        expect(player.reload._tag).toBe('Reloading')
      }),
    )
  })

  test('with every gun dry, the next pull draws the knife by itself', () => {
    const dry = (gun: CarriedGun): CarriedGun =>
      modifyFields(gun, { rounds: () => 0, loaded: () => 0 })
    const allDry = modifyFields(fightingWith([tough(900, PLAYER_X + 10)]), {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond(dry(freshGun('Shotgun')), dry(freshGun('Smg'))),
        }),
    })
    const seen = frames(send(allDry, fire), 1)
    const pulled = lastOf(seen)
    expect(pulled.player.wield).toBe('Melee')
    expect(Array.some(pulled.frameEvents, GameEvent.isAnyOf(['RanDry']))).toBe(
      true,
    )
    const stabbing = frames(pulled, tickCountFor(KNIFE_RULES.intervalMs))
    expect(stabsIn([...seen, ...stabbing])).toBeGreaterThan(0)
    expect(zombieById(lastOf(stabbing), 900).hp).toBeLessThan(99)
  })

  test('it rests while the player browses the shop', () => {
    story(
      update,
      given(
        modifyFields(knifed([tough(900, PLAYER_X + 10)]), {
          shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
        }),
      ),
      message(fire),
      tick(FRAME_MS),
      model(current => {
        expect(zombieById(current, 900).hp).toBe(99)
      }),
    )
  })

  test('a kill with the knife pays the bounty', () => {
    const doomed = zombieOf('Shambler', 900, PLAYER_X + 10, ROW_Y, { hp: 1 })
    story(
      update,
      given(knifed([doomed])),
      message(fire),
      tick(FRAME_MS),
      model(current => {
        expect(current.wallet.earned).toBeGreaterThan(0)
        expect(
          Array.some(current.frameEvents, GameEvent.isAnyOf(['ZombieKilled'])),
        ).toBe(true)
      }),
    )
  })

  test('a new gun goes in hand, putting the knife away', () => {
    const shopping = modifyFields(knifed([]), {
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
      wallet: () => ({ balance: 200, earned: 200, shown: 200 }),
      shop: () => ShopState.Browsing({ focusedItem: 'Smg' }),
    })
    story(
      update,
      given(shopping),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      Command.resolve(FocusShopItem, Message.CompletedFocusShopItem()),
      model(({ player }) => {
        expect(player.wield).toBe('Gun')
        expect(heldWeapon(player.arsenal)).toBe('Smg')
      }),
    )
  })
})

describe('two gun slots', () => {
  const browsing = (base: Model, balance: number): Model =>
    modifyFields(base, {
      phase: () =>
        Phase.Preparation({
          wave: 2,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [DISTANT_SPAWN],
        }),
      wallet: () => ({ balance, earned: balance, shown: balance }),
      shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
    })

  const armed = (arsenal: Model['player']['arsenal']): Model =>
    modifyFields(fightingWith([]), {
      player: player => modifyFields(player, { arsenal: () => arsenal }),
    })

  test('the first gun bought fills the empty second slot', () => {
    story(
      update,
      given(browsing(armed(pistolOnly()), 200)),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      model(({ player }) => {
        expect(player.arsenal).toEqual(holdingSecond(freshGun('Smg')))
      }),
    )
  })

  test('with both slots full, a third gun replaces the pistol held in hand', () => {
    story(
      update,
      given(browsing(armed(holdingFirst(freshGun('Smg'))), 200)),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      Command.resolve(FocusShopItem, Message.CompletedFocusShopItem()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(
          holdingFirst(freshGun('Smg'), freshGun('Shotgun')),
        )
        expect(
          Array.some(gunsOf(player.arsenal), gun => gun.kind === 'Pistol'),
        ).toBe(false)
      }),
    )
  })

  test('Rattles sells the pistol back for $0, even to an empty wallet', () => {
    const traded = browsing(
      armed(holdingSecond(freshGun('Shotgun'), freshGun('Smg'))),
      0,
    )
    expect(SHOP_ITEMS.Pistol.price).toBe(0)
    expect(verdictFor(traded, 'Pistol')._tag).toBe('Available')
    story(
      update,
      given(traded),
      message(Message.ClickedBuyButton({ item: 'Pistol' })),
      model(({ player, wallet }) => {
        expect(player.arsenal).toEqual(
          holdingSecond(STARTING_PISTOL, freshGun('Smg')),
        )
        expect(heldGun(player.arsenal).loaded).toBe(PISTOL_MAGAZINE)
        expect(wallet.balance).toBe(0)
      }),
    )
  })

  test('the pistol is not sold to a player who carries it', () => {
    expect(verdictFor(browsing(armed(pistolOnly()), 50), 'Pistol')._tag).toBe(
      'Refused',
    )
  })

  test('a gun that runs dry hands over to the other gun if it can fire', () => {
    const dry = modifyFields(freshGun('Smg'), {
      rounds: () => 0,
      loaded: () => 0,
    })
    const toPistol = update(
      update(armed(holdingSecond(dry)), Message.PressedKey({ code: 'KeyW' }))
        .model,
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 600,
        clientY: 200,
      }),
    ).model
    const after = frames(toPistol, 2)
    expect(heldWeapon(lastOf(after).player.arsenal)).toBe('Pistol')
    const spentFreeze = modifyFields(freshGun('Freeze'), {
      rounds: () => 0,
      loaded: () => 0,
    })
    const stuck = update(
      armed(holdingSecond(dry, spentFreeze)),
      Message.PressedPointer({
        pointerId: 1,
        device: 'Mouse',
        clientX: 600,
        clientY: 200,
      }),
    ).model
    const stuckAfter = lastOf(frames(stuck, 2)).player
    expect(heldWeapon(stuckAfter.arsenal)).toBe('Smg')
    expect(stuckAfter.wield).toBe('Melee')
  })

  test('the pistol upgrade goes with the pistol, wherever it sits', () => {
    story(
      update,
      given(browsing(armed(holdingSecond(freshGun('Smg'))), 1000)),
      message(Message.ClickedBuyButton({ item: 'PistolUpgrade' })),
      model(({ player }) => {
        expect(gunsOf(player.arsenal)[0]).toEqual(
          modifyFields(STARTING_PISTOL, { tier: () => 1 }),
        )
        expect(magazineOf('Pistol', 1)).toBeGreaterThan(PISTOL_MAGAZINE)
      }),
    )
  })
})

describe('the knife in co-op', () => {
  const WAVE = Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

  const room = (): RoomWorld => {
    const started = startRoomWorld([0, 1], 7, DEFAULT_ROOM_SETTINGS)
    const placed = (slot: number, x: number) => (world: RoomWorld['world']) =>
      withSeat(world, slot, seatWorld =>
        modifyFields(seatWorld, {
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
