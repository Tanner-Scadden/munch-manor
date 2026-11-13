import { Effect, Option } from 'effect'
import { Update } from 'foldkit'

import { addressWithoutDare, readBeatLink } from '../../domain/beatLink'
import { dismissDare, offerDare, takeDare } from '../../domain/beatMyRun'
import { isBeatCardShown } from '../../screens/home/beatCard'
import { ApplicationBlock, makeStep } from '../definition'
import { isOnHomeMenu } from '../menuState'
import { Message } from '../message'
import { FocusHomeButton } from './home'
import { openLobby } from './lobby'
import { tapSound, unlockAudio } from './sound'
import { type UpdateStep, defineHandlers, modelStep, unchanged } from './step'

// Beat my run on the root (src/domain/beatMyRun.ts): a SHARE link read once
// the splash is gone offers its friend's dare on the home menu; the card's
// tap takes it into the lobby with the picks held to the link's, and its x
// lets it go. START then plays the friend's house (src/app/runFlow.ts).

// COMMAND

// NOTE: a `?dare=...` in the address, read once, as the room link is.
export const ReadBeatLink = ApplicationBlock.makeCommand('ReadBeatLink', {
  messages: [Message.CompletedReadBeatLink],
  handler: function* () {
    return () =>
      Effect.sync(() =>
        Message.CompletedReadBeatLink({
          maybeDare: readBeatLink(location.search),
        }),
      )
  },
})

export const askForBeatLink: UpdateStep = model => ({
  model,
  commands: [ReadBeatLink()],
})

// NOTE: a dare read is the Model's from then on, so `?dare=` comes off the
// address (any other parameter kept) and a reload never offers it again.
// It goes at the read, not at a take or a dismiss: a dare left on the card
// and lost to a reload is still in the friend's message.
export const ForgetBeatLink = ApplicationBlock.makeCommand('ForgetBeatLink', {
  messages: [Message.CompletedForgetBeatLink],
  handler: function* () {
    return () =>
      Effect.sync(() => {
        history.replaceState(
          history.state,
          '',
          addressWithoutDare(location.href),
        )
      }).pipe(Effect.ignore, Effect.as(Message.CompletedForgetBeatLink()))
  },
})

// STEPS

// NOTE: BEAT MY RUN: the lobby opens on the friend's picks, held, and START
// plays their house.
const takeFromCard = makeStep(model =>
  isBeatCardShown(model) && isOnHomeMenu(model)
    ? Update.combineSteps([modelStep(takeDare), openLobby])
    : unchanged,
)

// NOTE: the x: the card goes, the player's own picks come back, and focus
// goes to PLAY so a keyboard or controller player is not left on nothing.
const dismissFromCard = makeStep(model =>
  isBeatCardShown(model) && isOnHomeMenu(model)
    ? Update.combineSteps([
        unlockAudio,
        tapSound,
        modelStep(dismissDare),
        stepModel => ({
          model: stepModel,
          commands: [FocusHomeButton({ button: 'Play' })],
        }),
      ])
    : unchanged,
)

// NOTE: Escape (and a controller's B, which presses it on the home menu,
// src/app/update/padMenu.ts) lets the card go as its x does.
export const beatCardFromKey = (code: string) =>
  code === 'Escape' ? dismissFromCard : unchanged

// HANDLERS

// NOTE: the link read at start and taken off the address, and the card's
// two buttons.
export const beatMyRunHandlers = defineHandlers({
  CompletedReadBeatLink: (model, { maybeDare }) =>
    Option.match(maybeDare, {
      onNone: () => ({ model }),
      onSome: dare => ({
        model: offerDare(model, dare),
        commands: [ForgetBeatLink()],
      }),
    }),

  CompletedForgetBeatLink: model => ({ model }),

  ClickedBeatMyRunButton: model => Update.combineSteps(model, [takeFromCard]),

  ClickedDismissBeatMyRunButton: model =>
    Update.combineSteps(model, [dismissFromCard]),
})
