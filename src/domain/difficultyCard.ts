import { Event, Machine } from 'effect-machine'

import { TutorialChoice } from '../shared/nameKeys'
import { RunMode } from '../world/schema/worldSchema'
import { DifficultyCard } from './clientSchema'
import { machineStepOf } from './machineStep'

export const CardEvent = Event({
  Asked: { mode: RunMode },
  PickedTutorial: { tutorial: TutorialChoice },
  Chose: {},
  WentBack: {},
  Remembered: {},
})
export type CardEvent = typeof CardEvent.Type

export const difficultyCardMachine = Machine.make({
  state: DifficultyCard,
  event: CardEvent,
  initial: DifficultyCard.Unseen,
})
  .on(DifficultyCard.Unseen, CardEvent.Asked, ({ event }) =>
    DifficultyCard.Asking({ mode: event.mode, tutorial: 'Tutorial' }),
  )
  .when(
    DifficultyCard.Asking,
    CardEvent.PickedTutorial,
    function isAnotherChoice({ state, event }) {
      return state.tutorial !== event.tutorial
    },
    ({ state, event }) =>
      DifficultyCard.Asking({ mode: state.mode, tutorial: event.tutorial }),
  )
  .on(DifficultyCard.Asking, CardEvent.Chose, () => DifficultyCard.Seen)
  .on(DifficultyCard.Asking, CardEvent.WentBack, () => DifficultyCard.Unseen)
  .on(
    [DifficultyCard.Unseen, DifficultyCard.Asking],
    CardEvent.Remembered,
    () => DifficultyCard.Seen,
  )

export const stepDifficultyCard = machineStepOf(difficultyCardMachine)
