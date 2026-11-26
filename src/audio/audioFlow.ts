import { Event, Machine } from 'effect-machine'

import { AudioState } from '#domain/clientSchema.ts'
import { machineStepOf } from '#domain/machineStep.ts'

export const AudioEvent = Event({
  Unlocked: {},
  GotEngine: {},
  FailedToGetEngine: {},
  Resumed: {},
  WentQuiet: {},
})
export type AudioEvent = typeof AudioEvent.Type

export const audioMachine = Machine.make({
  state: AudioState,
  event: AudioEvent,
  initial: AudioState.Locked,
})
  .on(AudioState.Locked, AudioEvent.Unlocked, () => AudioState.Unlocking)
  .on(AudioState.Unlocking, AudioEvent.GotEngine, () => AudioState.Suspended)
  .on(
    AudioState.Unlocking,
    AudioEvent.FailedToGetEngine,
    () => AudioState.Unavailable,
  )
  .on(AudioState.Suspended, AudioEvent.Resumed, () => AudioState.Ready)
  .on(AudioState.Ready, AudioEvent.WentQuiet, () => AudioState.Suspended)

export const stepAudio = machineStepOf(audioMachine)
