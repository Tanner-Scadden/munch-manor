import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock, Tabs } from '@foldkit/ui'

import { ShopDialogBinding, ShopTabsBinding } from './composition'
import {
  BULLET_MAX,
  COINS_PER_PURCHASE,
  DRY_FIRE_DELAY_MS,
  FIXED_STEP_MS,
  PLAYER_MAX_HP,
  PREPARATION_MS,
  SHAMBLER_BOUNTY,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
  ZOMBIE_MAX_HP,
} from './constants'
import { update } from './main'
import { Message } from './message'
import {
  type Bullet,
  type CarriedGun,
  GameEvent,
  Lesson,
  type Model,
  Phase,
  Pierce,
  type ShopCategory,
  ShopChatter,
  type ShopItemId,
  ShopState,
  type WeaponKind,
  initialModel,
} from './model'
import { DISTANT_SPAWN, pastFirstBreak, withArsenal } from './model.fixture'
import {
  LASER_SIGHT_PRICE,
  SHOP_CATEGORY_ORDER,
  SHOP_ITEMS,
  affordableCount,
  gunShelves,
  itemsIn,
  stallPrompt,
  totalAffordable,
} from './shop'
import { ShopTabsBlock } from './shopTabs'
import {
  RESTART_GRACE_TICKS,
  bulletInto,
  holdFire,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  pistolOnly,
  press,
  release,
  tick,
  ticks,
  zombieAt,
} from './testing'
import { FocusShopItem } from './update/shop'
import { asVeteran } from './veteran'
import { FINAL_WAVE } from './wavePlans'
import { waveBonus } from './waves'
import { UPGRADE_TIERS, WEAPONS, magazineOf, startingRounds } from './weapons'

const FRAME_MS = 50
// NOTE: one 60 Hz tick.
const SHORT_FRAME_MS = FIXED_STEP_MS
const PLAYER_Y = 90
const BESIDE_STALL = { x: 241, y: 142 }
const FRAMES_TO_STALL = 3

const readyModel: Model = modifyFields(
  pastFirstBreak(asVeteran(initialModel)),
  {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  },
)

const GRACE_TICK_MS = 50
const resolveShowShop = Command.resolve(
  Dialog.test.ShowDialog,
  DialogBlock.Message.SucceededShowDialog(),
)

const resolveCloseShop = Command.resolve(
  Dialog.test.CloseDialog,
  DialogBlock.Message.CompletedCloseDialog(),
)

const preparing = (wave: number): Phase =>
  Phase.Preparation({
    wave,
    remainingMs: 15_000,
    durationMs: PREPARATION_MS,
    spawns: [DISTANT_SPAWN],
  })

const fighting = (wave: number): Phase =>
  Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

const at = (base: Model, x: number, y: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { x: () => x, y: () => y }),
  })

const besideStall = (phase: Phase): Model =>
  modifyFields(at(readyModel, BESIDE_STALL.x, BESIDE_STALL.y), {
    phase: () => phase,
  })

const withMoney = (base: Model, balance: number): Model =>
  modifyFields(base, {
    wallet: () => ({ balance, earned: balance, shown: balance }),
  })

const browsing = (base: Model): Model =>
  modifyFields(base, {
    phase: () => preparing(2),
    shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
  })

const resolveFocusShopItem = Command.resolve(
  FocusShopItem,
  Message.CompletedFocusShopItem(),
)

const focusedOn = (base: Model, item: ShopItemId): Model =>
  modifyFields(base, { shop: () => ShopState.Browsing({ focusedItem: item }) })

const withHp = (base: Model, hp: number): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { hp: () => hp }),
  })

const gun = (
  kind: CarriedGun['kind'],
  rounds: number,
  tier = 0,
): CarriedGun => ({
  kind,
  rounds,
  loaded: Math.min(rounds, magazineOf(kind, tier)),
  tier,
})

const doomed = zombieAt(100, 170, PLAYER_Y, { hp: 1 })

const killShot = (base: Model): Model =>
  modifyFields(base, {
    zombies: () => [doomed],
    bullets: () => [bulletInto(500, doomed)],
  })

const holdingSpare = (rounds: number, kind: CarriedGun['kind'] = 'Shotgun') =>
  holdingSecond(gun(kind, rounds))

const preparationRemainingMs = (phase: Phase): number =>
  Option.getOrThrow(Option.liftPredicate(phase, Phase.guards.Preparation))
    .remainingMs

