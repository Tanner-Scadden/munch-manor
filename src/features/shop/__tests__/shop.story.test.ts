import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'
import { Dialog, DialogBlock } from '@foldkit/ui'

import { ShopDialogBinding } from '../../../app/bindings'
import { Message } from '../../../app/message'
import {
  type Bullet,
  type CarriedGun,
  GameEvent,
  Lesson,
  type Model,
  Phase,
  Pierce,
  ShopState,
} from '../../../app/model'
import {
  BULLET_MAX,
  COINS_PER_PURCHASE,
  DRY_FIRE_DELAY_MS,
  FIXED_STEP_MS,
  PLAYER_MAX_HP,
  SHAMBLER_BOUNTY,
  WAVE_BONUS_BASE,
  WAVE_BONUS_PER_WAVE,
  ZOMBIE_MAX_HP,
} from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  withArsenal,
  withPlayerAt,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  RESTART_GRACE_TICKS,
  bulletInto,
  buyAtCounter,
  closeDialog,
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
  zombieById,
} from '../../../test/testing'
import { WEAPONS, startingRounds } from '../../../world/gear/weapons'
import { focusOf, focusSlotOf, modifyFocus } from '../../../world/party/party'
import { noModifiers } from '../../../world/run/modifiers'
import {
  LASER_SIGHT_PRICE,
  SHOP_ITEMS,
  StockTag,
  itemsIn,
  stallPrompt,
  stockTag,
} from '../../../world/shop/shop'
import { FINAL_WAVE } from '../../../world/waves/wavePlans'
import { waveBonus } from '../../../world/waves/waves'
import { DialogBinding } from '../bindings'
import { Message as ShopMessage } from '../message'
import {
  FRAMES_TO_STALL,
  GRACE_TICK_MS,
  SHOP_FRAME_MS,
  besideStall,
  browsing,
  focusedOn,
  gun,
  holdingSpare,
  preparing,
  resolveFocusShopItem,
  resolveShowShop,
  shopReady,
  withHp,
  withMoney,
} from './shop.fixture'
// NOTE: one 60 Hz tick.
const SHORT_FRAME_MS = FIXED_STEP_MS
const PLAYER_Y = 90

const fighting = (wave: number): Phase =>
  Phase.Wave({ wave, elapsedMs: 0, spawns: [DISTANT_SPAWN] })

const doomed = zombieAt(100, 170, PLAYER_Y, { hp: 1 })

const killShot = (base: Model): Model =>
  modifyFields(base, {
    zombies: () => [doomed],
    bullets: () => [bulletInto(500, doomed)],
  })

const preparationRemainingMs = (phase: Phase): number =>
  Option.getOrThrow(Option.liftPredicate(phase, Phase.guards.Preparation))
    .remainingMs

