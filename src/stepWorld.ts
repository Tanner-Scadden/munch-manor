import { Array, Option, Result, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import { ZERO_VECTOR } from './geometry'
import {
  forEachSeat,
  isCoop,
  isDowned,
  isHere,
  isStanding,
  modifySeat,
  seatStateAt,
} from './party'
import { tapToBuy } from './purchase'
import { markReady } from './revive'
import {
  SHOP_CATEGORY_ORDER,
  isShopOpenFor,
  itemsIn,
  suggestedItem,
  tryPurchase,
} from './shop'
import { advanceTick } from './simulation'
import { cycleTrap, maybeSelectedKind, placeTrapIn } from './traps'
import { isRoundActive, startWaveEarly } from './waves'
import {
  beginReload,
  canReload,
  drawMelee,
  drawSlot,
  heldSlotOf,
  isWieldingMelee,
  swapInHand,
} from './weapons'
import type { World } from './world'
import {
  type GameEvent,
  GunSlot,
  type Intent,
  Phase,
  type Player,
  type PlayerSlot,
  SOLO_SLOT,
  type ShopCategory,
  ShopItemId,
  ShopState,
  idleIntent,
} from './worldSchema'

// The pure 60 Hz tick a co-op room runs (MULTIPLAYER.md, Phase 0): the
// World and each player's intent in, the next World and the tick's events
// out. No UI, art, audio, camera, or store: `tools/world/bundle.ts` checks
// that its imports stay that way, and the determinism harness runs it in
// workerd.

// NOTE: players are keyed by their room slot. Single player is the one
// entry at SOLO_SLOT, and a missing entry intends nothing.
export { type PlayerSlot }

export type InputsByPlayer = ReadonlyMap<PlayerSlot, Intent>

export type Stepped = Readonly<{
  world: World
  events: ReadonlyArray<GameEvent>
  // NOTE: how much world time the tick ran: none while hit-stop holds it.
  worldMs: number
}>

export const soloInputs = (intent: Intent): InputsByPlayer =>
  new Map([[SOLO_SLOT, intent]])

const inputOf = (inputsByPlayer: InputsByPlayer, slot: PlayerSlot): Intent =>
  Option.getOrElse(
    Option.fromNullishOr(inputsByPlayer.get(slot)),
    () => idleIntent,
  )

// NOTE: an away player stands frozen (decided row 10). A downed one crawls
// (decided row 4) and a bled-out one lies still; both aim, and their
// trigger swings the melee slot, never the gun (swingWhileDown in
// src/simulation.ts).
const intentFor = (world: World, slot: PlayerSlot, intent: Intent): Intent => {
  if (!isCoop(world)) {
    return intent
  }
  const { seat } = seatStateAt(world, slot)
  if (!isHere(seat)) {
    return idleIntent
  }
  if (isStanding(seat)) {
    return intent
  }
  return modifyFields(intent, {
    move: move => (isDowned(seat) ? move : ZERO_VECTOR),
    interact: () => 'Released',
  })
}

export const stepWorld = (
  world: World,
  inputsByPlayer: InputsByPlayer,
): Stepped => {
  const intended = forEachSeat(world, (current, slot) =>
    modifySeat(current, slot, {
      intent: () => intentFor(current, slot, inputOf(inputsByPlayer, slot)),
    }),
  )
  const ticked = advanceTick(intended)
  return {
    world: ticked.world,
    events: ticked.world.frameEvents,
    worldMs: ticked.worldMs,
  }
}

// ACTIONS

// NOTE: a player's presses, as actions on their own seat (MULTIPLAYER.md,
// Phase 1): swapping, drawing the knife or a gun by its slot, reloading,
// traps, the shop's buys and its leaving (decided row 8), and READY
// (decided 7). Each action's rule lives here once. The room applies a
// seat's presses between ticks; single player applies its own presses to
// its lead seat (src/update/action.ts) and wraps its cues around them.
// A purchasable in the world is no press: it is bought by holding the
// intent's interact, in the tick (src/purchase.ts). The ammo window is the
// one press among them: BuyAmmo, a tap that buys there at once.
export const SeatAction = defineTaggedUnion({
  Swap: {},
  Melee: {},
  Draw: { slot: GunSlot },
  Reload: {},
  PlaceTrap: {},
  NextTrap: {},
  Buy: { item: ShopItemId },
  LeaveCounter: {},
  Ready: {},
  BuyAmmo: {},
})
export type SeatAction = typeof SeatAction.Type

// NOTE: why an action left the World as it was. NotNow is no moment for
// it (out of the fight, away from the counter, nothing to place): the
// client stays quiet. Refused is a try the game turns down, with the
// reason a client can show (the trap notice, Rattles' grumble).
export const ActionRefusal = defineTaggedUnion({
  NotNow: {},
  Refused: { reason: Schema.String },
})
export type ActionRefusal = typeof ActionRefusal.Type

export type ActionResult = Result.Result<World, ActionRefusal>

const notNow: ActionResult = Result.fail(ActionRefusal.NotNow())

const refused = (reason: string): ActionRefusal =>
  ActionRefusal.Refused({ reason })

const isFighting = (world: World, slot: PlayerSlot): boolean => {
  const { seat, shop } = seatStateAt(world, slot)
  return (
    isRoundActive(world.phase) &&
    isStanding(seat) &&
    !ShopState.isAnyOf(['Browsing'])(shop)
  )
}

const whenFighting =
  (act: (world: World, slot: PlayerSlot) => ActionResult) =>
  (world: World, slot: PlayerSlot): ActionResult =>
    isFighting(world, slot) ? act(world, slot) : notNow

const inHand = (change: (player: Player) => Player) =>
  whenFighting((world, slot) =>
    Result.succeed(modifySeat(world, slot, { player: change })),
  )

const swap = inHand(swapInHand)

const melee = inHand(drawMelee)

const draw = (world: World, slot: PlayerSlot, gun: GunSlot): ActionResult =>
  inHand(player => drawSlot(player, gun))(world, slot)

// NOTE: with the knife out, a reload puts the last gun back in hand first,
// even when that gun cannot reload.
const reload = (world: World, slot: PlayerSlot): ActionResult => {
  const { player } = seatStateAt(world, slot)
  const drawn = isWieldingMelee(player)
    ? draw(world, slot, heldSlotOf(player.arsenal))
    : notNow
  const inHandNow = Result.getOrElse(drawn, () => world)
  return isFighting(inHandNow, slot) &&
    canReload(seatStateAt(inHandNow, slot).player)
    ? Result.succeed(modifySeat(inHandNow, slot, { player: beginReload }))
    : drawn
}

// NOTE: with no trap in stock there is nothing to try.
const placeTrap = whenFighting((world, slot) =>
  Option.isNone(maybeSelectedKind(world, slot))
    ? notNow
    : Result.mapBoth(placeTrapIn(world, slot), {
        onFailure: refused,
        onSuccess: ({ world: placed }) => placed,
      }),
)

const nextTrap = whenFighting((world, slot) =>
  Result.succeed(cycleTrap(world, slot)),
)

// NOTE: only at the counter, and only in a break the shop is open for.
const buy = (world: World, slot: PlayerSlot, item: ShopItemId): ActionResult =>
  ShopState.isAnyOf(['Browsing'])(seatStateAt(world, slot).shop) &&
  isShopOpenFor(world.phase)
    ? Result.mapError(tryPurchase(world, slot, item), refused)
    : notNow

const leaveCounter = (world: World, slot: PlayerSlot): ActionResult =>
  ShopState.isAnyOf(['Browsing'])(seatStateAt(world, slot).shop)
    ? Result.succeed(
        modifySeat(world, slot, { shop: () => ShopState.Dismissed() }),
      )
    : notNow

// NOTE: READY in single player starts the wave at once, as START WAVE
// always has; in co-op it waits for everyone. Only a break has one.
const ready = (world: World, slot: PlayerSlot): ActionResult =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? Result.succeed(
        isCoop(world) ? markReady(world, slot) : startWaveEarly(world),
      )
    : notNow

// NOTE: a tap at the ammo window mid-wave buys there on the next tick, with
// no hold (src/purchase.ts, tapToBuy). Away from it there is nothing to tap.
const buyAmmo = (world: World, slot: PlayerSlot): ActionResult =>
  Option.match(tapToBuy(world, slot), {
    onNone: () => notNow,
    onSome: Result.succeed,
  })

// NOTE: an action by the seat at `slot`: the World it makes, or why it made
// none.
export const trySeatAction = (
  world: World,
  slot: PlayerSlot,
  action: SeatAction,
): ActionResult =>
  SeatAction.match(action, {
    Swap: () => swap(world, slot),
    Melee: () => melee(world, slot),
    Draw: ({ slot: gun }) => draw(world, slot, gun),
    Reload: () => reload(world, slot),
    PlaceTrap: () => placeTrap(world, slot),
    NextTrap: () => nextTrap(world, slot),
    Buy: ({ item }) => buy(world, slot, item),
    LeaveCounter: () => leaveCounter(world, slot),
    Ready: () => ready(world, slot),
    BuyAmmo: () => buyAmmo(world, slot),
  })

export const applySeatAction = (
  world: World,
  slot: PlayerSlot,
  action: SeatAction,
): World => Result.getOrElse(trySeatAction(world, slot, action), () => world)

// NOTE: a tap on a HUD gun slot. On the gun in hand it reloads it; any
// other tap draws that gun, from the knife too.
export const gunSlotAction = (player: Player, slot: GunSlot): SeatAction =>
  !isWieldingMelee(player) && heldSlotOf(player.arsenal) === slot
    ? SeatAction.Reload()
    : SeatAction.Draw({ slot })

// THE SHOP WITHOUT A DIALOG

// NOTE: where a player's shop focus moves when they have no dialog, such as
// player 2 on a shared keyboard: through the rows of the open category, and
// on past either end into the next category.
export const FocusStep = Schema.Literals(['Previous', 'Next'])
export type FocusStep = typeof FocusStep.Type

const categoryAfter = (
  shopCategory: ShopCategory,
  step: FocusStep,
): ShopCategory => {
  const index = Option.getOrElse(
    Array.findFirstIndex(
      SHOP_CATEGORY_ORDER,
      category => category === shopCategory,
    ),
    () => 0,
  )
  const count = SHOP_CATEGORY_ORDER.length
  return Option.getOrElse(
    Array.get(
      SHOP_CATEGORY_ORDER,
      (index + (step === 'Next' ? 1 : count - 1)) % count,
    ),
    () => shopCategory,
  )
}

const stepFocus = (world: World, slot: PlayerSlot, step: FocusStep): World => {
  const { shop, shopCategory } = seatStateAt(world, slot)
  if (!ShopState.isAnyOf(['Browsing'])(shop)) {
    return world
  }
  const focused = shop.focusedItem
  const items = itemsIn(world, slot, shopCategory)
  const index = Option.getOrElse(
    Array.findFirstIndex(items, item => item === focused),
    () => -1,
  )
  const nextIndex = step === 'Next' ? index + 1 : index - 1
  return Option.match(Array.get(items, nextIndex), {
    onSome: item =>
      modifySeat(world, slot, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    onNone: () => {
      const category = categoryAfter(shopCategory, step)
      return modifySeat(world, slot, {
        shopCategory: () => category,
        shop: () =>
          ShopState.Browsing({
            focusedItem: suggestedItem(world, slot, category),
          }),
      })
    },
  })
}

export const stepShopFocus = (
  world: World,
  slot: PlayerSlot,
  step: FocusStep,
): World => stepFocus(world, slot, step)
