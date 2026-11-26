import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

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
// players when they need to ready up"). The open break before wave 2, which
// has no clock, or a crew's break, ends when this player presses READY, so
// after a quiet moment READY pulses and the HUD says WAITING ON YOU. A solo
// break with a clock (every later one since 2026-11-10) gets no nudge. It is
// a cosmetic of the client: the World never reads it.

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
// It keeps the World's time the quiet began, not a count, so a quiet frame
// writes nothing and the Model is not copied for it: only the frame the
// quiet begins or ends does.
export const advanceBreakIdle: {
  (worldMs: number): (model: Model) => Model
  (model: Model, worldMs: number): Model
} = Function.dual(2, (model: Model, worldMs: number): Model => {
  const isIdle = Phase.isAnyOf(['Preparation'])(model.phase) && !isActive(model)
  if (isIdle === Option.isSome(model.maybeBreakIdleSinceMs)) {
    return model
  }
  return UiStruct.evolve(model, {
    maybeBreakIdleSinceMs: () =>
      isIdle ? Option.some(model.elapsedMs - worldMs) : Option.none(),
  })
})

// NOTE: how long the player has done nothing in this break, in world time.
export const breakIdleMsOf = (model: Model): number =>
  Option.match(model.maybeBreakIdleSinceMs, {
    onNone: () => 0,
    onSome: sinceMs => model.elapsedMs - sinceMs,
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
    QuestTour.isAnyOf(['Running', 'Looking', 'Starting'])(model.firstBreakQuest)
  ) {
    return false
  }
  const lead = leadSeatOf(model)
  if (lead.readiness === 'Ready' || isDowned(lead)) {
    return false
  }
  if (!isCoop(model)) {
    return breakIdleMsOf(model) >= SOLO_NUDGE_MS
  }
  return (
    breakIdleMsOf(model) >=
    (isLastOneIn(model) ? LAST_ONE_NUDGE_MS : CREW_NUDGE_MS)
  )
}
