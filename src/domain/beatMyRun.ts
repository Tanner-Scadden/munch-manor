import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../app/model'
import type { Difficulty } from '../shared/playerData'
import type { DareKind } from '../world/dare/dareSchema'
import { thingsOpenedBy } from '../world/dare/milestones'
import {
  BeatMyRun,
  type FriendsDare,
  type OwnPicks,
  noBeatMyRun,
} from './beatLink'

export const maybeShownDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.match(model.beatMyRun, {
    None: () => Option.none(),
    Offered: ({ dare }) => Option.some(dare),
    Taken: ({ dare }) => Option.some(dare),
  })

export const maybeTakenDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    { Taken: ({ dare }) => Option.some(dare) },
    () => Option.none(),
  )

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
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    { Taken: ({ own }) => own.difficulty },
    () => model.difficulty.chosen,
  )

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

export const takeDare = (model: Model): Model =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    {
      Offered: ({ dare }) =>
        UiStruct.evolve(withDarePicks(model, dare), {
          beatMyRun: () => BeatMyRun.Taken({ dare, own: ownPicksOf(model) }),
        }),
    },
    () => model,
  )

export const releaseDare = (model: Model): Model =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    {
      Taken: ({ dare, own }) =>
        UiStruct.evolve(withPicks(model, own), {
          beatMyRun: () => BeatMyRun.Offered({ dare }),
        }),
    },
    () => model,
  )

export const dismissDare = (model: Model): Model =>
  UiStruct.evolve(releaseDare(model), { beatMyRun: () => noBeatMyRun })

export const offerDare: {
  (dare: FriendsDare): (model: Model) => Model
  (model: Model, dare: FriendsDare): Model
} = Function.dual(2, (model: Model, dare: FriendsDare): Model =>
  UiStruct.evolve(releaseDare(model), {
    beatMyRun: () => BeatMyRun.Offered({ dare }),
  }),
)
