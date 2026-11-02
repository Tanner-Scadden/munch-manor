import { Effect, Option } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { makeCommand, makeStep } from '../definition'
import { chooseDifficulty, isLocked } from '../difficulty'
import { runModeOf, switchMode } from '../home'
import { isStartKey, maybeFocusStep } from '../input'
import {
  LOBBY_KEYS,
  lobbyControlId,
  nextDifficultyOf,
  steppedLobbyFocus,
  withLobby,
} from '../lobby'
import { isLobbyOpen, isOnHomeMenu } from '../menuState'
import { Message } from '../message'
import {
  type Difficulty,
  type HomeMode,
  LobbyControl,
  type Model,
} from '../model'
import { isLearned } from '../onboarding'
import {
  FocusHomeButton,
  isAskingDifficultyFirst,
  openPanel,
  startOrAsk,
  startWithMode,
} from './home'
import { tapSound, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  modelStep,
  releaseInput,
  unchanged,
} from './step'

// The single player lobby's Steps (src/lobby.ts holds its rules and
// src/lobbyView.ts its view). PLAY opens it; START starts the run with what
// it holds; BACK and Esc go home. RETRY, AGAIN, and KEEP GOING never come
// here: they replay the settings the run had.

// COMMAND

export const FocusLobbyControl = makeCommand('FocusLobbyControl', {
  args: { control: LobbyControl },
  messages: [Message.CompletedFocusLobbyControl],
  handler: function* () {
    return ({ control }) =>
      Dom.focus(`#${lobbyControlId(control)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusLobbyControl()),
      )
  },
})

const noteFocus = (model: Model, maybeControl: Option.Option<LobbyControl>) =>
  modifyFields(model, {
    home: home => modifyFields(home, { maybeLobbyFocus: () => maybeControl }),
  })

export const focusedLobbyControl = (
  model: Model,
  control: LobbyControl,
): Model => noteFocus(model, Option.some(control))

export const blurredLobbyControl = (model: Model): Model =>
  noteFocus(model, Option.none())

const focusLobby =
  (control: LobbyControl): UpdateStep =>
  stepModel => ({
    model: focusedLobbyControl(stepModel, control),
    commands: [FocusLobbyControl({ control })],
  })

// OPENING

// NOTE: a player who has not learned to move and shoot yet is still in the
// tutorial's practice gate, and one who has not picked a difficulty is
// still being asked. There is nothing to choose for them: PLAY starts the
// tutorial, as it always did (src/onboarding.ts, "Show, don't explain").
const isInPracticeGate = (model: Model): boolean =>
  !isLearned(model.lessons.move) || !isLearned(model.lessons.fire)

const skipsLobby = (model: Model): boolean =>
  isAskingDifficultyFirst(model) || isInPracticeGate(model)

const openLobby: UpdateStep = stepModel =>
  combine(stepModel, [
    releaseInput,
    modelStep(model => withLobby(model, 'Open')),
    focusLobby('Start'),
  ])

const focusHomePlay: UpdateStep = stepModel => ({
  model: stepModel,
  commands: [FocusHomeButton({ button: 'Play' })],
})

// NOTE: PLAY, by tap or by Enter.
export const playFromHome = makeStep(model => {
  if (skipsLobby(model)) {
    return startOrAsk(runModeOf(model.home.mode))
  } else if (isOnHomeMenu(model)) {
    return Update.combineSteps([unlockAudio, tapSound, openLobby])
  } else {
    return unchanged
  }
})

export const playFromKey = (code: string) =>
  makeStep(() => (isStartKey(code) ? playFromHome : unchanged))

// LEAVING

export const startFromLobby = makeStep(model =>
  isLobbyOpen(model)
    ? Update.combineSteps([
        modelStep(current => withLobby(current, 'Closed')),
        startWithMode(runModeOf(model.home.mode)),
      ])
    : unchanged,
)

export const backFromLobby = makeStep(model =>
  isLobbyOpen(model)
    ? Update.combineSteps([
        modelStep(current => withLobby(current, 'Closed')),
        tapSound,
        focusHomePlay,
      ])
    : unchanged,
)

// PICKS

// NOTE: a pick puts focus on START, so Enter after a pick starts the run
// instead of pressing the tile again.
const picked = (pick: UpdateStep) =>
  makeStep(model =>
    isLobbyOpen(model)
      ? Update.combineSteps([pick, tapSound, focusLobby('Start')])
      : unchanged,
  )

export const pickLobbyMode = (mode: HomeMode) =>
  picked(
    modelStep(model => (model.home.mode === mode ? model : switchMode(model))),
  )

export const pickLobbyDifficulty = (difficulty: Difficulty) =>
  makeStep(model =>
    isLocked(model.difficulty, difficulty)
      ? unchanged
      : picked(modelStep(current => chooseDifficulty(current, difficulty))),
  )

export const openLobbyHero = makeStep(model =>
  isLobbyOpen(model) ? openPanel('Calling') : unchanged,
)

// KEYS

// NOTE: Enter starts, Esc goes back, and E, X, and Y pick as their pills
// did at home. The arrows walk the controls. A key on a focused button is
// that button's own (src/subscriptions.ts), so Enter there presses it.
export const lobbyFromKey = (code: string) =>
  makeStep(model => {
    const maybeStep = maybeFocusStep(code)
    if (!isLobbyOpen(model)) {
      return unchanged
    } else if (code === LOBBY_KEYS.Start.code) {
      return startFromLobby
    } else if (code === LOBBY_KEYS.Back.code) {
      return backFromLobby
    } else if (code === LOBBY_KEYS.Mode.code) {
      return pickLobbyMode(
        model.home.mode === 'Campaign' ? 'Endless' : 'Campaign',
      )
    } else if (code === LOBBY_KEYS.Difficulty.code) {
      return pickLobbyDifficulty(nextDifficultyOf(model))
    } else if (code === LOBBY_KEYS.Hero.code) {
      return openLobbyHero
    } else {
      return Option.match(maybeStep, {
        onNone: () => unchanged,
        onSome: step =>
          focusLobby(steppedLobbyFocus(model.home.maybeLobbyFocus, step)),
      })
    }
  })
