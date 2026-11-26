import { Function, Option, Result, Schema } from 'effect'

import { UiSchema, UiStruct } from '@effect/ui'

import { cycleTrap, maybeSelectedKind, placeTrapIn } from '../gear/traps'
import {
  beginReload,
  canReload,
  drawMelee,
  drawSlot,
  heldSlotOf,
  isWieldingMelee,
  swapInHand,
} from '../gear/weapons'
import { shoutMedic } from '../party/medic'
import {
  forEachSeat,
  isCoop,
  isDowned,
  isHere,
  isStanding,
  modifySeat,
  seatStateAt,
} from '../party/party'
import { markReady } from '../party/revive'
import type { World } from '../schema/world'
import {
  Arsenal,
  type GameEvent,
  GunSlot,
  type Intent,
  Phase,
  type Player,
  type PlayerSlot,
  SOLO_SLOT,
  idleIntent,
} from '../schema/worldSchema'
import { isRoundActive, startWaveEarly } from '../waves/waves'
import { ZERO_VECTOR } from './geometry'
import { advanceTick } from './simulation'

export { type PlayerSlot }

export type InputsByPlayer = ReadonlyMap<PlayerSlot, Intent>

export type Stepped = Readonly<{
  world: World
  events: ReadonlyArray<GameEvent>
  worldMs: number
}>

export const soloInputs = (intent: Intent): InputsByPlayer =>
  new Map([[SOLO_SLOT, intent]])

const inputOf = (inputsByPlayer: InputsByPlayer, slot: PlayerSlot): Intent =>
  Option.getOrElse(
    Option.fromNullishOr(inputsByPlayer.get(slot)),
    () => idleIntent,
  )

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
  return UiStruct.evolve(intent, {
    move: move => (isDowned(seat) ? move : ZERO_VECTOR),
    interact: () => 'Released',
  })
}

const isSameHeading = (
  first: Readonly<{ x: number; y: number }>,
  second: Readonly<{ x: number; y: number }>,
): boolean => Object.is(first.x, second.x) && Object.is(first.y, second.y)

export const keptIntent: {
  (next: Intent): (current: Intent) => Intent
  (current: Intent, next: Intent): Intent
} = Function.dual(2, (current: Intent, next: Intent): Intent => {
  const isSameAim =
    Option.isNone(current.maybeAim) || Option.isNone(next.maybeAim)
      ? Option.isNone(current.maybeAim) && Option.isNone(next.maybeAim)
      : isSameHeading(current.maybeAim.value, next.maybeAim.value)
  return isSameAim &&
    isSameHeading(current.move, next.move) &&
    current.trigger === next.trigger &&
    current.interact === next.interact
    ? current
    : next
})

export const stepWorld: {
  (inputsByPlayer: InputsByPlayer): (world: World) => Stepped
  (world: World, inputsByPlayer: InputsByPlayer): Stepped
} = Function.dual(
  2,
  (world: World, inputsByPlayer: InputsByPlayer): Stepped => {
    const intended = forEachSeat(world, (current, slot) =>
      modifySeat(current, slot, {
        intent: intent =>
          keptIntent(
            intent,
            intentFor(current, slot, inputOf(inputsByPlayer, slot)),
          ),
      }),
    )
    const ticked = advanceTick(intended)
    return {
      world: ticked.world,
      events: ticked.world.frameEvents,
      worldMs: ticked.worldMs,
    }
  },
)

export const SeatAction = UiSchema.TaggedEnum({
  Swap: {},
  Melee: {},
  Draw: { slot: GunSlot },
  Reload: {},
  PlaceTrap: {},
  NextTrap: {},
  Ready: {},
  CallMedic: {},
})
export type SeatAction = typeof SeatAction.Type

export const ActionRefusal = UiSchema.TaggedEnum({
  NotNow: {},
  Refused: { reason: Schema.String },
})
export type ActionRefusal = typeof ActionRefusal.Type

export type ActionResult = Result.Result<World, ActionRefusal>

const notNow: ActionResult = Result.fail(ActionRefusal.NotNow())

const refused = (reason: string): ActionRefusal =>
  ActionRefusal.Refused({ reason })

const isFighting = (world: World, slot: PlayerSlot): boolean =>
  isRoundActive(world.phase) && isStanding(seatStateAt(world, slot).seat)

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

const canDraw = (player: Player, gun: GunSlot): boolean =>
  (gun === 'First' || !Arsenal.isAnyOf(['OneGun'])(player.arsenal)) &&
  (isWieldingMelee(player) || heldSlotOf(player.arsenal) !== gun)

const draw = (world: World, slot: PlayerSlot, gun: GunSlot): ActionResult =>
  canDraw(seatStateAt(world, slot).player, gun)
    ? inHand(player => drawSlot(player, gun))(world, slot)
    : notNow

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

const ready = (world: World, slot: PlayerSlot): ActionResult =>
  Phase.isAnyOf(['Preparation'])(world.phase)
    ? Result.succeed(
        isCoop(world) ? markReady(world, slot) : startWaveEarly(world),
      )
    : notNow

const callMedic = (world: World, slot: PlayerSlot): ActionResult =>
  Option.match(shoutMedic(world, slot), {
    onNone: () => notNow,
    onSome: Result.succeed,
  })

export const trySeatAction: {
  (slot: PlayerSlot, action: SeatAction): (world: World) => ActionResult
  (world: World, slot: PlayerSlot, action: SeatAction): ActionResult
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, action: SeatAction): ActionResult =>
    SeatAction.match(action, {
      Swap: () => swap(world, slot),
      Melee: () => melee(world, slot),
      Draw: ({ slot: gun }) => draw(world, slot, gun),
      Reload: () => reload(world, slot),
      PlaceTrap: () => placeTrap(world, slot),
      NextTrap: () => nextTrap(world, slot),
      Ready: () => ready(world, slot),
      CallMedic: () => callMedic(world, slot),
    }),
)

export const applySeatAction: {
  (slot: PlayerSlot, action: SeatAction): (world: World) => World
  (world: World, slot: PlayerSlot, action: SeatAction): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, action: SeatAction): World =>
    Result.getOrElse(trySeatAction(world, slot, action), () => world),
)

export const cycleWeaponAction = (player: Player): SeatAction =>
  isWieldingMelee(player)
    ? SeatAction.Draw({ slot: 'First' })
    : Arsenal.match(player.arsenal, {
        OneGun: () => SeatAction.Melee(),
        HoldingFirst: () => SeatAction.Draw({ slot: 'Second' }),
        HoldingSecond: () => SeatAction.Melee(),
      })

export const gunSlotAction: {
  (slot: GunSlot): (player: Player) => SeatAction
  (player: Player, slot: GunSlot): SeatAction
} = Function.dual(2, (player: Player, slot: GunSlot): SeatAction =>
  !isWieldingMelee(player) && heldSlotOf(player.arsenal) === slot
    ? SeatAction.Reload()
    : SeatAction.Draw({ slot }),
)