describe('money', () => {
  it.effect('a Shambler kill pays its bounty and shows it as a coin pop', () =>
    Story.story(
      APPLICATION,
      Story.given(
        killShot(modifyFields(shopReady, { phase: () => fighting(1) })),
      ),
      tick(SHORT_FRAME_MS),
      Story.model(({ seats: [{ wallet }], popups, frameEvents }) => {
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
    ),
  )

  it.effect(
    'clearing a wave pays the bonus for that wave on top of the kill',
    () => {
      const wave = 2
      return Story.story(
        APPLICATION,
        Story.given(
          killShot(
            modifyFields(shopReady, {
              phase: () => Phase.Wave({ wave, elapsedMs: 0, spawns: [] }),
            }),
          ),
        ),
        tick(SHORT_FRAME_MS),
        Story.model(({ phase, seats: [{ wallet }], popups, frameEvents }) => {
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
    },
  )

  it.effect(
    'the final wave pays too, and Victory keeps what was earned after spending',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          killShot(
            modifyFocus(
              modifyFields(shopReady, {
                phase: () =>
                  Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 0, spawns: [] }),
              }),
              { wallet: () => ({ balance: 10, earned: 200, shown: 10 }) },
            ),
          ),
        ),
        tick(SHORT_FRAME_MS),
        Story.model(({ phase, seats: [{ wallet }] }) => {
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
        Story.model(({ seats: [{ wallet, player }] }) => {
          expect(wallet).toEqual({ balance: 0, earned: 0, shown: 0 })
          expect(player.arsenal).toEqual(pistolOnly())
        }),
      ),
  )

  it.effect('the HUD counter ticks toward the balance instead of jumping', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(modifyFields(shopReady, { phase: () => preparing(2) }), {
          wallet: () => ({ balance: 60, earned: 60, shown: 0 }),
        }),
      ),
      tick(SHORT_FRAME_MS),
      Story.model(({ seats: [{ wallet }] }) => {
        expect(wallet.shown).toBeGreaterThan(0)
        expect(wallet.shown).toBeLessThan(60)
      }),
      ...ticks(60, SHORT_FRAME_MS),
      Story.model(({ seats: [{ wallet }] }) => {
        expect(wallet.shown).toBe(60)
      }),
    ),
  )
})

describe('the shop stall', () => {
  it.effect('walking up to the stall during preparation opens the shop', () =>
    Story.story(
      APPLICATION,
      Story.given(besideStall(preparing(2))),
      press('KeyD'),
      ...ticks(FRAMES_TO_STALL - 1, SHOP_FRAME_MS),
      Story.model(({ seats: [{ shop }] }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(SHOP_FRAME_MS),
      Story.Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      Story.model(({ seats: [{ shop }], shopDialog, input }) => {
        expect(shop).toEqual(ShopState.Browsing({ focusedItem: 'Shotgun' }))
        expect(shopDialog.dialog.isOpen).toBe(true)
        expect(input.pressedKeys).toEqual([])
      }),
    ),
  )

  it.effect(
    'the stall stays closed during a wave and during the wave 1 tutorial',
    () =>
      Effect.gen(function* () {
        const walkUpDuring = (phase: Phase) =>
          Story.story(
            APPLICATION,
            Story.given(besideStall(phase)),
            press('KeyD'),
            ...ticks(FRAMES_TO_STALL + 2, SHOP_FRAME_MS),
            Story.Command.expectNone(),
            Story.model(({ seats: [{ shop }], shopDialog }) => {
              expect(shop).toEqual(ShopState.Away())
              expect(shopDialog.dialog.isOpen).toBe(false)
            }),
          )

        yield* walkUpDuring(fighting(3))
        yield* walkUpDuring(preparing(1))
      }),
  )

  it.effect(
    'a player who ends a wave at the stall gets the shop once preparation begins',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          killShot(
            modifyFields(withPlayerAt(shopReady, 270, 144), {
              phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
            }),
          ),
        ),
        tick(SHORT_FRAME_MS),
        Story.model(({ phase, seats: [{ shop }] }) => {
          expect(Phase.guards.Preparation(phase)).toBe(true)
          expect(shop).toEqual(ShopState.Away())
        }),
        tick(SHOP_FRAME_MS),
        Story.Command.expectExact(Dialog.test.ShowDialog),
        resolveShowShop,
        Story.model(({ seats: [{ shop }], shopDialog }) => {
          expect(ShopState.guards.Browsing(shop)).toBe(true)
          expect(shopDialog.dialog.isOpen).toBe(true)
        }),
      ),
  )

  it.effect('the stall blocks movement like cover', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(withPlayerAt(shopReady, 270, 142), {
          phase: () => fighting(2),
        }),
      ),
      press('KeyS'),
      ...ticks(20, SHOP_FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.y).toBeCloseTo(146)
      }),
    ),
  )

  it.effect(
    'the preparation countdown pauses while the shop is open, and the player cannot move or shoot',
    () => {
      const frozen: Array<Model> = []
      return Story.story(
        APPLICATION,
        Story.given(besideStall(preparing(2))),
        press('KeyD'),
        ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
        resolveShowShop,
        Story.model(current => {
          frozen.push(current)
        }),
        press('KeyD'),
        holdFire,
        press('Enter'),
        ...ticks(10, SHOP_FRAME_MS),
        Story.model(
          ({ phase, seats: [{ player, intent }], bullets, elapsedMs }) => {
            const opened = Option.getOrThrow(Array.head(frozen))
            expect(preparationRemainingMs(phase)).toBe(
              preparationRemainingMs(opened.phase),
            )
            expect(player.x).toBe(focusOf(opened).player.x)
            expect(bullets).toEqual([])
            expect(intent.trigger).toBe('Released')
            expect(elapsedMs).toBeCloseTo(opened.elapsedMs + 10 * SHOP_FRAME_MS)
          },
        ),
      )
    },
  )

  it.effect(
    'closing the shop resumes the countdown and it reopens only after stepping away',
    () =>
      Story.story(
        APPLICATION,
        Story.given(besideStall(preparing(2))),
        press('KeyD'),
        ...ticks(FRAMES_TO_STALL, SHOP_FRAME_MS),
        resolveShowShop,
        release('KeyD'),
        Story.messageIn(
          [ShopDialogBinding, DialogBinding],
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(ShopState.Dismissed())
        }),
        tick(SHOP_FRAME_MS),
        Story.model(({ phase }) => {
          expect(preparationRemainingMs(phase)).toBeLessThan(15_000)
        }),
        press('KeyD'),
        ...ticks(2, SHOP_FRAME_MS),
        release('KeyD'),
        Story.Command.expectNone(),
        press('KeyA'),
        ...ticks(4, SHOP_FRAME_MS),
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(ShopState.Dismissed())
        }),
        ...ticks(2, SHOP_FRAME_MS),
        release('KeyA'),
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(ShopState.Away())
        }),
        press('KeyD'),
        ...ticks(3, SHOP_FRAME_MS),
        Story.Command.expectNone(),
        tick(SHOP_FRAME_MS),
        Story.Command.expectExact(Dialog.test.ShowDialog),
        resolveShowShop,
        Story.model(({ seats: [{ shop }] }) => {
          expect(ShopState.guards.Browsing(shop)).toBe(true)
        }),
      ),
  )

  it.effect(
    'Escape and the start wave keys do nothing to the game while the shop is open',
    () => {
      const shopping = browsing(withMoney(shopReady, 0))
      return Story.story(
        APPLICATION,
        Story.given(shopping),
        press('Escape'),
        press('Enter'),
        press('KeyR'),
        press('KeyQ'),
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(({ phase, seats: [{ player }] }) => {
          expect(phase).toEqual(shopping.phase)
          expect(player.arsenal).toEqual(focusOf(shopping).player.arsenal)
        }),
      )
    },
  )
})

