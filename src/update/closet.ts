import { Effect, Option } from 'effect'
import { Dom } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  type ClosetTap,
  type RealHat,
  closetCardId,
  closetTapOf,
  priceOf,
} from '../closet'
import { makeCommand } from '../definition'
import { isProfileOpenOn } from '../menuState'
import { Message } from '../message'
import type { ClosetCueKind, Model } from '../model'
import { Hat } from '../playerData'
import { rankOf, totalPointsOf } from '../rank'
import { stepWhen } from '../stepWhen'
import { playSounds, uiCue } from './sound'
import type { UpdateReturn, UpdateStep } from './step'

// NOTE: the closet tab's taps (src/closetView.ts), over the pure rules in
// src/closet.ts. The look and the Bones are the root's: a tap puts a hat on
// or takes it off the look, and a buy also spends the price. The save then
// carries both through the sync mutations, where the Bones balance decides
// again (BoughtCosmetic in src/playerScope.ts).

export const FocusClosetCard = makeCommand('FocusClosetCard', {
  args: { hat: Hat },
  messages: [Message.CompletedFocusClosetCard],
  handler: function* () {
    return ({ hat }) =>
      Dom.focus(`#${closetCardId(hat)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusClosetCard()),
      )
  },
})

export const stepClosetFocus = (model: Model, hat: Hat): UpdateReturn =>
  isProfileOpenOn(model, 'Closet')
    ? { model, commands: [FocusClosetCard({ hat })] }
    : { model }

const withCue = (model: Model, hat: Hat, kind: ClosetCueKind): Model =>
  modifyFields(model, {
    profile: profile =>
      modifyFields(profile, {
        closetCue: cue => ({ hat, kind, count: cue.count + 1 }),
      }),
  })

const wearing = (model: Model, hat: Hat): Model =>
  modifyFields(model, {
    appearance: look => modifyFields(look, { hat: () => hat }),
  })

const spentOn = (model: Model, hat: RealHat): Model =>
  modifyFields(model, {
    rank: rank =>
      modifyFields(rank, {
        spentBones: spent => spent + Option.getOrElse(priceOf(hat), () => 0),
      }),
    boughtHats: bought => [...bought, hat],
  })

const TAPS: Readonly<
  Record<ClosetTap, (model: Model, hat: RealHat) => UpdateReturn>
> = {
  TakeOff: (model, hat) =>
    playSounds([uiCue('Pop')])(withCue(wearing(model, 'None'), hat, 'Worn')),
  Wear: (model, hat) =>
    playSounds([uiCue('Pop')])(withCue(wearing(model, hat), hat, 'Worn')),
  Buy: (model, hat) =>
    playSounds([uiCue('Purchase')])(
      withCue(wearing(spentOn(model, hat), hat), hat, 'Bought'),
    ),
  Short: (model, hat) =>
    playSounds([uiCue('Denied')])(withCue(model, hat, 'Short')),
  Nothing: (model, hat) =>
    playSounds([uiCue('Denied')])(withCue(model, hat, 'Short')),
}

// NOTE: a tap on a card: take a worn hat off, put an owned one on, buy and
// wear one for sale, or shake the price (or the padlock) when it cannot be.
export const tapHat = (hat: RealHat): UpdateStep =>
  stepWhen(
    model => isProfileOpenOn(model, 'Closet'),
    model =>
      TAPS[
        closetTapOf(
          hat,
          model.appearance.hat,
          model.boughtHats,
          model.rank,
          rankOf(totalPointsOf(model.rank)),
        )
      ](model, hat),
  )
