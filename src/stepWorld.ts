import { Array, Option, Result, Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  forEachSeat,
  isCoop,
  isDowned,
  isHere,
  isStanding,
  leadSeatOf,
  withSeat,
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
  type PlayerSlot,
  SOLO_SLOT,
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

// NOTE: an away player stands frozen and a bled-out one is out of the
// fight (decided row 4, row 10). A downed one crawls but cannot fire.
const intentFor = (world: World, intent: Intent): Intent => {
  if (!isCoop(world)) {
    return intent
  }
  const seat = leadSeatOf(world)
  if (!isHere(seat) || !(isStanding(seat) || isDowned(seat))) {
    return idleIntent
  }
  return isDowned(seat)
    ? modifyFields(intent, { trigger: () => 'Released' })
    : intent
}

export const stepWorld = (
  world: World,
  inputsByPlayer: InputsByPlayer,
): Stepped => {
  const intended = forEachSeat(world, (seatWorld, slot) =>
    modifyFields(seatWorld, {
      intent: () => intentFor(seatWorld, inputOf(inputsByPlayer, slot)),
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

const isFighting = (world: World): boolean =>
  isRoundActive(world.phase) &&
  isStanding(leadSeatOf(world)) &&
  !ShopState.isAnyOf(['Browsing'])(world.shop)

const whenFighting =
  (act: (world: World) => ActionResult) =>
  (world: World): ActionResult =>
    isFighting(world) ? act(world) : notNow

const inHand = (change: (player: World['player']) => World['player']) =>
  whenFighting(world => Result.succeed(modifyFields(world, { player: change })))

const swap = inHand(swapInHand)

const melee = inHand(drawMelee)

const draw = (world: World, slot: GunSlot): ActionResult =>
  inHand(player => drawSlot(player, slot))(world)

// NOTE: with the knife out, a reload puts the last gun back in hand first,
// even when that gun cannot reload.
const reload = (world: World): ActionResult => {
  const drawn = isWieldingMelee(world.player)
    ? draw(world, heldSlotOf(world.player.arsenal))
    : notNow
  const inHandNow = Result.getOrElse(drawn, () => world)
  return isFighting(inHandNow) && canReload(inHandNow.player)
    ? Result.succeed(modifyFields(inHandNow, { player: beginReload }))
    : drawn
}

// NOTE: with no trap in stock there is nothing to try.
const placeTrap = whenFighting(world =>
  Option.isNone(maybeSelectedKind(world))
    ? notNow
    : Result.mapBoth(placeTrapIn(world), {
        onFailure: refused,
        onSuccess: ({ world: placed }) => placed,
      }),
)

const nextTrap = whenFighting(world => Result.succeed(cycleTrap(world)))

// NOTE: only at the counter, and only in a break the shop is open for.
const buy = (world: World, item: ShopItemId): ActionResult =>
  ShopState.isAnyOf(['Browsing'])(world.shop) && isShopOpenFor(world.phase)
    ? Result.mapError(tryPurchase(world, item), refused)
    : notNow

const leaveCounter = (world: World): ActionResult =>
  ShopState.isAnyOf(['Browsing'])(world.shop)
    ? Result.succeed(modifyFields(world, { shop: () => ShopState.Dismissed() }))
    : notNow

// NOTE: READY in single player starts the wave at once, as START WAVE
// always has; in co-op it waits for everyone. Only a break has one.
const ready = (world: World): ActionResult =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? Result.succeed(isCoop(world) ? markReady(world) : startWaveEarly(world))
    : notNow

// NOTE: a tap at the ammo window mid-wave buys there on the next tick, with
// no hold (src/purchase.ts, tapToBuy). Away from it there is nothing to tap.
const buyAmmo = (world: World): ActionResult =>
  Option.match(tapToBuy(world), {
    onNone: () => notNow,
    onSome: Result.succeed,
  })

// NOTE: an action on a seat World's lead seat (party.ts, withSeat): the
// World it makes, or why it made none.
export const trySeatAction = (
  seatWorld: World,
  action: SeatAction,
): ActionResult =>
  SeatAction.match(action, {
    Swap: () => swap(seatWorld),
    Melee: () => melee(seatWorld),
    Draw: ({ slot }) => draw(seatWorld, slot),
    Reload: () => reload(seatWorld),
    PlaceTrap: () => placeTrap(seatWorld),
    NextTrap: () => nextTrap(seatWorld),
    Buy: ({ item }) => buy(seatWorld, item),
    LeaveCounter: () => leaveCounter(seatWorld),
    Ready: () => ready(seatWorld),
    BuyAmmo: () => buyAmmo(seatWorld),
  })

export const applySeatAction = (
  world: World,
  slot: PlayerSlot,
  action: SeatAction,
): World =>
  withSeat(world, slot, seatWorld =>
    Result.getOrElse(trySeatAction(seatWorld, action), () => seatWorld),
  )

// NOTE: a tap on a HUD gun slot. On the gun in hand it reloads it; any
// other tap draws that gun, from the knife too.
export const gunSlotAction = (
  player: World['player'],
  slot: GunSlot,
): SeatAction =>
  !isWieldingMelee(player) && heldSlotOf(player.arsenal) === slot
    ? SeatAction.Reload()
    : SeatAction.Draw({ slot })

// THE SHOP WITHOUT A DIALOG

// NOTE: where a player's shop focus moves when they have no dialog, such as
// player 2 on a shared keyboard: through the rows of the open category, and
// on past either end into the next category.
export const FocusStep = Schema.Literals(['Previous', 'Next'])
export type FocusStep = typeof FocusStep.Type

const categoryAfter = (world: World, step: FocusStep) => {
  const index = Option.getOrElse(
    Array.findFirstIndex(
      SHOP_CATEGORY_ORDER,
      category => category === world.shopCategory,
    ),
    () => 0,
  )
  const count = SHOP_CATEGORY_ORDER.length
  return Option.getOrElse(
    Array.get(
      SHOP_CATEGORY_ORDER,
      (index + (step === 'Next' ? 1 : count - 1)) % count,
    ),
    () => world.shopCategory,
  )
}

const stepFocus = (world: World, step: FocusStep): World => {
  if (!ShopState.isAnyOf(['Browsing'])(world.shop)) {
    return world
  }
  const focused = world.shop.focusedItem
  const items = itemsIn(world, world.shopCategory)
  const index = Option.getOrElse(
    Array.findFirstIndex(items, item => item === focused),
    () => -1,
  )
  const nextIndex = step === 'Next' ? index + 1 : index - 1
  return Option.match(Array.get(items, nextIndex), {
    onSome: item =>
      modifyFields(world, {
        shop: () => ShopState.Browsing({ focusedItem: item }),
      }),
    onNone: () => {
      const category = categoryAfter(world, step)
      return modifyFields(world, {
        shopCategory: () => category,
        shop: () =>
          ShopState.Browsing({ focusedItem: suggestedItem(world, category) }),
      })
    },
  })
}

export const stepShopFocus = (
  world: World,
  slot: PlayerSlot,
  step: FocusStep,
): World => withSeat(world, slot, seatWorld => stepFocus(seatWorld, step))