describe('buying', () => {
  it.effect(
    'buying a gun deducts its price, puts it in the second slot, and bursts coins',
    () =>
      Story.story(
        APPLICATION,
        Story.given(browsing(withMoney(shopReady, 100))),
        buyAtCounter('Shotgun'),
        resolveFocusShopItem,
        Story.model(({ seats: [{ wallet, player }], particles }) => {
          expect(wallet.balance).toBe(100 - SHOP_ITEMS.Shotgun.price)
          expect(wallet.earned).toBe(100)
          expect(player.arsenal).toEqual(holdingSpare(16))
          expect(
            Array.filter(particles, ({ kind }) => kind === 'Coin'),
          ).toHaveLength(COINS_PER_PURCHASE)
        }),
        Story.messageIn(
          ShopDialogBinding,
          ShopMessage.PressedBuyKey({ item: 'ShotgunShells' }),
        ),
        Story.model(({ seats: [{ wallet, player }] }) => {
          expect(wallet.balance).toBe(
            100 - SHOP_ITEMS.Shotgun.price - SHOP_ITEMS.ShotgunShells.price,
          )
          expect(player.arsenal).toEqual(holdingSpare(32))
        }),
      ),
  )

  it.effect('a new gun replaces the one in hand, and the other gun stays', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withArsenal(
          browsing(withMoney(shopReady, 200)),
          holdingSecond(gun('Shotgun', 3)),
        ),
      ),
      buyAtCounter('Smg'),
      Story.model(({ seats: [{ player, wallet }] }) => {
        expect(player.arsenal).toEqual(
          holdingSecond(gun('Smg', startingRounds('Smg'))),
        )
        expect(wallet.balance).toBe(200 - SHOP_ITEMS.Smg.price)
      }),
    ),
  )

  it.effect('a heart heals one and is refused at full hearts', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withHp(browsing(withMoney(shopReady, 60)), PLAYER_MAX_HP - 1),
      ),
      buyAtCounter('Heart'),
      Story.model(({ seats: [{ player, wallet }] }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
      buyAtCounter('Heart'),
      Story.model(({ seats: [{ player, wallet }] }) => {
        expect(player.hp).toBe(PLAYER_MAX_HP)
        expect(wallet.balance).toBe(60 - SHOP_ITEMS.Heart.price)
      }),
    ),
  )

  it.effect(
    'a Glass run sells no heart: the shelf marks it done and the buy is refused',
    () =>
      Effect.gen(function* () {
        const glass = modifyFields(
          withHp(browsing(withMoney(shopReady, 200)), 1),
          {
            modifiers: () => ({ ...noModifiers, glass: true }),
          },
        )
        yield* Story.story(
          APPLICATION,
          Story.given(glass),
          Story.model(current => {
            expect(stockTag(current, focusSlotOf(current), 'Heart')).toEqual(
              StockTag.Done({ label: 'GLASS' }),
            )
          }),
          buyAtCounter('Heart'),
          Story.model(current => {
            expect(focusOf(current).player.hp).toBe(1)
            expect(focusOf(current).wallet.balance).toBe(200)
            expect(current.particles).toEqual([])
          }),
        )
        const plain = withHp(browsing(withMoney(shopReady, 200)), 1)
        expect(stockTag(plain, focusSlotOf(plain), 'Heart')._tag).toBe('Price')
      }),
  )

  it.effect(
    'purchases are refused when broke, without the gun, when full, or already owned',
    () =>
      Effect.gen(function* () {
        const refused = (start: Model, item: typeof SHOP_ITEMS.Heart.id) =>
          Story.story(
            APPLICATION,
            Story.given(start),
            buyAtCounter(item),
            Story.model(current => {
              expect(focusOf(current).wallet).toEqual(focusOf(start).wallet)
              expect(focusOf(current).player).toEqual(focusOf(start).player)
              expect(current.particles).toEqual([])
            }),
          )

        yield* refused(withHp(browsing(withMoney(shopReady, 24)), 2), 'Heart')
        yield* refused(browsing(withMoney(shopReady, 500)), 'ShotgunShells')
        yield* refused(
          withArsenal(browsing(withMoney(shopReady, 500)), holdingSpare(48)),
          'ShotgunShells',
        )
        yield* refused(
          withArsenal(browsing(withMoney(shopReady, 500)), holdingSpare(5)),
          'Shotgun',
        )
        yield* refused(withMoney(shopReady, 500), 'Shotgun')
      }),
  )

  it.effect(
    'the laser sight is dear, fits once, lists last under GUNS, and goes with the run',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(browsing(withMoney(shopReady, LASER_SIGHT_PRICE - 1))),
          Story.model(current => {
            expect(
              Array.last(itemsIn(current, focusSlotOf(current), 'Guns')),
            ).toEqual(Option.some('LaserSight'))
          }),
          buyAtCounter('LaserSight'),
          Story.model(({ seats: [{ laserSight, wallet }] }) => {
            expect(laserSight).toBe('None')
            expect(wallet.balance).toBe(LASER_SIGHT_PRICE - 1)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(browsing(withMoney(shopReady, LASER_SIGHT_PRICE + 10))),
          buyAtCounter('LaserSight'),
          Story.model(({ seats: [{ laserSight, wallet }] }) => {
            expect(laserSight).toBe('Fitted')
            expect(wallet.balance).toBe(10)
          }),
          buyAtCounter('LaserSight'),
          Story.model(({ seats: [{ wallet }] }) => {
            expect(wallet.balance).toBe(10)
          }),
        )
      }),
  )

  it.effect('ammo tops up to the cap', () =>
    Story.story(
      APPLICATION,
      Story.given(
        focusedOn(
          withArsenal(browsing(withMoney(shopReady, 100)), holdingSpare(40)),
          'ShotgunShells',
        ),
      ),
      buyAtCounter('ShotgunShells'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(holdingSpare(48))
      }),
    ),
  )
})

