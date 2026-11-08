import { Array, Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  activeBots,
  addBot,
  removeBot,
  setBotCalling,
} from '../../features/bots/bots'
import { buyCalling, chooseCalling } from '../../features/heroes/callingPick'
import { PickOutcome } from '../../features/heroes/inMessage'
import {
  isOnHome,
  lobbyPicksOf,
  runModeOf,
  switchMode,
} from '../../features/home/home'
import {
  FocusHomeButton,
  isAskingDifficultyFirst,
  startOrAsk,
  startWithMode,
} from '../../features/home/update'
import { isLearned } from '../../features/onboarding/onboarding'
import { markCallingsSeen } from '../../features/unlocks/update'
import { isStartKey, releaseAll } from '../../input/input'
import type { Calling, Difficulty } from '../../shared/playerData'
import {
  type CallingStanding,
  callingStandingOf,
  canAffordCalling,
  isCallingOwned,
} from '../../world/heroes/calling'
import { rankOf, totalPointsOf } from '../../world/heroes/rank'
import { chooseDifficulty } from '../../world/run/difficulty'
import { type Modifier, toggledModifier } from '../../world/run/modifiers'
import { LobbyBinding } from '../bindings'
import { makeStep } from '../definition'
import { isOnHomeMenu } from '../menuState'
import type { HomeMode, Model } from '../model'
import { playSounds, tapSound, uiCue, unlockAudio } from './sound'
import {
  type UpdateStep,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
  withInput,
} from './step'

// NOTE: the root's side of the single player lobby (src/features/lobby/):
// PLAY opens it, the keys go to it, and its OutMessages, folded in
// src/app/composition.ts, make each pick on the root's own fields. The root
// keeps the picks (the difficulty is saved, and a run reads them all), rolls
// a bot from its seeded generator, and judges a hero card and BUY by the
// rank, the heroes bought, and the Bones.

// OPENING

// NOTE: a player who has not learned to move and shoot yet is still in the
// tutorial's practice gate, and one who has not picked a difficulty is
// still being asked. There is nothing to choose for them: PLAY starts the
// tutorial, as it always did (src/features/onboarding/onboarding.ts, "Show,
// don't explain").
const isInPracticeGate = (model: Model): boolean =>
  !isLearned(model.lessons.move) || !isLearned(model.lessons.fire)

const skipsLobby = (model: Model): boolean =>
  isAskingDifficultyFirst(model) || isInPracticeGate(model)

const openLobby = makeStep(model =>
  Update.combineSteps([
    unlockAudio,
    tapSound,
    releaseInput,
    LobbyBinding.requestOpen(lobbyPicksOf(model)),
  ]),
)

// NOTE: PLAY, by tap or by Enter.
const playFromHome = makeStep(model => {
  if (skipsLobby(model)) {
    return startOrAsk(runModeOf(model.home.mode))
  } else if (isOnHomeMenu(model)) {
    return openLobby
  } else {
    return unchanged
  }
})

export const playFromKey = (code: string) =>
  makeStep(() => (isStartKey(code) ? playFromHome : unchanged))

// NOTE: every key goes to the open lobby, as to co-op.
export const lobbyFromKey = (code: string) =>
  makeStep(model => LobbyBinding.requestPressKey({ code }, lobbyPicksOf(model)))

// LEAVING

export const startFromLobby = makeStep(model =>
  startWithMode(runModeOf(model.home.mode)),
)

const focusHomePlay: UpdateStep = stepModel => ({
  model: stepModel,
  commands: [FocusHomeButton({ button: 'Play' })],
})

export const leaveLobby = Update.combineSteps([tapSound, focusHomePlay])

// PICKS

// NOTE: each pick taps, as a menu button does.
const pick = (change: (model: Model) => Model) =>
  Update.combineSteps([modelStep(change), tapSound])

export const chooseMode = (mode: HomeMode) =>
  pick(model => (model.home.mode === mode ? model : switchMode(model)))

export const chooseLobbyDifficulty = (difficulty: Difficulty) =>
  pick(model => chooseDifficulty(model, difficulty))