describe('money', () => {
  test('a Shambler kill pays its bounty and shows it as a coin pop', () => {
    story(
      update,
      given(killShot(modifyFields(readyModel, { phase: () => fighting(1) }))),
      tick(SHORT_FRAME_MS),
      model(({ wallet, popups, frameEvents }) => {
        expect(wallet.balance).toBe(SHAMBLER_BOUNTY)
        expect(wallet.earned).toBe(SHAMBLER_BOUNTY)
        expect(
          Array.findFirst(frameEvents, GameEvent.guards.ZombieKilled),
        ).toEqual(
          Option.some(
            GameEvent.ZombieKilled({
              x: doomed.x,
              y: doomed.y,
              direction: { x: 1, y: 0 },
              bounty: SHAMBLER_BOUNTY,
              kind: 'Shambler',
            }),
          ),
        )
        expect(
          Array.map(popups, ({ kind, value }) => [kind, value]),
        ).toContainEqual(['Kill', SHAMBLER_BOUNTY])
      }),
    )
  })

  test('clearing a wave pays the bonus for that wave on top of the kill', () => {
    const wave = 2
    story(
      update,
      given(
        killShot(
          modifyFields(readyModel, {
            phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, wallet, popups, frameEvents }) => {
        expect(waveBonus(wave)).toBe(
          WAVE_BONUS_BASE + WAVE_BONUS_PER_WAVE * wave,
        )
        expect(waveBonus(wave)).toBe(30)
        expect(phase._tag).toBe('Preparation')
        expect(wallet.balance).toBe(SHAMBLER_BOUNTY + 30)
        expect(wallet.earned).toBe(SHAMBLER_BOUNTY + 30)
        expect(frameEvents).toContainEqual(
          GameEvent.WaveCleared({ x: 160, y: PLAYER_Y, bonus: 30 }),
        )
        expect(
          Array.map(popups, ({ kind, value }) => [kind, value]),
        ).toContainEqual(['Payday', 30])
      }),
    )
  })

  test('the final wave pays too, and Victory keeps what was earned after spending', () => {
    story(
      update,
      given(
        killShot(
          modifyFields(readyModel, {
            phase: () =>
              Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 0, spawns: [] }),
            wallet: () => ({ balance: 10, earned: 200, shown: 10 }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, wallet }) => {
        expect(phase).toEqual(Phase.Victory())
        expect(wallet.balance).toBe(
          10 + SHAMBLER_BOUNTY + waveBonus(FINAL_WAVE),
        )
        expect(wallet.earned).toBe(
          200 + SHAMBLER_BOUNTY + waveBonus(FINAL_WAVE),
        )
      }),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      press('Enter'),
      model(({ wallet, player }) => {
        expect(wallet).toEqual({ balance: 0, earned: 0, shown: 0 })
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    )
  })

  test('the HUD counter ticks toward the balance instead of jumping', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(2),
          wallet: () => ({ balance: 60, earned: 60, shown: 0 }),
        }),
      ),
      tick(SHORT_FRAME_MS),
      model(({ wallet }) => {
        expect(wallet.shown).toBeGreaterThan(0)
        expect(wallet.shown).toBeLessThan(60)
      }),
      ...ticks(60, SHORT_FRAME_MS),
      model(({ wallet }) => {
        expect(wallet.shown).toBe(60)
      }),
    )
  })
})

