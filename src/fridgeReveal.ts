import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { levelOf } from './arena'
import { PrizeFlight } from './clientSchema'
import { FRIDGE_SPIN_STEPS_MS } from './constants'
import { FRIDGE_RULES, PRIZE_ORDER, fridgeBoxOf } from './leftovers'
import type { Model } from './model'
import { PRIZE_PUNCH_LINES } from './names'
import { leadSeatOf } from './party'
import type { SoundEffect } from './soundEffect'
import type { World } from './world'
import {
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  type Vector,
  type WeaponKind,
} from './worldSchema'

// The Mystery Leftovers reveal: what a pull looks and sounds like, so the
// prize reads at a glance in the middle of a fight. The door's own clock
// (`FridgeDoor.Open`, 1.1 s, in src/leftovers.ts) drives it, so a co-op
// teammate sees the same reveal from the room's World and nothing here
// changes the game:
//
// - a slot machine spin in the doorway: the five prizes cycle fast, slow
//   down, and land on the real one 0.7 s in, with a thunk;
// - a color for how good it is: a common Cooker or Pan, the rare Brain
//   Freeze, a snack, or a sad grey dud;
// - a sting for each, a big chunky icon that pops with squash and stretch,
//   and one punch word;
// - a weapon then waits on offer; taking it flies its icon into its HUD
//   gun slot, which pulses.

export type Rarity = 'Common' | 'Rare' | 'Snack' | 'Dud'

export type PrizeReveal = Readonly<{
  rarity: Rarity
  punchLine: string
  sting: SoundEffect
  isWeapon: boolean
}>

const STINGS: Readonly<Record<Rarity, SoundEffect>> = {
  Common: 'PowerUp',
  Rare: 'PrizeJackpot',
  Snack: 'PrizeChomp',
  Dud: 'PrizeWomp',
}

const RARITIES: Readonly<Record<FridgePrize, Rarity>> = {
  Cooker: 'Common',
  Pan: 'Common',
  Freeze: 'Rare',
  Sandwich: 'Snack',
  Dud: 'Dud',
}

export const revealOf = (prize: FridgePrize): PrizeReveal => ({
  rarity: RARITIES[prize],
  punchLine: PRIZE_PUNCH_LINES[prize],
  sting: STINGS[RARITIES[prize]],
  isWeapon: isWeapon(prize),
})

const SPIN_STEPS_MS = FRIDGE_SPIN_STEPS_MS

type RevealRules = Readonly<{
  landMs: number
  popMs: number
  gagFlyFromMs: number
  flightMs: number
  pulseMs: number
}>

export const REVEAL_RULES: RevealRules = {
  landMs: Array.reduce(SPIN_STEPS_MS, 0, (sum, stepMs) => sum + stepMs),
  popMs: 180,
  gagFlyFromMs: 900,
  flightMs: 420,
  pulseMs: 420,
}

const SPIN_STARTS_MS: ReadonlyArray<number> = Array.scan(
  SPIN_STEPS_MS,
  0,
  (at, stepMs) => at + stepMs,
)

// NOTE: where the reveal stands `elapsedMs` into the door's opening: a
// face of the spin, or the prize landed `sinceMs` ago. The faces walk the
// prizes in order so the last one before the landing is the prize's
// neighbor, like a reel clicking into place.
export type RevealStage =
  | Readonly<{ _tag: 'Spinning'; face: FridgePrize; step: number }>
  | Readonly<{ _tag: 'Landed'; sinceMs: number }>

export const revealStageAt = (
  prize: FridgePrize,
  elapsedMs: number,
): RevealStage => {
  if (elapsedMs >= REVEAL_RULES.landMs) {
    return { _tag: 'Landed', sinceMs: elapsedMs - REVEAL_RULES.landMs }
  }
  const step = pipe(
    Array.findLastIndex(SPIN_STARTS_MS, startMs => startMs <= elapsedMs),
    Option.getOrElse(() => 0),
  )
  const prizeIndex = Math.max(0, PRIZE_ORDER.indexOf(prize))
  const stepsLeft = SPIN_STEPS_MS.length - step
  const count = PRIZE_ORDER.length
  const faceIndex = (((prizeIndex - stepsLeft) % count) + count) % count
  return {
    _tag: 'Spinning',
    face: Option.getOrElse(Array.get(PRIZE_ORDER, faceIndex), () => prize),
    step,
  }
}