describe('carrying two guns', () => {
  const armed = modifyFields(
    withArsenal(shopReady, holdingFirst(gun('Shotgun', 16))),
    { phase: () => fighting(2) },
  )

  it.effect('Q and the swap button switch guns', () => {
    const spare = holdingSecond(gun('Shotgun', 16))
    const pistol = holdingFirst(gun('Shotgun', 16))
    return Story.story(
      APPLICATION,
      Story.given(armed),
      press('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(spare)
      }),
      press('KeyQ'),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(pistol)
      }),
      Story.message(Message.ClickedSwapButton()),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(spare)
      }),
    )
  })

  it.effect('with only the pistol there is nothing to swap to', () =>
    Story.story(
      APPLICATION,
      Story.given(modifyFields(shopReady, { phase: () => fighting(1) })),
      press('KeyQ'),
      Story.message(Message.ClickedSwapButton()),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    ),
  )

  it.effect('the shotgun spends one shell for seven pellets', () =>
    Story.story(
      APPLICATION,
      Story.given(withArsenal(armed, holdingSpare(16))),
      holdFire,
      tick(SHORT_FRAME_MS),
      Story.model(({ bullets, seats: [{ player }], frameEvents }) => {
        expect(bullets).toHaveLength(WEAPONS.Shotgun.pellets)
        expect(bullets).toHaveLength(7)
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
    ),
  )

  it.effect(
    'a gun that runs dry clicks, pops EMPTY, and swaps to the pistol',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withArsenal(armed, holdingSpare(1, 'Smg'))),
        holdFire,
        tick(SHORT_FRAME_MS),
        Story.model(({ seats: [{ player }], bullets }) => {
          expect(player.arsenal).toEqual(holdingSpare(0, 'Smg'))
          expect(bullets).toHaveLength(1)
        }),
        ...ticks(
          Math.ceil(WEAPONS.Smg.fireIntervalMs / SHORT_FRAME_MS),
          SHORT_FRAME_MS,
        ),
        Story.model(({ seats: [{ player }], frameEvents, popups }) => {
          expect(player.arsenal).toEqual(holdingFirst(gun('Smg', 0)))
          expect(Array.map(frameEvents, ({ _tag }) => _tag)).toContain('RanDry')
          expect(Array.map(popups, ({ kind }) => kind)).toContain('Empty')
          expect(player.fireCooldownMs).toBe(DRY_FIRE_DELAY_MS)
        }),
        ...ticks(
          Math.ceil(DRY_FIRE_DELAY_MS / SHORT_FRAME_MS) + 1,
          SHORT_FRAME_MS,
        ),
        Story.model(({ bullets }) => {
          expect(Array.some(bullets, ({ weapon }) => weapon === 'Pistol')).toBe(
            true,
          )
        }),
      ),
  )
})

