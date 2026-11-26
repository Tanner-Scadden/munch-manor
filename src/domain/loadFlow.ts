import { Array } from 'effect'
import { Event, Machine } from 'effect-machine'

import { LoadStep, Loading } from './clientSchema'
import { machineStepOf } from './machineStep'

export const LoadEvent = Event({
  Finished: { step: LoadStep },
})
export type LoadEvent = typeof LoadEvent.Type

export const loadMachine = Machine.make({
  state: Loading,
  event: LoadEvent,
  initial: Loading.Loaded,
}).when(
  Loading.Loading,
  LoadEvent.Finished,
  function isWaitingOn({ state, event }) {
    return Array.contains(state.pending, event.step)
  },
  ({ state, event }) => {
    const pending = Array.filter(state.pending, step => step !== event.step)
    return Array.isReadonlyArrayEmpty(pending)
      ? Loading.Loaded
      : Loading.Loading({ pending })
  },
)

export const stepLoading = machineStepOf(loadMachine)