describe('the shop stall', () => {
  test('walking up to the stall during preparation opens the shop', () => {
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL - 1, FRAME_MS),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(FRAME_MS),
      Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      model(({ shop, shopDialog, input }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
        expect(shopDialog.isOpen).toBe(true)
        expect(input.pressedKeys).toEqual([])
      }),
    )
  })

  test('the stall stays closed during a wave and during the wave 1 tutorial', () => {
    const walkUpDuring = (phase: Phase) =>
      story(
        update,
        given(besideStall(phase)),
        press('KeyD'),
        ...ticks(FRAMES_TO_STALL + 2, FRAME_MS),
        Command.expectNone(),
        model(({ shop, shopDialog }) => {
          expect(shop).toEqual(ShopState.Away())
          expect(shopDialog.isOpen).toBe(false)
        }),
      )

    walkUpDuring(fighting(3))
    walkUpDuring(preparing(1))
  })

  test('a player who ends a wave at the stall gets the shop once preparation begins', () => {
    story(
      update,
      given(
        killShot(
          modifyFields(at(readyModel, 270, 144), {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          }),
        ),
      ),
      tick(SHORT_FRAME_MS),
      model(({ phase, shop }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(FRAME_MS),
      Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      model(({ shop, shopDialog }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
        expect(shopDialog.isOpen).toBe(true)
      }),
    )
  })

  test('the stall blocks movement like cover', () => {
    story(
      update,
      given(
        modifyFields(at(readyModel, 270, 142), { phase: () => fighting(2) }),
      ),
      press('KeyS'),
      ...ticks(20, FRAME_MS),
      model(({ player }) => {
        expect(player.y).toBeCloseTo(146)
      }),
    )
  })

  test('the preparation countdown pauses while the shop is open, and the player cannot move or shoot', () => {
    const frozen: Array<Model> = []
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      model(current => {
        frozen.push(current)
      }),
      press('KeyD'),
      holdFire,
      press('Enter'),
      ...ticks(10, FRAME_MS),
      model(({ phase, player, bullets, elapsedMs, intent }) => {
        const opened = Option.getOrThrow(Array.head(frozen))
        expect(preparationRemainingMs(phase)).toBe(
          preparationRemainingMs(opened.phase),
        )
        expect(player.x).toBe(opened.player.x)
        expect(bullets).toEqual([])
        expect(intent.trigger).toBe('Released')
        expect(elapsedMs).toBeCloseTo(opened.elapsedMs + 10 * FRAME_MS)
      }),
    )
  })

  test('closing the shop resumes the countdown and it reopens only after stepping away', () => {
    story(
      update,
      given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      release('KeyD'),
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      resolveCloseShop,
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Dismissed())
      }),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(preparationRemainingMs(phase)).toBeLessThan(15_000)
      }),
      press('KeyD'),
      ...ticks(2, FRAME_MS),
      release('KeyD'),
      Command.expectNone(),
      press('KeyA'),
      ...ticks(4, FRAME_MS),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Dismissed())
      }),
      ...ticks(2, FRAME_MS),
      release('KeyA'),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      press('KeyD'),
      ...ticks(3, FRAME_MS),
      Command.expectNone(),
      tick(FRAME_MS),
      Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      model(({ shop }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
    )
  })

  test('Escape and the start wave keys do nothing to the game while the shop is open', () => {
    const shopping = browsing(withMoney(readyModel, 0))
    story(
      update,
      given(shopping),
      press('Escape'),
      press('Enter'),
      press('KeyR'),
      press('KeyQ'),
      message(Message.ClickedStartWaveButton()),
      model(({ phase, player }) => {
        expect(phase).toEqual(shopping.phase)
        expect(player.arsenal).toEqual(shopping.player.arsenal)
      }),
    )
  })
})

describe('buying', () => {
  test('buying a gun deducts its price, puts it in the second slot, and bursts coins', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 100))),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      resolveFocusShopItem,
      model(({ wallet, player, particles }) => {
        expect(wallet.balance).toBe(100 - SHOP_ITEMS.Shotgun.price)
        expect(wallet.earned).toBe(100)
        expect(player.arsenal).toEqual(holdingSpare(16))
        expect(
          Array.filter(particles, ({ kind }) => kind === 'Coin'),
        ).toHaveLength(COINS_PER_PURCHASE)
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(
          100 - SHOP_ITEMS.Shotgun.price - SHOP_ITEMS.ShotgunShells.price,
        )
        expect(player.arsenal).toEqual(holdingSpare(32))
      }),
    )
  })

  test('a new gun replaces the one in hand, and the other gun stays', () => {
    story(
      update,
      given(
        withArsenal(
          browsing(withMoney(readyModel, 200)),
          holdingSecond(gun('Shotgun', 3)),
        ),
      ),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      model(({ player, wallet }) => {
        expect(player.arsenal).toEqual(
          holdingSecond(gun('Smg', startingRounds('Smg'))),
        )
        expect(wallet.balance).toBe(200 - SHOP_ITEMS.Smg.price)
      }),
    )
  })

  test('a heart heals one and is refused at full hearts', () => {
    story(
      update,
      given(withHp(browsing(withMoney(readyModel, 60)), PLAYER_MAX_HP - 1)),
      message(Message.ClickedBuyButton({ item: 'Heart' })),
      model(({ player, wallet }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
      message(Message.ClickedBuyButton({ item: 'Heart' })),
      model(({ player, wallet }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
    )
  })

  test('purchases are refused when broke, without the gun, when full, or already owned', () => {
    const refused = (start: Model, item: typeof SHOP_ITEMS.Heart.id) =>
      story(
        update,
        given(start),
        message(Message.ClickedBuyButton({ item })),
        model(current => {
          expect(current.wallet).toEqual(start.wallet)
          expect(current.player).toEqual(start.player)
          expect(current.particles).toEqual([])
        }),
      )

    refused(withHp(browsing(withMoney(readyModel, 24)), 2), 'Heart')
    refused(browsing(withMoney(readyModel, 500)), 'ShotgunShells')
    refused(
      withArsenal(browsing(withMoney(readyModel, 500)), holdingSpare(48)),
      'ShotgunShells',
    )
    refused(
      withArsenal(browsing(withMoney(readyModel, 500)), holdingSpare(5)),
      'Shotgun',
    )
    refused(withMoney(readyModel, 500), 'Shotgun')
  })

  test('the laser sight is dear, fits once, lists last under GUNS, and goes with the run', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, LASER_SIGHT_PRICE - 1))),
      model(current => {
        expect(Array.last(itemsIn(current, 'Guns'))).toEqual(
          Option.some('LaserSight'),
        )
      }),
      message(Message.ClickedBuyButton({ item: 'LaserSight' })),
      model(({ laserSight, wallet }) => {
        expect(laserSight).toBe('None')
        expect(wallet.balance).toBe(LASER_SIGHT_PRICE - 1)
      }),
    )
    story(
      update,
      given(browsing(withMoney(readyModel, LASER_SIGHT_PRICE + 10))),
      message(Message.ClickedBuyButton({ item: 'LaserSight' })),
      model(({ laserSight, wallet }) => {
        expect(laserSight).toBe('Fitted')
        expect(wallet.balance).toBe(10)
      }),
      message(Message.ClickedBuyButton({ item: 'LaserSight' })),
      model(({ wallet }) => {
        expect(wallet.balance).toBe(10)
      }),
    )
  })

  test('ammo tops up to the cap', () => {
    story(
      update,
      given(
        focusedOn(
          withArsenal(browsing(withMoney(readyModel, 100)), holdingSpare(40)),
          'ShotgunShells',
        ),
      ),
      message(Message.ClickedBuyButton({ item: 'ShotgunShells' })),
      model(({ player }) => {
        expect(player.arsenal).toEqual(holdingSpare(48))
      }),
    )
  })
})