describe('shotgun spread', () => {
  // NOTE: the pellets one blast fires, read off the Story's final Model.
  const blastWith = (seed: number) =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(withArsenal(shopReady, holdingSpare(16)), {
          phase: () => fighting(2),
          rngState: () => seed,
        }),
      ),
      holdFire,
      tick(SHORT_FRAME_MS),
    ).pipe(Effect.map(({ bullets }) => bullets))

  it.effect(
    'a seed fixes the pellet spread, and every pellet stays inside the cone',
    () =>
      Effect.gen(function* () {
        const first = yield* blastWith(1234)
        const again = yield* blastWith(1234)
        const other = yield* blastWith(98765)
        expect(again).toEqual(first)
        expect(other).not.toEqual(first)
        expect(first).toHaveLength(7)
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
        ).toHaveLength(7)
      }),
  )

  it.effect(
    'the bullet count stays capped when the room is full of pellets',
    () => {
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
      return Story.story(
        APPLICATION,
        Story.given(
          modifyFields(withArsenal(shopReady, holdingSpare(16)), {
            phase: () => fighting(2),
            bullets: () => parked,
          }),
        ),
        holdFire,
        tick(SHORT_FRAME_MS),
        Story.model(({ bullets }) => {
          expect(bullets).toHaveLength(BULLET_MAX)
          expect(
            Array.filter(bullets, ({ weapon }) => weapon === 'Shotgun'),
          ).toHaveLength(7)
        }),
      )
    },
  )
})