export const toggleModifier = (modifier: Modifier) =>
  pick(model =>
    modifyFields(model, {
      modifiers: modifiers => toggledModifier(modifiers, modifier),
    }),
  )

// NOTE: + BOT seats a bot in the next empty seat, with a goofy name and a
// hero picked at random from the heroes this player has unlocked.
export const addLobbyBot = pick(addBot)

// NOTE: the last bot leaving takes Friendly Fire with it: it has nobody to
// hit, and the tile goes dim.
export const dropLobbyBot = (index: number) =>
  pick(model => {
    const removed = removeBot(model, index)
    return Array.isReadonlyArrayEmpty(activeBots(removed))
      ? modifyFields(removed, {
          modifiers: modifiers =>
            modifyFields(modifiers, { friendlyFire: () => false }),
        })
      : removed
  })

// NOTE: the picker opened: its tap, its heroes no longer NEW on the
// lobby's card, and no key or stick held under it.
export const openHeroPicker = Update.combineSteps([
  unlockAudio,
  tapSound,
  modelStep(model => withInput(markCallingsSeen(model), releaseAll)),
])

// THE HERO PICKER

const answer = (outcome: PickOutcome) =>
  makeStep(model =>
    LobbyBinding.informOfHeroOutcome({ outcome }, lobbyPicksOf(model)),
  )

const denied = (outcome: PickOutcome) =>
  Update.combineSteps([playSounds([uiCue('Denied')]), answer(outcome)])

const standingOf = (model: Model, calling: Calling): CallingStanding =>
  callingStandingOf(
    calling,
    rankOf(totalPointsOf(model.rank)),
    model.boughtCosmetics,
  )

// NOTE: a hero card for the player's own pick. An owned hero is the pick.
// One for sale (its rank is reached) is tried on, and its BUY pill buys it.
// A locked one shakes.
const PLAYER_TAPS = {
  Owned: (calling: Calling) =>
    Update.combineSteps([
      modelStep(model => chooseCalling(model, calling)),
      answer(PickOutcome.Worn({ calling })),
    ]),
  ForSale: (calling: Calling) =>
    Update.combineSteps([
      playSounds([uiCue('Pop')]),
      answer(PickOutcome.TriedOn({ calling })),
    ]),
  Locked: () => denied(PickOutcome.TryOnEnded()),
} satisfies Record<CallingStanding, unknown>

// NOTE: a teammate bot only takes a hero the player owns.
const forBot = (model: Model, index: number, calling: Calling) =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? Update.combineSteps([
        modelStep(current => setBotCalling(current, index, calling)),
        answer(PickOutcome.Worn({ calling })),
      ])
    : denied(PickOutcome.TryOnEnded())

// NOTE: a calling is picked in the lobby's picker, never in a run.
export const pickHero = ({
  calling,
  maybeBot,
}: Readonly<{ calling: Calling; maybeBot: Option.Option<number> }>) =>
  makeStep(model =>
    isOnHome(model.phase)
      ? Option.match(maybeBot, {
          onNone: () => PLAYER_TAPS[standingOf(model, calling)](calling),
          onSome: index => forBot(model, index, calling),
        })
      : unchanged,
  )

// NOTE: the BUY pill: spends the Bones on the hero being tried on and makes
// it the pick, and the picker closes. Short of Bones it shakes and stays.
// Nothing but the try-on's end for a hero no longer for sale.
export const buyHero = (calling: Calling) =>
  makeStep(model => {
    if (!isOnHome(model.phase)) {
      return unchanged
    } else if (standingOf(model, calling) !== 'ForSale') {
      return answer(PickOutcome.TryOnEnded())
    } else if (canAffordCalling(model.rank, calling)) {
      return Update.combineSteps([
        modelStep(current => buyCalling(current, calling)),
        playSounds([uiCue('Purchase')]),
        answer(PickOutcome.Worn({ calling })),
      ])
    } else {
      return denied(PickOutcome.Unchanged())
    }
  })

// NOTE: PLAY from home opens the lobby (or starts a new player's run).
export const lobbyHandlers = defineHandlers({
  ClickedPlayButton: model => Update.combineSteps(model, [playFromHome]),
})