describe('carrying two guns', () => {
  const armed = modifyFields(
    withArsenal(readyModel, holdingFirst(gun('Shotgun', 16))),
    { phase: () => fighting(2) },
  )

  test('Q and the swap button switch guns', () => {
    const spare = holdingSecond(gun('Shotgun', 16))
    const pistol = holdingFirst(gun('Shotgun', 16))
    story(
      update,
      given(armed),
      press('KeyQ'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(spare)
      }),
      press('KeyQ'),
      model(({ player }) => {
        expect(player.arsenal).toEqual(pistol)
      }),
      message(Message.ClickedSwapButton()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(spare)
      }),
    )
  })

  test('with only the pistol there is nothing to swap to', () => {
    story(
      update,
      given(modifyFields(readyModel, { phase: () => fighting(1) })),
      press('KeyQ'),
      message(Message.ClickedSwapButton()),
      model(({ player }) => {
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    )
  })

  test('the shotgun spends one shell for five pellets', () => {
    story(
      update,
      given(withArsenal(armed, holdingSpare(16))),
      holdFire,
      tick(SHORT_FRAME_MS),
      model(({ bullets, player, frameEvents }) => {
        expect(bullets).toHaveLength(WEAPONS.Shotgun.pellets)
        expect(bullets).toHaveLength(5)
        expect(Array.every(bullets, ({ weapon }) => weapon === 'Shotgun')).toBe(
          true,
        )
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ rounds, loaded }) => ({
            rounds,
            loaded,
          })),
        ).toEqual(
          Option.some({ rounds: 15, loaded: WEAPONS.Shotgun.magazine - 1 }),
        )
        expect(Array.filter(frameEvents, GameEvent.guards.Fired)).toHaveLength(
          1,
        )
      }),
    )
  })

  test('a gun that runs dry clicks, pops EMPTY, and swaps to the pistol', () => {
    story(
      update,
      given(withArsenal(armed, holdingSpare(1, 'Smg'))),
      holdFire,
      tick(SHORT_FRAME_MS),
      model(({ player, bullets }) => {
        expect(player.arsenal).toEqual(holdingSpare(0, 'Smg'))
        expect(bullets).toHaveLength(1)
      }),
      ...ticks(
        Math.ceil(WEAPONS.Smg.fireIntervalMs / SHORT_FRAME_MS),
        SHORT_FRAME_MS,
      ),
      model(({ player, frameEvents, popups }) => {
        expect(player.arsenal).toEqual(holdingFirst(gun('Smg', 0)))
        expect(Array.map(frameEvents, ({ _tag }) => _tag)).toContain('RanDry')
        expect(Array.map(popups, ({ kind }) => kind)).toContain('Empty')
        expect(player.fireCooldownMs).toBe(DRY_FIRE_DELAY_MS)
      }),
      ...ticks(
        Math.ceil(DRY_FIRE_DELAY_MS / SHORT_FRAME_MS) + 1,
        SHORT_FRAME_MS,
      ),
      model(({ bullets }) => {
        expect(Array.some(bullets, ({ weapon }) => weapon === 'Pistol')).toBe(
          true,
        )
      }),
    )
  })
})

