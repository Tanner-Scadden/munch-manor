import { Array, Option, pipe } from 'effect'

import { SHOP_NEAR_PX, SHOP_REACH_PX } from './constants'
import type { Offer } from './purchase'
import { STALL_BOX, priceFor, purchase } from './shop'
import { heldGun, maxRounds } from './weapons'
import type { World } from './world'
import {
  type CarriedGun,
  type FixedShopItemId,
  Phase,
  Purchasable,
  type WeaponKind,
} from './worldSchema'

// The ammo window (decided with the owner on 2026-10-30): mid-wave, the
// stall's CLOSED sign becomes a small window where Rattles sells the ammo of
// the gun in the player's hands, at the shop's price, by a tap there (since
// 2026-10-31) or the same stand or hold as any purchase in the world
// (src/purchase.ts, tapToBuy). It sells nothing
// else mid-wave: guns, traps, upgrades, hearts, and repairs wait for the
// break, when the full shop opens. A gun with nothing to refill (the Pop
// Pistol, the Clang Pan, Brain Freeze) gets no offer; a full one shows FULL.
// In co-op each player buys for themselves, as any purchase.

export type AmmoItemId = Extract<
  FixedShopItemId,
  'ShotgunShells' | 'SmgRounds' | 'LidStack'
>

// NOTE: the shop's own ammo for each gun that takes it.
const AMMO_ITEMS: Readonly<Partial<Record<WeaponKind, AmmoItemId>>> = {
  Shotgun: 'ShotgunShells',
  Smg: 'SmgRounds',
  Cooker: 'LidStack',
}

export const maybeAmmoItemOf = (kind: WeaponKind): Option.Option<AmmoItemId> =>
  Option.fromNullishOr(AMMO_ITEMS[kind])

const isFullGun = (gun: CarriedGun): boolean =>
  gun.rounds >= maxRounds(gun.kind, gun.tier)

const COUNTER_TAG_DROP_PX = 4
const COUNTER_TAG_LEFT_PX = 18

// NOTE: the window's tag hangs beside the stall, on its left, so it never
// covers the AMMO sign or Rattles.
const COUNTER_SPOT = {
  x: STALL_BOX.left - COUNTER_TAG_LEFT_PX,
  y: STALL_BOX.top + COUNTER_TAG_DROP_PX,
}

export const isCounterOpen = (world: World): boolean =>
  Phase.isAnyOf(['Wave'])(world.phase)

export const ammoCounterOffers = (world: World): ReadonlyArray<Offer> =>
  isCounterOpen(world)
    ? pipe(
        maybeAmmoItemOf(heldGun(world.player.arsenal).kind),
        Option.map((item): Offer => ({
          target: Purchasable.Ammo(),
          price: priceFor(world, item),
          box: STALL_BOX,
          reachPx: SHOP_REACH_PX,
          spot: COUNTER_SPOT,
          isFull: isFullGun(heldGun(world.player.arsenal)),
        })),
        Option.toArray,
      )
    : []

// NOTE: the sale: the held gun's ammo, through the shop's own purchase, so
// the price, the cap, and the stats are the shop's.
export const sellAmmo = (world: World): Option.Option<World> =>
  isCounterOpen(world)
    ? Option.flatMap(
        maybeAmmoItemOf(heldGun(world.player.arsenal).kind),
        item => purchase(world, item),
      )
    : Option.none()

// THE SALE

// NOTE: what Rattles says as he slides the rounds across, a different line
// each sale. Kept here, away from the shop dialog's lines, so the World's
// purchase step never loads the views.
export const COUNTER_LINES: Array.NonEmptyReadonlyArray<string> = [
  'FRESH ROUNDS!',
  'NO REFUNDS',
  'AIM FOR THE FACE',
  'HURRY BACK!',
  "DON'T WASTE EM",
]

// NOTE: a player standing at the window wakes Rattles up.
export const isAtAmmoWindow = (world: World): boolean =>
  Array.some(
    ammoCounterOffers(world),
    offer =>
      Math.hypot(
        Math.max(
          offer.box.left - world.player.x,
          0,
          world.player.x - offer.box.right,
        ),
        Math.max(
          offer.box.top - world.player.y,
          0,
          world.player.y - offer.box.bottom,
        ),
      ) <= SHOP_NEAR_PX,
  )
