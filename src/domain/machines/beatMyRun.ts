import { Array, Function, Option } from 'effect'
import { Event, Machine } from 'effect-machine'

import { UiStruct } from '@effect/ui'

import type { Model } from '#app/model.ts'
import {
  BeatMyRun,
  FriendsDare,
  OwnPicks,
  noBeatMyRun,
} from '#domain/beatLink.ts'
import type { Difficulty } from '#shared/records/playerData.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { thingsOpenedBy } from '#world/dare/milestones.ts'

import { machineStepOf } from './machineStep.ts'

export const BeatEvent = Event({
  Offered: { dare: FriendsDare },
  Took: { own: OwnPicks },
  Released: {},
  Dismissed: {},
})
export type BeatEvent = typeof BeatEvent.Type

export const beatMachine = Machine.make({
  state: BeatMyRun,
  event: BeatEvent,
  initial: noBeatMyRun,
})
  .on(
    [BeatMyRun.None, BeatMyRun.Offered, BeatMyRun.Taken],
    BeatEvent.Offered,
    ({ event }) => BeatMyRun.Offered({ dare: event.dare }),
  )
  .on(BeatMyRun.Offered, BeatEvent.Took, ({ state, event }) =>
    BeatMyRun.Taken({ dare: state.dare, own: event.own }),
  )
  .on(BeatMyRun.Taken, BeatEvent.Released, ({ state }) =>
    BeatMyRun.Offered({ dare: state.dare }),
  )
  .on(
    [BeatMyRun.Offered, BeatMyRun.Taken],
    BeatEvent.Dismissed,
    () => noBeatMyRun,
  )

export const stepBeat = machineStepOf(beatMachine)

export const maybeShownDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.$match(model.beatMyRun, {
    None: () => Option.none(),
    Offered: ({ dare }) => Option.some(dare),
    Taken: ({ dare }) => Option.some(dare),
  })

export const maybeTakenDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.$is('Taken')(model.beatMyRun)
    ? Option.some(model.beatMyRun.dare)
    : Option.none()

export const isDareTaken = (model: Model): boolean =>
  Option.isSome(maybeTakenDareOf(model))

export const unopenedThingsOf: {
  (dare: FriendsDare): (model: Model) => ReadonlyArray<DareKind>
  (model: Model, dare: FriendsDare): ReadonlyArray<DareKind>
} = Function.dual(
  2,
  (model: Model, dare: FriendsDare): ReadonlyArray<DareKind> => {
    const opened = thingsOpenedBy(model.journal.milestones)
    return Array.filter(dare.pool, kind => !Array.contains(opened, kind))
  },
)

export const savedDifficultyOf = (model: Model): Difficulty =>
  BeatMyRun.$is('Taken')(model.beatMyRun)
    ? model.beatMyRun.own.difficulty
    : model.difficulty.chosen

const withPicks = (model: Model, picks: OwnPicks): Model =>
  UiStruct.evolve(model, {
    home: home =>
      UiStruct.evolve(home, {
        mode: () => picks.mode,
        bots: () => picks.bots,
      }),
    difficulty: setting =>
      UiStruct.evolve(setting, { chosen: () => picks.difficulty }),
    modifiers: () => picks.modifiers,
    dareMark: () => picks.dareMark,
    easyBreakSeconds: () => picks.easyBreakSeconds,
  })

const picksOfDare = (dare: FriendsDare): OwnPicks => ({
  mode: dare.mode,
  difficulty: dare.difficulty,
  modifiers: dare.modifiers,
  dareMark: dare.dareMark,
  easyBreakSeconds: dare.easyBreakSeconds,
  bots: [],
})

const ownPicksOf = (model: Model): OwnPicks => ({
  mode: model.home.mode,
  difficulty: model.difficulty.chosen,
  modifiers: model.modifiers,
  dareMark: model.dareMark,
  easyBreakSeconds: model.easyBreakSeconds,
  bots: model.home.bots,
})

export const withDarePicks: {
  (dare: FriendsDare): (model: Model) => Model
  (model: Model, dare: FriendsDare): Model
} = Function.dual(2, (model: Model, dare: FriendsDare): Model =>
  withPicks(model, picksOfDare(dare)),
)

const picksLeaving = (model: Model, before: BeatMyRun): Model =>
  BeatMyRun.$is('Taken')(before) ? withPicks(model, before.own) : model

const picksEntering = (model: Model, after: BeatMyRun): Model =>
  BeatMyRun.$is('Taken')(after) ? withDarePicks(model, after.dare) : model

const moveBeat = (model: Model, event: BeatEvent): Model => {
  const before = model.beatMyRun
  const after = stepBeat(before, event)
  return after === before
    ? model
    : UiStruct.evolve(picksEntering(picksLeaving(model, before), after), {
        beatMyRun: () => after,
      })
}

export const takeDare = (model: Model): Model =>
  moveBeat(model, BeatEvent.Took({ own: ownPicksOf(model) }))

export const releaseDare = (model: Model): Model =>
  moveBeat(model, BeatEvent.Released)

export const dismissDare = (model: Model): Model =>
  moveBeat(model, BeatEvent.Dismissed)

export const offerDare: {
  (dare: FriendsDare): (model: Model) => Model
  (model: Model, dare: FriendsDare): Model
} = Function.dual(2, (model: Model, dare: FriendsDare): Model =>
  moveBeat(model, BeatEvent.Offered({ dare })),
)
