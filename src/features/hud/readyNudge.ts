import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import { QuestTour } from '#domain/clientSchema.ts'
import {
  focusOf,
  isCoop,
  isDowned,
  isHere,
  leadSeatOf,
  playersOf,
} from '#world/party/party.ts'
import { isPracticeGateHeld } from '#world/run/lessons.ts'
import { isKitchenTourOn } from '#world/run/tutorialRules.ts'
import { Phase } from '#world/schema/worldSchema.ts'

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

export const breakIdleMsOf = (model: Model): number =>
  Option.match(model.maybeBreakIdleSinceMs, {
    onNone: () => 0,
    onSome: sinceMs => model.elapsedMs - sinceMs,
  })

const isWaitingOnClock = (model: Model): boolean =>
  model.phase._tag === 'Preparation' &&
  (isCoop(model) || model.phase.clock._tag === 'Waiting')

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
