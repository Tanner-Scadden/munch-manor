import { Effect, Option } from 'effect'

import { Command, Component } from '@effect/ui'

import { addressWithoutDare, readBeatLink } from '../../domain/beatLink'
import { dismissDare, offerDare, takeDare } from '../../domain/beatMyRun'
import { isBeatCardShown } from '../../screens/home/beatCard'
import { stepWhen } from '../../shared/stepWhen'
import { isOnHomeMenu } from '../menuState'
import { Message } from '../message'
import type { Model } from '../model'
import { FocusHomeButton } from './home'
import { openLobby } from './lobby'
import { tapSound, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  unchanged,
} from './step'

// Beat my run on the root (src/domain/beatMyRun.ts): a SHARE link read once
// the splash is gone offers its friend's dare on the home menu; the card's
// tap takes it into the lobby with the picks held to the link's, and its x
// lets it go. START then plays the friend's house (src/app/runFlow.ts).

// COMMANDS

// NOTE: a `?dare=...` in the address, read once, as the room link is.
export const ReadBeatLink = Command.make('ReadBeatLink', { args: {} }, () =>
  Effect.sync(() =>
    Message.CompletedReadBeatLink({
      maybeDare: readBeatLink(location.search),
    }),
  ),
)

export const askForBeatLink: UpdateStep = $ => $.run(ReadBeatLink.make())

// NOTE: a dare read is the Model's from then on, so `?dare=` comes off the
// address (any other parameter kept) and a reload never offers it again.
// It goes at the read, not at a take or a dismiss: a dare left on the card
// and lost to a reload is still in the friend's message. Nothing waits on
// it, so nothing is reported.
export const ForgetBeatLink = Command.make('ForgetBeatLink', { args: {} }, () =>
  Effect.sync(() => {
    history.replaceState(history.state, '', addressWithoutDare(location.href))
  }).pipe(Effect.as(Component.noop)),
)

// STEPS

const isCardUp = (model: Model): boolean =>
  isBeatCardShown(model) && isOnHomeMenu(model)

// NOTE: BEAT MY RUN: the lobby opens on the friend's picks, held, and START
// plays their house.
const takeFromCard: UpdateStep = stepWhen(
  isCardUp,
  combine([modelStep(takeDare), openLobby]),
)

// NOTE: the x: the card goes, the player's own picks come back, and focus
// goes to PLAY so a keyboard or controller player is not left on nothing.
const dismissFromCard: UpdateStep = stepWhen(
  isCardUp,
  combine([
    unlockAudio,
    tapSound,
    modelStep(dismissDare),
    $ => $.run(FocusHomeButton.make({ button: 'Play' })),
  ]),
)

// NOTE: Escape (and a controller's B, which presses it on the home menu,
// src/app/update/padMenu.ts) lets the card go as its x does.
export const beatCardFromKey = (code: string): UpdateStep =>
  code === 'Escape' ? dismissFromCard : unchanged

// HANDLERS

// NOTE: the link read at start and taken off the address, and the card's
// two buttons.
export const beatMyRunHandlers = defineHandlers({
  CompletedReadBeatLink: ($, { maybeDare }) =>
    Option.match(maybeDare, {
      onNone: () => $.model,
      onSome: dare =>
        $.set(offerDare($.model, dare)).run(ForgetBeatLink.make()),
    }),

  ClickedBeatMyRunButton: takeFromCard,

  ClickedDismissBeatMyRunButton: dismissFromCard,
})
