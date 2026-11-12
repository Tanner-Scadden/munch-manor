import { Array, Function, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type FeatLock, hasDone } from '../feats/feats'
import { countKills } from '../gear/melee'
import { heldKeys, spendKeys } from '../keys/keys'
import { type Level, levelOf } from '../level/arena'
import { boxAround } from '../level/exits'
import { KITCHEN_TOP_ROW } from '../level/plan'
import {
  type Box,
  COVER_SYMBOLS,
  boxCenter,
  circleTouchesBox,
  tileBox,
  tilesWithSymbol,
} from '../level/tileGrid'
import { creditKills } from '../party/party'
import type { World } from '../schema/world'
import {
  Feat,
  GasValve,
  Phase,
  type PlayerSlot,
  Purchasable,
  type Vector,
  type Zombie,
} from '../schema/worldSchema'
import type { Offer } from '../shop/purchase'
import { ZOMBIE_BLAST_TARGET, creditKillEvents } from '../step/combat'
import { bodyRadiusOf, isGrounded } from '../zombies/zombies'
import { SCORCH_DIRECTION, isKitchenOpen } from './kitchen'

// The kitchen's gas valve (owner, 2026-11-02): a wheel on the kitchen's
// east wall. Turned on, it lights the parlour's fireplace as a trap for the
// rest of the run: a roaring fire that burns every zombie standing on the
// hearth's floor in front of it. It never hurts a player, and its kills pay
// the player who turned it, as a gnome's pay its owner. It is never bought
// (owner, 2026-11-10): it frees up for a player by a feat
// (src/world/feats/feats.ts), 10 kills made standing in the kitchen, and
// they turn it by the same stand or hold as the boards
// (src/world/shop/purchase.ts).

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

// NOTE: the valve's wall tile, on the kitchen's east wall beside the open
// floor at its south end, away from the stoves, the fridge, and the doors.
const VALVE_TILE = { column: 19, row: KITCHEN_TOP_ROW + 10 }

// NOTE: the tag hangs off the wall's inner face, so it never reaches out
// over the yard.
const TAG_INSET_PX = 6

export const valveBoxOf = (level: Level): Option.Option<Box> =>
  isKitchenOpen(level) ? Option.some(tileBox(VALVE_TILE)) : Option.none()

export const isValveLit = (world: World): boolean =>
  GasValve.isAnyOf(['Lit'])(world.gasValve)

// THE OFFER

// NOTE: the valve waits in the kitchen until lit: its lock shows while a
// player has not done its feat, its tag once they have.
const isValveForSale = (world: World): boolean =>
  !isValveLit(world) && Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)

const isValveOpenTo = (world: World, slot: PlayerSlot): boolean =>
  isValveForSale(world) && hasDone(world, slot, VALVE_FEAT)

// NOTE: the valve a seat has not earned yet: its feat, and the spot its
// lock hangs from.
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

// NOTE: where the valve's tag (or its lock) hangs, off the wall's inner face.
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
          modifyFields(spendKeys(world, price), {
            gasValve: () =>
              GasValve.Lit({
                owner: slot,
                nextBurnMs: VALVE_RULES.burnEveryMs,
              }),
          }),
        )
      : Option.none(),
)

// THE FIRE

const HEARTH_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Hearth'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'F'),
)

const flameZones = new WeakMap<Level, Option.Option<Box>>()

// NOTE: an open room holds the hearth: its room must be open for its fire
// to burn, wherever the parlour stands on the plan.
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

// NOTE: the floor in front of the hearth, as wide as it and 24 px deep:
// where the lit fireplace burns, once the parlour it stands in is open. A
// level keeps its zone.
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
  const burned = modifyFields(world, {
    zombies: () => Array.map(outcomes, ({ target }) => target),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
  return creditKills(burned, owner, countKills(events))
}

// NOTE: once lit, the fire burns every 0.3 s whatever the phase; in a
// break there is nobody to burn.
export const burnHearth: {
  (deltaMs: number): (world: World) => World
  (world: World, deltaMs: number): World
} = Function.dual(2, (world: World, deltaMs: number): World =>
  GasValve.match(world.gasValve, {
    Shut: () => world,
    Lit: ({ owner, nextBurnMs }) => {
      const left = nextBurnMs - deltaMs
      const isDue = left <= 0
      const timed = modifyFields(world, {
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
