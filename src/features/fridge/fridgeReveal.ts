import { Array, Function, Option, pipe } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { PrizeFlight } from '../../domain/clientSchema'
import { FRIDGE_SPIN_STEPS_MS } from '../../shared/constants'
import type { SoundEffect } from '../../shared/soundEffect'
import {
  FRIDGE_RULES,
  PRIZE_ORDER,
  fridgeBoxOf,
} from '../../world/fridge/leftovers'
import { levelOf } from '../../world/level/arena'
import { PRIZE_PUNCH_LINES } from '../../world/names'
import { leadSeatOf } from '../../world/party/party'
import type { World } from '../../world/schema/world'
import {
  FridgeDoor,
  type FridgePrize,
  GameEvent,
  type Vector,
  type WeaponKind,
} from '../../world/schema/worldSchema'

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

export type RevealStage =
  | Readonly<{ _tag: 'Spinning'; face: FridgePrize; step: number }>
  | Readonly<{ _tag: 'Landed'; sinceMs: number }>

export const revealStageAt: {
  (elapsedMs: number): (prize: FridgePrize) => RevealStage
  (prize: FridgePrize, elapsedMs: number): RevealStage
} = Function.dual(2, (prize: FridgePrize, elapsedMs: number): RevealStage => {
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
})

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

export const maybeLandedBetween: {
  (after: FridgeDoor): (before: FridgeDoor) => Option.Option<FridgePrize>
  (before: FridgeDoor, after: FridgeDoor): Option.Option<FridgePrize>
} = Function.dual(
  2,
  (before: FridgeDoor, after: FridgeDoor): Option.Option<FridgePrize> =>
    pipe(
      doorRevealOf(after),
      Option.filter(isLanded),
      Option.filter(() => !Option.exists(doorRevealOf(before), isLanded)),
      Option.map(({ prize }) => prize),
    ),
)

const PRIZE_DOOR_DROP_PX = 9

export const prizeSpotOf = (world: World): Option.Option<Vector> =>
  Option.map(fridgeBoxOf(levelOf(world)), box => ({
    x: Math.round((box.left + box.right) / 2),
    y: box.top + PRIZE_DOOR_DROP_PX,
  }))

export const launchPrize: {
  (after: Model): (before: World) => Model
  (before: World, after: Model): Model
} = Function.dual(2, (before: World, after: Model): Model =>
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
              UiStruct.evolve(after, {
                cosmetics: cosmetics =>
                  UiStruct.evolve(cosmetics, {
                    prizeFlight: () =>
                      PrizeFlight.Flying({ prize, from, ageMs: 0 }),
                  }),
              }),
          })
        : after,
  }),
)

const isWeapon = (
  prize: FridgePrize,
): prize is Extract<FridgePrize, WeaponKind> =>
  prize === 'Cooker' || prize === 'Pan' || prize === 'Freeze'

export const ageFlight: {
  (frameMs: number): (model: Model) => Model
  (model: Model, frameMs: number): Model
} = Function.dual(2, (model: Model, frameMs: number): Model =>
  PrizeFlight.match(model.cosmetics.prizeFlight, {
    Grounded: () => model,
    Flying: flight =>
      UiStruct.evolve(model, {
        cosmetics: cosmetics =>
          UiStruct.evolve(cosmetics, {
            prizeFlight: () =>
              flight.ageMs + frameMs >=
              REVEAL_RULES.flightMs + REVEAL_RULES.pulseMs
                ? PrizeFlight.Grounded()
                : PrizeFlight.Flying({
                    ...flight,
                    ageMs: flight.ageMs + frameMs,
                  }),
          }),
      }),
  }),
)
