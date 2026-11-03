import { Array, Option, Record, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import {
  type Box,
  COVER_SYMBOLS,
  KITCHEN_TOP_ROW,
  type Level,
  circleTouchesBox,
  levelOf,
  tileBox,
  tilesWithSymbol,
} from './arena'
import { ZOMBIE_BLAST_TARGET, bountyOf } from './combat'
import { boxAround, spendOn } from './exits'
import { SCORCH_DIRECTION, isKitchenOpen } from './kitchen'
import { countKills } from './melee'
import { creditKills, payTo, seatStateAt } from './party'
import type { Offer } from './purchase'
import type { World } from './world'
import {
  GasValve,
  Phase,
  type PlayerSlot,
  Purchasable,
  type Zombie,
} from './worldSchema'
import { bodyRadiusOf, isGrounded } from './zombies'

// The kitchen's gas valve (owner, 2026-11-02): a wheel on the kitchen's
// east wall. Turned on, bought by the same stand or hold to buy as the
// boards (src/purchase.ts), it lights the parlour's fireplace as a trap for
// the rest of the run: a roaring fire that burns every zombie standing on
// the hearth's floor in front of it. It never hurts a player, and its kills
// pay the player who turned it, as a gnome's pay its owner.

type ValveRules = Readonly<{
  price: number
  reachPx: number
  tagDropPx: number
  burnEveryMs: number
  damage: number
  zoneDepthPx: number
}>

export const VALVE_RULES: ValveRules = {
  price: 80,
  reachPx: 14,
  tagDropPx: 3,
  burnEveryMs: 300,
  damage: 2,
  zoneDepthPx: 24,
}

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

const isValveForSale = (world: World): boolean =>
  !isValveLit(world) && Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)

export const valveOffers = (world: World): ReadonlyArray<Offer> =>
  isValveForSale(world)
    ? Option.match(valveBoxOf(levelOf(world)), {
        onNone: () => [],
        onSome: box => [
          {
            target: Purchasable.Valve(),
            price: VALVE_RULES.price,
            box,
            reachPx: VALVE_RULES.reachPx,
            isFull: false,
            spot: {
              x: box.left - TAG_INSET_PX,
              y: box.top + VALVE_RULES.tagDropPx,
            },
          },
        ],
      })
    : []

export const buyValve = (
  world: World,
  slot: PlayerSlot,
  price: number,
): Option.Option<World> =>
  isValveForSale(world) &&
  Option.isSome(valveBoxOf(levelOf(world))) &&
  seatStateAt(world, slot).wallet.balance >= price
    ? Option.some(
        modifyFields(spendOn(world, slot, price), {
          gasValve: () =>
            GasValve.Lit({
              owner: slot,
              nextBurnMs: VALVE_RULES.burnEveryMs,
            }),
        }),
      )
    : Option.none()

// THE FIRE

const HEARTH_SYMBOL = pipe(
  Record.toEntries(COVER_SYMBOLS),
  Array.findFirst(([, kind]) => kind === 'Hearth'),
  Option.map(([symbol]) => symbol),
  Option.getOrElse(() => 'F'),
)

const flameZones = new WeakMap<Level, Option.Option<Box>>()

// NOTE: the floor in front of the hearth, as wide as it and 24 px deep:
// where the lit fireplace burns. A level keeps its zone.
export const flameZoneOf = (level: Level): Option.Option<Box> => {
  const cached = flameZones.get(level)
  if (cached !== undefined) {
    return cached
  }
  const zone = Option.map(
    boxAround(Array.map(tilesWithSymbol(level, HEARTH_SYMBOL), tileBox)),
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
  const events = Array.flatMap(outcomes, outcome => outcome.events)
  if (Array.isReadonlyArrayEmpty(events)) {
    return world
  }
  const burned = modifyFields(world, {
    zombies: () => Array.map(outcomes, ({ target }) => target),
    frameEvents: frameEvents => [...frameEvents, ...events],
  })
  return creditKills(
    payTo(burned, Option.some(owner), bountyOf(levelOf(world), events)),
    owner,
    countKills(events),
  )
}

// NOTE: once lit, the fire burns every 0.3 s whatever the phase; in a
// break there is nobody to burn.
export const burnHearth = (world: World, deltaMs: number): World =>
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
  })