describe('the Barn Buster up close', () => {
  const CLOSE_PX = 24
  const BLASTS_MS = 2000

  // NOTE: the damage a gun deals to a Groaner that cannot die, standing
  // CLOSE_PX in front of the player, over BLASTS_MS of held fire.
  const damageUpClose = (kind: CarriedGun['kind']) => {
    const start = withArsenal(shopReady, holdingSpare(48, kind))
    const target = zombieAt(
      100,
      focusOf(start).player.x + CLOSE_PX,
      focusOf(start).player.y,
      {
        hp: 99,
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(start, {
          phase: () => fighting(2),
          rngState: () => 1234,
          zombies: () => [target],
        }),
      ),
      holdFire,
      ...ticks(Math.round(BLASTS_MS / SHORT_FRAME_MS), SHORT_FRAME_MS),
    ).pipe(Effect.map(current => target.hp - zombieById(current, target.id).hp))
  }

  it.effect("one blast drops a Groaner at arm's length", () => {
    const start = withArsenal(shopReady, holdingSpare(16))
    const groaner = zombieAt(
      100,
      focusOf(start).player.x + CLOSE_PX,
      focusOf(start).player.y,
    )
    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(start, {
          phase: () => fighting(2),
          rngState: () => 1234,
          zombies: () => [groaner],
        }),
      ),
      holdFire,
      ...ticks(8, SHORT_FRAME_MS),
      Story.model(({ stats }) => {
        expect(stats.shotsFired).toBe(WEAPONS.Shotgun.pellets)
        expect(stats.kills.Shambler).toBe(1)
      }),
    )
  })

  it.effect('up close it out-hits the Pop Pistol', () =>
    Effect.gen(function* () {
      const pistol = yield* damageUpClose('Pistol')
      const shotgun = yield* damageUpClose('Shotgun')
      expect(shotgun).toBeGreaterThan(pistol * 1.2)
    }),
  )
})