describe('shotgun spread', () => {
  const blastWith = (seed: number): ReadonlyArray<Bullet> => {
    const shots: Array<ReadonlyArray<Bullet>> = []
    story(
      update,
      given(
        modifyFields(withArsenal(readyModel, holdingSpare(16)), {
          phase: () => fighting(2),
          rngState: () => seed,
        }),
      ),
      holdFire,
      tick(SHORT_FRAME_MS),
      model(({ bullets }) => {
        shots.push(bullets)
      }),
    )
    return Option.getOrThrow(Array.head(shots))
  }

  test('a seed fixes the pellet spread, and every pellet stays inside the cone', () => {
    const first = blastWith(1234)
    expect(blastWith(1234)).toEqual(first)
    expect(blastWith(98765)).not.toEqual(first)
    expect(first).toHaveLength(5)
    expect(
      Array.every(
        first,
        ({ velocityX, velocityY }) =>
          Math.abs(Math.atan2(velocityY, velocityX)) <=
          WEAPONS.Shotgun.spread / 2,
      ),
    ).toBe(true)
    expect(
      Array.dedupe(Array.map(first, ({ velocityY }) => velocityY)),
    ).toHaveLength(5)
  })

  test('the bullet count stays capped when the room is full of pellets', () => {
    const parked: ReadonlyArray<Bullet> = Array.makeBy(BULLET_MAX, index => ({
      id: 1000 + index,
      x: 60 + index,
      y: 60,
      velocityX: 0,
      velocityY: 0,
      remainingMs: 9000,
      weapon: 'Pistol',
      damage: 1,
      knockback: 110,
      glaze: 'Plain',
      pierce: Pierce.Stops(),
    }))
    story(
      update,
      given(
        modifyFields(withArsenal(readyModel, holdingSpare(16)), {
          phase: () => fighting(2),
          bullets: () => parked,
        }),
      ),
      holdFire,
      tick(SHORT_FRAME_MS),
      model(({ bullets }) => {
        expect(bullets).toHaveLength(BULLET_MAX)
        expect(
          Array.filter(bullets, ({ weapon }) => weapon === 'Shotgun'),
        ).toHaveLength(5)
      }),
    )
  })
})

describe('zombies still need two pistol shots', () => {
  test('the pistol deals one damage per bullet', () => {
    const tough = zombieAt(100, 170, PLAYER_Y, { hp: ZOMBIE_MAX_HP })
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => fighting(1),
          zombies: () => [tough],
          bullets: () => [bulletInto(500, tough)],
        }),
      ),
      tick(SHORT_FRAME_MS),
      model(({ zombies, wallet }) => {
        expect(Array.map(zombies, ({ hp }) => hp)).toEqual([ZOMBIE_MAX_HP - 1])
        expect(wallet.balance).toBe(0)
      }),
    )
  })
})

