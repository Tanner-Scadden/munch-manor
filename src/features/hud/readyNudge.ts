import { Array, Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { QuestTour } from '../../domain/clientSchema'
import {
  focusOf,
  isCoop,
  isDowned,
  isHere,
  leadSeatOf,
  playersOf,
} from '../../world/party/party'
import { isPracticeGateHeld } from '../../world/run/lessons'
import { isKitchenTourOn } from '../../world/run/tutorialRules'
import { Phase } from '../../world/schema/worldSchema'

// The nudge for a break that waits on the player (owner, 2026-11-01: "nudge
// players when they need to ready up"). A break with no clock, or a crew's
// break, ends when this player presses READY, so after a quiet moment READY
// pulses and the HUD says WAITING ON YOU. It is a cosmetic of the client: the
// World never reads it.

// NOTE: how long the player has done nothing in the break. In a crew the
// wait is short when everyone else is READY and longer when they are not.
export const SOLO_NUDGE_MS = 15_000
export const CREW_NUDGE_MS = 8_000
export const LAST_ONE_NUDGE_MS = 2_500

const isActive = (model: Model): boolean => {
  const { move, maybeAim, trigger, interact } = focusOf(model).intent
  return (
    move.x !== 0 ||
    move.y !== 0 ||
    maybeAim._tag === 'Some' ||
    trigger === 'Held' ||
    interact === 'Held' ||
    focusOf(model).purchase._tag !== 'Idle'
  )
}

// NOTE: one frame of the idle clock: it counts world time in a break while
// the player does nothing, and any move, shot, or buy starts it over. Outside a break it rests at 0.
export const advanceBreakIdle: {
  (worldMs: number): (model: Model) => Model
  (model: Model, worldMs: number): Model
} = Function.dual(2, (model: Model, worldMs: number): Model => {
  const idleMs =
    Phase.isAnyOf(['Preparation'])(model.phase) && !isActive(model)
      ? model.breakIdleMs + worldMs
      : 0
  return idleMs === model.breakIdleMs
    ? model
    : modifyFields(model, { breakIdleMs: () => idleMs })
})

const isWaitingOnClock = (model: Model): boolean =>
  model.phase._tag === 'Preparation' &&
  (isCoop(model) || model.phase.clock._tag === 'Waiting')

// NOTE: every other player who is here and standing has pressed READY, so
// this player is the one the room waits on.
const isLastOneIn = (model: Model): boolean =>
  isCoop(model) &&
  Array.every(
    playersOf(model),
    ({ seat: { slot }, seat }) =>
      slot === leadSeatOf(model).slot ||
      !isHere(seat) ||
      isDowned(seat) ||
      seat.readiness === 'Ready',
  )

export const isWaitingOnYou = (model: Model): boolean => {
  if (
    !isWaitingOnClock(model) ||
    isPracticeGateHeld(model) ||
    isKitchenTourOn(model) ||
    QuestTour.isAnyOf(['Running', 'Looking'])(model.firstBreakQuest)
  ) {
    return false
  }
  const lead = leadSeatOf(model)
  if (lead.readiness === 'Ready' || isDowned(lead)) {
    return false
  }
  if (!isCoop(model)) {
    return model.breakIdleMs >= SOLO_NUDGE_MS
  }
  return (
    model.breakIdleMs >=
    (isLastOneIn(model) ? LAST_ONE_NUDGE_MS : CREW_NUDGE_MS)
  )
}