describe('zombies still need two pistol shots', () => {
  it.effect('the pistol deals one damage per bullet', () => {
    const tough = zombieAt(100, 170, PLAYER_Y, { hp: ZOMBIE_MAX_HP })
    return Story.story(
      APPLICATION,
      Story.given(
        modifyFields(shopReady, {
          phase: () => fighting(1),
          zombies: () => [tough],
          bullets: () => [bulletInto(500, tough)],
        }),
      ),
      tick(SHORT_FRAME_MS),
      Story.model(({ zombies, seats: [{ wallet }] }) => {
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
    Story.story(
      APPLICATION,
      Story.given(
        withPlayerAt(
          modifyFields(shopReady, { phase: () => preparing(2) }),
          start.x,
          start.y,
        ),
      ),
      press(key),
      ...ticks(2, SHOP_FRAME_MS),
      Story.Command.expectNone(),
      Story.model(({ seats: [{ shop }] }) => {
        expect(shop).toEqual(ShopState.Away())
      }),
      tick(SHOP_FRAME_MS),
      Story.Command.expectExact(Dialog.test.ShowDialog),
      resolveShowShop,
      Story.model(({ seats: [{ shop }] }) => {
        expect(ShopState.guards.Browsing(shop)).toBe(true)
      }),
    )

  it.effect('walking down onto the front of the stall opens the shop', () =>
    expectShopOpensWalkingFrom({ x: 265, y: 128 }, 'KeyS'),
  )

  it.effect(
    'walking into the left or right side of the stall opens the shop',
    () =>
      Effect.gen(function* () {
        yield* expectShopOpensWalkingFrom({ x: 240, y: 160 }, 'KeyD')
        yield* expectShopOpensWalkingFrom({ x: 300, y: 160 }, 'KeyA')
      }),
  )

  it.effect(
    'after leaving the shop at the side, it stays shut until the player steps well away',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withPlayerAt(
            modifyFields(shopReady, { phase: () => preparing(2) }),
            251,
            160,
          ),
        ),
        tick(SHOP_FRAME_MS),
        Story.Command.expectExact(Dialog.test.ShowDialog),
        resolveShowShop,
        Story.messageIn(
          [ShopDialogBinding, DialogBinding],
          DialogBlock.Message.CanceledDialog(),
        ),
        closeDialog(),
        ...ticks(10, SHOP_FRAME_MS),
        Story.Command.expectNone(),
        press('KeyA'),
        ...ticks(3, SHOP_FRAME_MS),
        release('KeyA'),
        press('KeyD'),
        ...ticks(3, SHOP_FRAME_MS),
        release('KeyD'),
        Story.Command.expectNone(),
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(ShopState.Dismissed())
        }),
        press('KeyA'),
        ...ticks(8, SHOP_FRAME_MS),
        release('KeyA'),
        Story.model(({ seats: [{ shop }] }) => {
          expect(shop).toEqual(ShopState.Away())
        }),
      ),
  )

  it.effect(
    'touching the side of the stall mid-wave does not open the shop: it is only the ammo window',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withPlayerAt(
            modifyFields(shopReady, { phase: () => fighting(3) }),
            240,
            160,
          ),
        ),
        press('KeyD'),
        ...ticks(6, SHOP_FRAME_MS),
        Story.Command.expectNone(),
        Story.model(current => {
          expect(focusOf(current).shop).toEqual(ShopState.Away())
          expect(current.shopDialog.dialog.isOpen).toBe(false)
          expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
        }),
      ),
  )

  it.effect(
    'a prompt asks the player to walk up only while they are near an open stall',
    () =>
      Effect.gen(function* () {
        const prepared = modifyFields(shopReady, { phase: () => preparing(2) })
        yield* Story.story(
          APPLICATION,
          Story.given(withPlayerAt(prepared, 160, 90)),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(withPlayerAt(prepared, 225, 160)),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(stallPrompt(current, focusSlotOf(current))).toBe('WalkUp')
          }),
          press('KeyD'),
          ...ticks(6, SHOP_FRAME_MS),
          tick(SHOP_FRAME_MS),
          resolveShowShop,
          Story.model(current => {
            expect(ShopState.guards.Browsing(focusOf(current).shop)).toBe(true)
            expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            withPlayerAt(
              modifyFields(shopReady, { phase: () => preparing(1) }),
              225,
              160,
            ),
          ),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(stallPrompt(current, focusSlotOf(current))).toBe(
              'ClosedUntilFirstClear',
            )
          }),
        )
      }),
  )

  it.effect(
    'once the player has shopped, the stall shows no words, only its sign and beacon',
    () =>
      Effect.gen(function* () {
        const shopped = modifyFields(shopReady, {
          lessons: lessons =>
            modifyFields(lessons, { shop: () => Lesson.Learned({ atMs: 0 }) }),
        })
        const near = (phase: Phase): Model =>
          withPlayerAt(modifyFields(shopped, { phase: () => phase }), 225, 160)
        yield* Story.story(
          APPLICATION,
          Story.given(near(preparing(2))),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(ShopState.guards.Away(focusOf(current).shop)).toBe(true)
            expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(near(fighting(3))),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(near(preparing(1))),
          tick(SHOP_FRAME_MS),
          Story.model(current => {
            expect(stallPrompt(current, focusSlotOf(current))).toBe('None')
          }),
        )
      }),
  )
})