describe('the stall entrance', () => {
  const expectShopOpensWalkingFrom = (
    start: Readonly<{ x: number; y: number }>,
    key: string,
  ) =>
    story(
      update,
      given(
        at(
          modifyFields(readyModel, { phase: () => preparing(2) }),
          start.x,
          start.y,
        ),
      ),
      press(key),
      ...ticks(2, FRAME_MS),
      Command.expectNone(),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(FRAME_MS),
      Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      model(({ shop }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
    )

  test('walking down onto the front of the stall opens the shop', () => {
    expectShopOpensWalkingFrom({ x: 265, y: 128 }, 'KeyS')
  })

  test('walking into the left or right side of the stall opens the shop', () => {
    expectShopOpensWalkingFrom({ x: 240, y: 160 }, 'KeyD')
    expectShopOpensWalkingFrom({ x: 300, y: 160 }, 'KeyA')
  })

  test('after leaving the shop at the side, it stays shut until the player steps well away', () => {
    story(
      update,
      given(
        at(modifyFields(readyModel, { phase: () => preparing(2) }), 251, 160),
      ),
      tick(FRAME_MS),
      Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      resolveCloseShop,
      ...ticks(10, FRAME_MS),
      Command.expectNone(),
      press('KeyA'),
      ...ticks(3, FRAME_MS),
      release('KeyA'),
      press('KeyD'),
      ...ticks(3, FRAME_MS),
      release('KeyD'),
      Command.expectNone(),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Dismissed())
      }),
      press('KeyA'),
      ...ticks(8, FRAME_MS),
      release('KeyA'),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
    )
  })

  test('touching the side of the stall mid-wave does not open the shop: it is only the ammo window', () => {
    story(
      update,
      given(
        at(modifyFields(readyModel, { phase: () => fighting(3) }), 240, 160),
      ),
      press('KeyD'),
      ...ticks(6, FRAME_MS),
      Command.expectNone(),
      model(current => {
        expect(current.shop).toEqual(ShopState.Away())
        expect(current.shopDialog.isOpen).toBe(false)
        expect(stallPrompt(current)).toBe('None')
      }),
    )
  })

  test('a prompt asks the player to walk up only while they are near an open stall', () => {
    const prepared = modifyFields(readyModel, { phase: () => preparing(2) })
    story(
      update,
      given(at(prepared, 160, 90)),
      tick(FRAME_MS),
      model(current => {
        expect(stallPrompt(current)).toBe('None')
      }),
    )
    story(
      update,
      given(at(prepared, 225, 160)),
      tick(FRAME_MS),
      model(current => {
        expect(stallPrompt(current)).toBe('WalkUp')
      }),
      press('KeyD'),
      ...ticks(6, FRAME_MS),
      tick(FRAME_MS),
      resolveShowShop,
      model(current => {
        expect(ShopState.guards.Browsing(current.shop)).toBe(true)
        expect(stallPrompt(current)).toBe('None')
      }),
    )
    story(
      update,
      given(
        at(modifyFields(readyModel, { phase: () => preparing(1) }), 225, 160),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(stallPrompt(current)).toBe('ClosedUntilFirstClear')
      }),
    )
  })

  test('once the player has shopped, the stall shows no words, only its sign and beacon', () => {
    const shopped = modifyFields(readyModel, {
      lessons: lessons =>
        modifyFields(lessons, { shop: () => Lesson.Learned({ atMs: 0 }) }),
    })
    const near = (phase: Phase): Model =>
      at(modifyFields(shopped, { phase: () => phase }), 225, 160)
    story(
      update,
      given(near(preparing(2))),
      tick(FRAME_MS),
      model(current => {
        expect(ShopState.guards.Away(current.shop)).toBe(true)
        expect(stallPrompt(current)).toBe('None')
      }),
    )
    story(
      update,
      given(near(fighting(3))),
      tick(FRAME_MS),
      model(current => {
        expect(stallPrompt(current)).toBe('None')
      }),
    )
    story(
      update,
      given(near(preparing(1))),
      tick(FRAME_MS),
      model(current => {
        expect(stallPrompt(current)).toBe('None')
      }),
    )
  })
})

