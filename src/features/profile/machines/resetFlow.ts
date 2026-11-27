import { Event, Machine, State } from 'effect-machine'

import { machineStepOf } from '#domain/machines/machineStep.ts'

export const TutorialReset = State({
  Idle: {},
  Asking: {},
  Done: {},
})
export type TutorialReset = typeof TutorialReset.Type

export const ResetEvent = Event({
  Asked: {},
  Confirmed: {},
  Cancelled: {},
  LeftTab: {},
})
export type ResetEvent = typeof ResetEvent.Type

export const resetMachine = Machine.make({
  state: TutorialReset,
  event: ResetEvent,
  initial: TutorialReset.Idle,
})
  .on(
    [TutorialReset.Idle, TutorialReset.Done],
    ResetEvent.Asked,
    () => TutorialReset.Asking,
  )
  .on(TutorialReset.Asking, ResetEvent.Confirmed, () => TutorialReset.Done)
  .on(TutorialReset.Asking, ResetEvent.Cancelled, () => TutorialReset.Idle)
  .on(
    [TutorialReset.Asking, TutorialReset.Done],
    ResetEvent.LeftTab,
    () => TutorialReset.Idle,
  )

export const stepReset = machineStepOf(resetMachine)
