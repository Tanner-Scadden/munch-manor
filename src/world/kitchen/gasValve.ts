import { Array, Function, Option, Record, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import { type FeatLock, hasDone } from '#world/feats/feats.ts'
import { countKills } from '#world/gear/melee.ts'
import { heldKeys, spendKeys } from '#world/keys/keys.ts'
import { type Level, levelOf } from '#world/level/arena.ts'
import { boxAround } from '#world/level/exits.ts'
import { KITCHEN_TOP_ROW } from '#world/level/plan.ts'
import {
  type Box,
  COVER_SYMBOLS,
  boxCenter,
  circleTouchesBox,
  tileBox,
  tilesWithSymbol,
} from '#world/level/tileGrid.ts'
import { creditKills } from '#world/party/party.ts'
import type { World } from '#world/schema/world.ts'
import {
  Feat,
  GasValve,
  Phase,
  type PlayerSlot,
  Purchasable,
  type Vector,
  type Zombie,
} from '#world/schema/worldSchema.ts'
import type { Offer } from '#world/shop/purchase.ts'
import { ZOMBIE_BLAST_TARGET, creditKillEvents } from '#world/step/combat.ts'
import { bodyRadiusOf, isGrounded } from '#world/zombies/zombies.ts'

import { SCORCH_DIRECTION, isKitchenOpen } from './kitchen.ts'

type ValveRules = Readonly<{
  standKills: number
  reachPx: number
  tagDropPx: number
  burnEveryMs: number
  damage: number
  zoneDepthPx: number
}>

export const VALVE_RULES: ValveRules = {
  standKills: 10,
  reachPx: 14,
  tagDropPx: 3,
  burnEveryMs: 300,
  damage: 2,
  zoneDepthPx: 24,
}

const VALVE_FEAT: Feat = Feat.KitchenStandKills({
  count: VALVE_RULES.standKills,
})

const VALVE_TILE = { column: 19, row: KITCHEN_TOP_ROW + 10 }

const TAG_INSET_PX = 6

export const valveBoxOf = (level: Level): Option.Option<Box> =>
  isKitchenOpen(level) ? Option.some(tileBox(VALVE_TILE)) : Option.none()

export const isValveLit = (world: World): boolean =>
  GasValve.isAnyOf(['Lit'])(world.gasValve)

const isValveForSale = (world: World): boolean =>
  !isValveLit(world) && Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)

const isValveOpenTo = (world: World, slot: PlayerSlot): boolean =>
  isValveForSale(world) && hasDone(world, slot, VALVE_FEAT)

export const maybeValveLock: {
  (slot: PlayerSlot): (world: World) => Option.Option<FeatLock>
  (world: World, slot: PlayerSlot): Option.Option<FeatLock>
} = Function.dual(
  2,
  (world: World, slot: PlayerSlot): Option.Option<FeatLock> =>
    isValveForSale(world) && !hasDone(world, slot, VALVE_FEAT)
      ? Option.map(valveBoxOf(levelOf(world)), box => ({
          feat: VALVE_FEAT,
          spot: valveTagSpotOf(box),
        }))
      : Option.none(),
)

export const valveOffers: {
  (slot: PlayerSlot): (world: World) => ReadonlyArray<Offer>
  (world: World, slot: PlayerSlot): ReadonlyArray<Offer>
} = Function.dual(2, (world: World, slot: PlayerSlot): ReadonlyArray<Offer> =>
  isValveOpenTo(world, slot)
    ? Option.match(valveBoxOf(levelOf(world)), {
        onNone: () => [],
        onSome: box => [
          {
            target: Purchasable.Valve(),
            price: 0,
            box,
            reachPx: VALVE_RULES.reachPx,
            isFull: false,
            spot: valveTagSpotOf(box),
          },
        ],
      })
    : [],
)

const valveTagSpotOf = (box: Box): Vector => ({
  x: box.left - TAG_INSET_PX,
  y: box.top + VALVE_RULES.tagDropPx,
})

export const buyValve: {
  (slot: PlayerSlot, price: number): (world: World) => Option.Option<World>
  (world: World, slot: PlayerSlot, price: number): Option.Option<World>
} = Function.dual(
  3,
  (world: World, slot: PlayerSlot, price: number): Option.Option<World> =>
    isValveOpenTo(world, slot) &&
    Option.isSome(valveBoxOf(levelOf(world))) &&
    heldKeys(world) >= price
      ? Option.some(
          UiStruct.evolve(spendKeys(world, price), {
            gasValve: () =>
              GasValve.Lit({
                owner: slot,
                nextBurnMs: VALVE_RULES.burnEveryMs,
              }),
          }),
        )
      : Option.none(),
)

const HEARTH_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Hearth'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'F'),
)

const flameZones = new WeakMap<Level, Option.Option<Box>>()

const isInOpenRoom = (level: Level, hearth: Box): boolean => {
  const { x, y } = boxCenter(hearth)
  return Array.some(
    level.rooms,
    ({ box, isOpen }) =>
      isOpen &&
      x >= box.left &&
      x < box.right &&
      y >= box.top &&
      y < box.bottom,
  )
}

export const flameZoneOf = (level: Level): Option.Option<Box> => {
  const cached = flameZones.get(level)
  if (cached !== undefined) {
    return cached
  }
  const zone = Option.map(
    Option.filter(
      boxAround(Array.map(tilesWithSymbol(level, HEARTH_SYMBOL), tileBox)),
      hearth => isInOpenRoom(level, hearth),
    ),
    hearth => ({
      left: hearth.left,
      top: hearth.bottom,
      right: hearth.right,
      bottom: hearth.bottom + VALVE_RULES.zoneDepthPx,
    }),
  )
  flameZones.set(level, zone)
  return zone
}

const isInZone =
  (zone: Box) =>
  (zombie: Zombie): boolean =>
    isGrounded(zombie) && circleTouchesBox(zombie, bodyRadiusOf(zombie), zone)

const burn = (world: World, owner: PlayerSlot, zone: Box): World => {
  const outcomes = Array.map(world.zombies, zombie =>
    isInZone(zone)(zombie)
      ? ZOMBIE_BLAST_TARGET.hurt(zombie, {
          damage: VALVE_RULES.damage,
          direction: SCORCH_DIRECTION,
          knockbackSpeed: 0,
        })
      : { target: zombie, events: [] },
  )
  const events = creditKillEvents(
    Array.flatMap(outcomes, outcome => outcome.events),
    Option.some(owner),
    'Fire',
  )
  if (Array.isReadonlyArrayEmpty(events)) {
    return world
  }
  const burned = UiStruct.evolve(world, {
    zombies: () => Array.map(outcomes, ({ target }) => target),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
  return creditKills(burned, owner, countKills(events))
}

export const burnHearth: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  GasValve.match(world.gasValve, {
    Shut: () => world,
    Lit: ({ owner, nextBurnMs }) => {
      const left = nextBurnMs - deltaMs
      const isDue = left <= 0
      const timed = UiStruct.evolve(world, {
        gasValve: () =>
          GasValve.Lit({
            owner,
            nextBurnMs: isDue ? left + VALVE_RULES.burnEveryMs : left,
          }),
      })
      return isDue
        ? Option.match(flameZoneOf(levelOf(world)), {
            onNone: () => timed,
            onSome: zone => burn(timed, owner, zone),
          })
        : timed
    },
  }),
)