describe('shop categories', () => {
  const WAVE_ONE_PAY = 6 * SHAMBLER_BOUNTY + waveBonus(1)

  const selectTab = (value: ShopCategory) =>
    message(
      toParentMessage(
        ShopTabsBinding,
        ShopTabsBlock.Message.SelectedTab({
          index: Option.getOrElse(
            Array.findFirstIndex(SHOP_CATEGORY_ORDER, tab => tab === value),
            () => 0,
          ),
          value,
        }),
      ),
    )

  const resolveFocusTab = Command.resolve(
    Tabs.test.FocusTab,
    ShopTabsBlock.Message.CompletedFocusTab(),
  )

  test('choosing a tab shows its items, focuses its first item, and moves keyboard focus to the tab', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 100))),
      model(({ shopCategory }) => {
        expect(shopCategory).toBe('Guns')
      }),
      selectTab('Traps'),
      Command.expectExact(Tabs.test.FocusTab),
      resolveFocusTab,
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Traps')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
      }),
      selectTab('Health'),
      resolveFocusTab,
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Health')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Heart' }))
      }),
    )
  })

  test('the shop reopens on the last tab chosen in the run, and a new run starts on Guns', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 100))),
      selectTab('Health'),
      resolveFocusTab,
      message(
        toParentMessage(
          ShopDialogBinding,
          DialogBlock.Message.RequestedClose(),
        ),
      ),
      // NOTE: the fixture browses with the dialog already down, which the
      // next frame takes as a dialog that failed to show.
      ...ticks(1, FRAME_MS),
      model(({ shop, shopCategory }) => {
        expect(shop).toEqual(ShopState.Dismissed())
        expect(shopCategory).toBe('Health')
      }),
    )

    story(
      update,
      given(
        modifyFields(besideStall(preparing(3)), {
          shopCategory: () => 'Traps',
        }),
      ),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      model(({ shop, shopCategory }) => {
        expect(shopCategory).toBe('Traps')
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Barricade' }))
      }),
    )

    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 4 }),
          shopCategory: () => 'Traps',
        }),
      ),
      ...ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS),
      press('Enter'),
      model(({ phase, shopCategory }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(shopCategory).toBe('Guns')
      }),
    )
  })

  test('tab Messages change nothing while the shop is closed', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => preparing(2),
          shop: () => ShopState.Away(),
        }),
      ),
      selectTab('Traps'),
      Command.expectNone(),
      model(({ shopCategory, shop }) => {
        expect(shopCategory).toBe('Guns')
        expect(shop).toEqual(ShopState.Away())
      }),
    )
  })

  test('each tab counts what the player can buy right now', () => {
    const firstVisit = browsing(withMoney(readyModel, WAVE_ONE_PAY))
    expect(affordableCount(firstVisit, 'Guns')).toBe(1)
    expect(affordableCount(firstVisit, 'Health')).toBe(0)
    expect(affordableCount(firstVisit, 'Traps')).toBe(0)
    expect(totalAffordable(firstVisit)).toBe(1)

    const hurt = withHp(firstVisit, PLAYER_MAX_HP - 2)
    expect(affordableCount(hurt, 'Health')).toBe(1)
    expect(totalAffordable(hurt)).toBe(2)

    const armed = withArsenal(withMoney(firstVisit, 50), holdingSpare(20))
    expect(affordableCount(armed, 'Guns')).toBe(2)

    expect(totalAffordable(withMoney(firstVisit, 0))).toBe(0)
  })

  test('the money from a clean wave 1 buys a first gun at the first visit', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, WAVE_ONE_PAY))),
      message(Message.ClickedBuyButton({ item: 'Shotgun' })),
      resolveFocusShopItem,
      model(({ wallet, player }) => {
        expect(wallet.balance).toBe(WAVE_ONE_PAY - SHOP_ITEMS.Shotgun.price)
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
        ).toEqual(Option.some('Shotgun'))
      }),
    )
  })

  test('every upgrade line starts cheap and gets steeper', () => {
    const lines: ReadonlyArray<WeaponKind> = ['Shotgun', 'Smg', 'Pistol']
    Array.forEach(lines, weapon => {
      const prices = Array.map(UPGRADE_TIERS[weapon], ({ price }) => price)
      const steps = Array.zipWith(
        prices,
        Array.drop(prices, 1),
        (lower, higher) => higher - lower,
      )
      expect(Array.every(steps, step => step > 0)).toBe(true)
    })
    expect(
      Option.map(Array.head(UPGRADE_TIERS.Smg), ({ price }) => price),
    ).toEqual(Option.some(60))
    expect(
      Option.map(Array.head(UPGRADE_TIERS.Shotgun), ({ price }) => price),
    ).toEqual(Option.some(40))
  })
})