// NOTE: the reveal the door shows right now, if it shows one: the prize,
// who pulled it, and how long since the door opened. A weapon on offer has
// long since landed.
export type DoorReveal = Readonly<{
  prize: FridgePrize
  slot: number
  elapsedMs: number
  maybeOffer: Option.Option<
    Readonly<{ remainingMs: number; durationMs: number }>
  >
}>

export const doorRevealOf = (door: FridgeDoor): Option.Option<DoorReveal> =>
  FridgeDoor.match(door, {
    Shut: () => Option.none(),
    Slammed: () => Option.none(),
    Open: ({ prize, slot, remainingMs, durationMs }) =>
      Option.some({
        prize,
        slot,
        elapsedMs: durationMs - remainingMs,
        maybeOffer: Option.none(),
      }),
    Offering: ({ prize, slot, remainingMs, durationMs }) =>
      Option.some({
        prize,
        slot,
        elapsedMs: FRIDGE_RULES.openMs + durationMs - remainingMs,
        maybeOffer: Option.some({ remainingMs, durationMs }),
      }),
  })

const isLanded = (reveal: DoorReveal): boolean =>
  reveal.elapsedMs >= REVEAL_RULES.landMs

// NOTE: the prize whose spin stopped between two frames, for its sting.
// A door that opens already landed (a co-op client that caught up late)
// still stings once.
export const maybeLandedBetween = (
  before: FridgeDoor,
  after: FridgeDoor,
): Option.Option<FridgePrize> =>
  pipe(
    doorRevealOf(after),
    Option.filter(isLanded),
    Option.filter(() => !Option.exists(doorRevealOf(before), isLanded)),
    Option.map(({ prize }) => prize),
  )

// THE SPOT

// NOTE: the middle of the fridge's door, in the world, where the prize
// spins and lands: low on the door, so on a landscape screen it stays
// clear of the HUD strip over the back wall.
const PRIZE_DOOR_DROP_PX = 9

export const prizeSpotOf = (world: World): Option.Option<Vector> =>
  Option.map(fridgeBoxOf(levelOf(world)), box => ({
    x: Math.round((box.left + box.right) / 2),
    y: box.top + PRIZE_DOOR_DROP_PX,
  }))

// THE TAKE

// NOTE: the player took the weapon on offer this frame: its icon starts
// for the HUD slot. Only the puller sees it, since only they took it.
export const launchPrize = (before: World, after: Model): Model =>
  FridgeDoor.match(before.fridge.door, {
    Shut: () => after,
    Open: () => after,
    Slammed: () => after,
    Offering: ({ prize, slot }) =>
      slot === leadSeatOf(before).slot &&
      Array.some(after.frameEvents, GameEvent.isAnyOf(['PrizeTaken'])) &&
      isWeapon(prize)
        ? Option.match(prizeSpotOf(before), {
            onNone: () => after,
            onSome: from =>
              modifyFields(after, {
                prizeFlight: () =>
                  PrizeFlight.Flying({ prize, from, ageMs: 0 }),
              }),
          })
        : after,
  })

const isWeapon = (
  prize: FridgePrize,
): prize is Extract<FridgePrize, WeaponKind> =>
  prize === 'Cooker' || prize === 'Pan' || prize === 'Freeze'

export const ageFlight = (model: Model, frameMs: number): Model =>
  PrizeFlight.match(model.prizeFlight, {
    Grounded: () => model,
    Flying: flight =>
      modifyFields(model, {
        prizeFlight: () =>
          flight.ageMs + frameMs >= REVEAL_RULES.flightMs + REVEAL_RULES.pulseMs
            ? PrizeFlight.Grounded()
            : PrizeFlight.Flying({ ...flight, ageMs: flight.ageMs + frameMs }),
      }),
  })
