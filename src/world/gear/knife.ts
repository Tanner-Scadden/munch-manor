import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import { atSeat, modifySeat, seatStateAt } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  GameEvent,
  type Player,
  type PlayerSlot,
} from '#world/schema/worldSchema.ts'
import { creditKillEvents } from '#world/step/combat.ts'
import { isGrounded } from '#world/zombies/zombies.ts'

import { creditStriker, isInArc, maybeNearest, strikeInMelee } from './melee.ts'
import { isWieldingKnife } from './weapons.ts'

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
          UiStruct.evolve(player, {
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
    ...Option.match(outcome, {
      onNone: () => [],
      onSome: hit => creditKillEvents(hit.events, Option.some(slot), 'Knife'),
    }),
  ]
  const stabbed = UiStruct.evolve(world, {
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
        UiStruct.evolve(current, {
          knifeCooldownMs: () => KNIFE_RULES.intervalMs,
        }),
    }),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
  return creditStriker(stabbed, slot, events)
}

export const stabWithKnife: {
  (slot: PlayerSlot, deltaMs: number): (world: World) => World
  (world: World, slot: PlayerSlot, deltaMs: number): World
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, deltaMs: number): World => {
    const cooled = coolKnife(world, slot, deltaMs)
    const { player, intent } = seatStateAt(cooled, slot)
    return isWieldingKnife(player) &&
      intent.trigger === 'Held' &&
      player.knifeCooldownMs <= 0
      ? stab(cooled, slot)
      : cooled
  },
)