describe('ammo and upgrades under the gun', () => {
  test('guns always go pistol, shotgun, machine gun, whether owned, in hand, or for sale', () => {
    const unarmed = browsing(withMoney(readyModel, 100))
    const weaponOrder = (current: Model): ReadonlyArray<WeaponKind> =>
      Array.map(gunShelves(current), ({ weapon }) => weapon)
    const PISTOL_FIRST: ReadonlyArray<WeaponKind> = ['Pistol', 'Shotgun', 'Smg']

    expect(weaponOrder(unarmed)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'Smg',
      'LaserSight',
    ])

    const shotgunInHand = withArsenal(unarmed, holdingSpare(20))
    expect(weaponOrder(shotgunInHand)).toEqual(PISTOL_FIRST)
    expect(itemsIn(shotgunInHand, 'Guns')).toEqual([
      'PistolUpgrade',
      'ShotgunShells',
      'ShotgunUpgrade',
      'Smg',
      'LaserSight',
    ])

    const shotgunHolstered = withArsenal(
      unarmed,
      holdingFirst(gun('Shotgun', 20)),
    )
    expect(weaponOrder(shotgunHolstered)).toEqual(PISTOL_FIRST)

    const smgInHand = withArsenal(unarmed, holdingSpare(60, 'Smg'))
    expect(weaponOrder(smgInHand)).toEqual(PISTOL_FIRST)
    expect(itemsIn(smgInHand, 'Guns')).toEqual([
      'PistolUpgrade',
      'Shotgun',
      'SmgRounds',
      'SmgUpgrade',
      'LaserSight',
    ])

    const smgHolstered = withArsenal(unarmed, holdingFirst(gun('Smg', 60)))
    expect(weaponOrder(smgHolstered)).toEqual(PISTOL_FIRST)
    expect(itemsIn(unarmed, 'Health')).toEqual(['Heart'])
  })

  test('buying a gun moves focus to its ammo, and buying ammo leaves focus where it is', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 200))),
      message(Message.PressedBuyKey({ item: 'Shotgun' })),
      Command.expectExact(FocusShopItem({ item: 'ShotgunShells' })),
      resolveFocusShopItem,
      model(({ shop }) => {
        expect(shop).toEqual(
          ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      Command.expectNone(),
      model(({ shop, player }) => {
        expect(shop).toEqual(
          ShopState.Browsing({ focusedItem: 'ShotgunShells' }),
        )
        expect(player.arsenal).toEqual(holdingSpare(32))
      }),
    )
  })

  test('swapping guns moves focus from the bought row to the new gun ammo', () => {
    story(
      update,
      given(
        focusedOn(
          withArsenal(browsing(withMoney(readyModel, 200)), holdingSpare(20)),
          'Smg',
        ),
      ),
      message(Message.ClickedBuyButton({ item: 'Smg' })),
      Command.expectExact(FocusShopItem({ item: 'SmgRounds' })),
      resolveFocusShopItem,
      model(({ shop, player }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'SmgRounds' }))
        expect(
          Option.map(maybeSpareGun(player.arsenal), ({ kind }) => kind),
        ).toEqual(Option.some('Smg'))
      }),
    )
  })

  test('a refused purchase leaves focus alone', () => {
    story(
      update,
      given(browsing(withMoney(readyModel, 10))),
      message(Message.PressedBuyKey({ item: 'Shotgun' })),
      Command.expectNone(),
      model(({ shop }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
      }),
    )
  })
})

describe('the row the shop opens on', () => {
  const focusAfterWalkingUp = (base: Model): Array<ShopItemId> => {
    const focused: Array<ShopItemId> = []
    story(
      update,
      given(base),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL, FRAME_MS),
      resolveShowShop,
      model(({ shop }) => {
        focused.push(
          Option.getOrThrow(
            Option.liftPredicate(shop, ShopState.guards.Browsing),
          ).focusedItem,
        )
      }),
    )
    return focused
  }

  const withSmg = (balance: number, rounds: number): Model =>
    withArsenal(
      withMoney(besideStall(preparing(4)), balance),
      holdingSecond(gun('Smg', rounds, 1)),
    )

  test('with only the pistol, it opens on a gun the player can afford', () => {
    expect(
      focusAfterWalkingUp(withMoney(besideStall(preparing(2)), 40)),
    ).toEqual(['Shotgun'])
  })

  test('with a spare gun running low, it opens on that gun ammo', () => {
    expect(focusAfterWalkingUp(withSmg(200, 40))).toEqual(['SmgRounds'])
  })

  test('with a full spare gun, it opens on its upgrade, never on a gun that would replace it', () => {
    expect(focusAfterWalkingUp(withSmg(200, 360))).toEqual(['SmgUpgrade'])
  })

  test('with nothing affordable, it opens on something to save up for', () => {
    expect(focusAfterWalkingUp(withSmg(5, 360))).toEqual(['SmgUpgrade'])
  })
})

describe('what Rattles says', () => {
  test('he cheers a buy and tells short money apart from a full gun', () => {
    story(
      update,
      given(
        withHp(
          withArsenal(
            browsing(withMoney(readyModel, 30)),
            holdingSecond(gun('Shotgun', 48)),
          ),
          3,
        ),
      ),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(ShopChatter.Greeting())
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunShells' })),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.Refused({ item: 'ShotgunShells' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'ShotgunUpgrade' })),
      model(({ shopChatter }) => {
        expect(shopChatter).toEqual(
          ShopChatter.TooPricey({ item: 'ShotgunUpgrade' }),
        )
      }),
      message(Message.PressedBuyKey({ item: 'Heart' })),
      model(({ shopChatter, wallet }) => {
        expect(shopChatter).toEqual(ShopChatter.Bought({ item: 'Heart' }))
        expect(wallet.balance).toBe(5)
      }),
      resolveFocusShopItem,
    )
  })
})
