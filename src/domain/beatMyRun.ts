import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

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

// Beat my run on the root's Model (docs/PROGRESSION_PLAN.md, pillar G): the
// friend's dare offered on the home menu, taken into the lobby with the
// player's own picks kept, and handed back. The link and its Schemas are in
// src/domain/beatLink.ts.

// READING

// NOTE: the dare on the home menu's card: offered, or taken and back home.
export const maybeShownDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.match(model.beatMyRun, {
    None: () => Option.none(),
    Offered: ({ dare }) => Option.some(dare),
    Taken: ({ dare }) => Option.some(dare),
  })

// NOTE: the dare the lobby and the run play, once taken.
export const maybeTakenDareOf = (model: Model): Option.Option<FriendsDare> =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    { Taken: ({ dare }) => Option.some(dare) },
    () => Option.none(),
  )

export const isDareTaken = (model: Model): boolean =>
  Option.isSome(maybeTakenDareOf(model))

// NOTE: the things the dare's list rolls from that this player has not
// opened yet: the friend's dare plays them anyway, and the card says so.
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

// NOTE: the difficulty the save keeps: the player's own, not a friend's
// dare's while it holds the lobby.
export const savedDifficultyOf = (model: Model): Difficulty =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    { Taken: ({ own }) => own.difficulty },
    () => model.difficulty.chosen,
  )

// TAKING AND LETTING GO

// NOTE: the lobby's picks set to the dare's. Bots stay home: the dare was
// one player's, and a crew changes the waves.
const withPicks = (model: Model, picks: OwnPicks): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        mode: () => picks.mode,
        bots: () => picks.bots,
      }),
    difficulty: setting =>
      modifyFields(setting, { chosen: () => picks.difficulty }),
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

// NOTE: the dare's picks, as the run starts: the lobby already holds them,
// and this holds them again in case a synced save moved one.
export const withDarePicks: {
  (dare: FriendsDare): (model: Model) => Model
  (model: Model, dare: FriendsDare): Model
} = Function.dual(
  2,
  (model: Model, dare: FriendsDare): Model =>
    withPicks(model, picksOfDare(dare)),
)

// NOTE: BEAT MY RUN on the card: the lobby's picks become the dare's, the
// player's own kept. Taking it again changes nothing.
export const takeDare = (model: Model): Model =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    {
      Offered: ({ dare }) =>
        modifyFields(withDarePicks(model, dare), {
          beatMyRun: () => BeatMyRun.Taken({ dare, own: ownPicksOf(model) }),
        }),
    },
    () => model,
  )

// NOTE: the player's own picks back, and the dare still offered on the card.
export const releaseDare = (model: Model): Model =>
  BeatMyRun.matchOrElse(
    model.beatMyRun,
    {
      Taken: ({ dare, own }) =>
        modifyFields(withPicks(model, own), {
          beatMyRun: () => BeatMyRun.Offered({ dare }),
        }),
    },
    () => model,
  )

// NOTE: the card's x: the dare goes, and the player's own picks come back.
export const dismissDare = (model: Model): Model =>
  modifyFields(releaseDare(model), { beatMyRun: () => noBeatMyRun })

// NOTE: a link read at start offers its dare, over any offered before.
export const offerDare: {
  (dare: FriendsDare): (model: Model) => Model
  (model: Model, dare: FriendsDare): Model
} = Function.dual(
  2,
  (model: Model, dare: FriendsDare): Model =>
    modifyFields(releaseDare(model), {
      beatMyRun: () => BeatMyRun.Offered({ dare }),
    }),
)
