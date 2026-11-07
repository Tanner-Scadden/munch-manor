import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { isInArc, maybeNearest, payStriker, strikeInMelee } from './melee'
import { atSeat, modifySeat, seatStateAt } from './party'
import { isWieldingKnife } from './weapons'
import type { World } from './world'
import {
  GameEvent,
  type Player,
  type PlayerSlot,
  ShopState,
} from './worldSchema'
import { isGrounded } from './zombies'

// The knife (GAME_DESIGN.md, "The knife and two gun slots"): every player
// starts a run with one in the melee slot, right of the guns. F or a tap on
// the slot draws it (src/weapons.ts, drawMelee), and then the trigger stabs
// on repeat: a quick, weak jab at the one zombie nearest in a short arc in
// front, with a small shove. It never runs out and never upgrades; the
// Clang Pan from the fridge is the only melee upgrade, and takes its place
// in the slot for the rest of the run. It strikes through src/melee.ts, as
// the Pan does.

type KnifeRules = Readonly<{
  intervalMs: number
  reachPx: number
  halfArc: number
  damage: number
  knockback: number
  slashMs: number
}>

export const KNIFE_RULES: KnifeRules = {
  intervalMs: 350,
  reachPx: 12,
  halfArc: 0.75,
  damage: 1,
  knockback: 150,
  slashMs: 140,
}

// NOTE: how far through its slash the knife is, from 0 as it lands to 1 as
// it is put away; none once the slash is over. Read from the cooldown, so
// the slash needs no field of its own.
export const maybeSlashShare = (player: Player): Option.Option<number> => {
  const sinceStabMs = KNIFE_RULES.intervalMs - player.knifeCooldownMs
  return player.knifeCooldownMs > 0 && sinceStabMs < KNIFE_RULES.slashMs
    ? Option.some(Math.max(0, sinceStabMs) / KNIFE_RULES.slashMs)
    : Option.none()
}

const coolKnife = (world: World, slot: PlayerSlot, deltaMs: number): World =>
  seatStateAt(world, slot).player.knifeCooldownMs > 0
    ? modifySeat(world, slot, {
        player: player =>
          modifyFields(player, {
            knifeCooldownMs: cooldown => Math.max(0, cooldown - deltaMs),
          }),
      })
    : world

const stab = (world: World, slot: PlayerSlot): World => {
  const { player } = seatStateAt(world, slot)
  const isReached = isInArc(player, KNIFE_RULES.reachPx, KNIFE_RULES.halfArc)
  const maybeTarget = maybeNearest(
    player,
    world.zombies,
    zombie => isGrounded(zombie) && isReached(zombie),
  )
  const outcome = Option.map(maybeTarget, target =>
    strikeInMelee(player, target, {
      damage: KNIFE_RULES.damage,
      knockback: KNIFE_RULES.knockback,
      maybeDazeMs: Option.none(),
      struck: (at, direction) =>
        GameEvent.KnifeHit({ x: at.x, y: at.y, direction }),
    }),
  )
  const events = [
    GameEvent.KnifeStabbed({
      x: player.x,
      y: player.y,
      direction: player.facing,
    }),
    ...Option.match(outcome, { onNone: () => [], onSome: hit => hit.events }),
  ]
  const stabbed = modifyFields(world, {
    zombies: zombies =>
      Option.match(outcome, {
        onNone: () => zombies,
        onSome: hit =>
          Array.map(zombies, zombie =>
            zombie.id === hit.zombie.id ? hit.zombie : zombie,
          ),
      }),
    seats: atSeat(slot, {
      player: current =>
        modifyFields(current, {
          knifeCooldownMs: () => KNIFE_RULES.intervalMs,
        }),
    }),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
  return payStriker(stabbed, slot, events)
}

// NOTE: one tick of the knife for the seat at `slot`: in hand, the held
// trigger stabs. It rests while that player browses the shop.
export const stabWithKnife: {
  (slot: PlayerSlot, deltaMs: number): (world: World) => World
  (world: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, deltaMs: number): World => {
    const cooled = coolKnife(world, slot, deltaMs)
    const { player, intent, shop } = seatStateAt(cooled, slot)
    return isWieldingKnife(player) &&
      intent.trigger === 'Held' &&
      player.knifeCooldownMs <= 0 &&
      !ShopState.isAnyOf(['Browsing'])(shop)
      ? stab(cooled, slot)
      : cooled
  },
)
