import { Array, Duration, Effect, Option } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { isDareTaken, releaseDare } from '../../domain/beatMyRun'
import { activeBots, addBot, removeBot, setBotCalling } from '../../domain/bots'
import { fitDareMark, nextMarkOf } from '../../domain/dareMarks'
import { isOnHome } from '../../domain/run'
import { markCallingsSeen } from '../../domain/unlocks'
import { buyCalling, chooseCalling } from '../../features/heroes/callingPick'
import {
  LOBBY_KEYS,
  isEasyBreakShown,
  isLockedByDare,
  isMarkShown,
  isModifierPickable,
  lobbyControlId,
  nextDifficultyOf,
  steppedLobbyFocus,
} from '../../features/lobby/lobby'
import { LobbyMessage } from '../../features/lobby/message'
import {
  LobbyControl,
  type LobbyState,
  closedHeroPicker,
  finishedFold,
  isHeroPickerUp,
  isLobbyActive,
  openedHeroPicker,
  openedLobby,
  withLobbyFocus,
  withLobbyStatus,
  withTrying,
  withoutPickingBot,
} from '../../features/lobby/model'
import { isLearned } from '../../features/onboarding/onboarding'
import { isStartKey, maybeFocusStep, releaseAll } from '../../input/input'
import { lobbyPicksOf, runModeOf, switchMode } from '../../screens/home/home'
import type { Calling, Difficulty } from '../../shared/playerData'
import { stepWhen } from '../../shared/stepWhen'
import { focusById } from '../../ui/menuParts'
import {
  type CallingStanding,
  callingStandingOf,
  canAffordCalling,
  isCallingOwned,
} from '../../world/heroes/calling'
import { rankOf, totalPointsOf } from '../../world/heroes/rank'
import {
  chooseDifficulty,
  isLocked,
  nextEasyBreakOf,
} from '../../world/run/difficulty'
import { type Modifier, toggledModifier } from '../../world/run/modifiers'
import { isOnHomeMenu } from '../menuState'
import type { HomeMode, Model } from '../model'
import {
  FocusHomeButton,
  isAskingDifficultyFirst,
  startOrAsk,
  startWithMode,
} from './home'
import { playSounds, tapSound, uiCue, unlockAudio } from './sound'
import {
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
  withInput,
} from './step'

// NOTE: the root's side of the single player lobby (src/features/lobby/).
// The root owns it whole: the picks (the difficulty is saved, and a run
// reads them all) and the lobby's state (`model.lobby`: where the card
// stands, the control in focus, the hero picker and the bot it chooses
// for, the hero tried on), which menuState and the keys read. PLAY opens
// it, the keys come here (`lobbyFromKey`, controllers too), and each event
// the Lobby component raises arrives as a `LobbyMessage`
// (src/app/lobbyView.ts) for these handlers to judge and make: a bot rolled
// from the seeded generator, a hero card and BUY judged by the rank, the
// heroes bought, and the Bones.

// COMMANDS

// NOTE: puts focus on a lobby control by its id, so the arrow keys and a
// pick's hand-off to START land on the page.
export const FocusLobbyControl = Command.make(
  'FocusLobbyControl',
  { args: { control: LobbyControl }, mode: 'switch' },
  ({ control }) =>
    Effect.as(focusById(lobbyControlId(control)), Component.noop),
)

// NOTE: how long the card takes to fold back into PLAY (lobby.css,
// `--dare-close-ms`), after which it is gone. A player who opens it again
// before then gets it Open, and the late CompletedLobbyFold changes nothing.
const FOLD_MS = 280

export const FoldLobby = Command.make(
  'FoldLobby',
  { args: {}, mode: 'switch' },
  () =>
    Effect.sleep(Duration.millis(FOLD_MS)).pipe(
      Effect.as(LobbyMessage.CompletedLobbyFold()),
    ),
)

// THE LOBBY'S STATE

const lobbyStep = (change: (lobby: LobbyState) => LobbyState): UpdateStep =>
  modelStep(model => UiStruct.evolve(model, { lobby: change }))

// NOTE: focus on a control, kept on the Model for the arrow keys to step
// from, and put there on the page.
const focusLobby =
  (control: LobbyControl): UpdateStep =>
  $ =>
    $.evolve({ lobby: withLobbyFocus(Option.some(control)) }).run(
      FocusLobbyControl.make({ control }),
    )

// NOTE: the lobby takes taps and keys while it is up with nothing over it:
// the hero picker's Dialog takes them while it is open.
const whenActive = (step: UpdateStep): UpdateStep =>
  stepWhen((model: Model) => isLobbyActive(model.lobby), step)

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

// NOTE: the card opens with START in focus, so Enter plays at once.
export const openLobby: UpdateStep = combine([
  unlockAudio,
  tapSound,
  releaseInput,
  lobbyStep(openedLobby),
  focusLobby('Start'),
])

// NOTE: PLAY, by tap or by Enter, plays the player's own picks: a friend's
// dare taken before lets go of the lobby (its card stays on the menu).
const openOrStart: UpdateStep = $ => {
  if (skipsLobby($.model)) {
    return startOrAsk(runModeOf($.model.home.mode))($)
  } else if (isOnHomeMenu($.model)) {
    return openLobby($)
  } else {
    return $.model
  }
}

const playFromHome: UpdateStep = combine([modelStep(releaseDare), openOrStart])

export const playFromKey = (code: string): UpdateStep =>
  stepWhen(() => isStartKey(code), playFromHome)

// LEAVING

// NOTE: SHAKE ON IT: the run starts, so the card goes at once.
const startFromLobby: UpdateStep = whenActive(
  combine([
    lobbyStep(withLobbyStatus('Closed')),
    $ => startWithMode(runModeOf($.model.home.mode))($),
  ]),
)

const focusHomePlay: UpdateStep = $ =>
  $.run(FocusHomeButton.make({ button: 'Play' }))

// NOTE: CHICKEN OUT, Escape, or a tap outside the card: it folds back into
// PLAY, clucking on the way, lets go of a friend's dare, and puts focus
// back on PLAY.
const leaveLobby: UpdateStep = whenActive(
  combine([
    lobbyStep(withLobbyStatus('Folding')),
    $ => $.run(FoldLobby.make()),
    playSounds([uiCue('Cluck')]),
    modelStep(releaseDare),
    focusHomePlay,
  ]),
)

// PICKS

// NOTE: a friend's dare holds every pick to its link's
// (src/domain/beatMyRun.ts): the tiles show them, and take no taps or keys.
const isPickOpen = (model: Model): boolean =>
  isLobbyActive(model.lobby) && !isLockedByDare(lobbyPicksOf(model))

// NOTE: each pick taps, as a menu button does. A friend's dare holds them
// all (src/domain/beatMyRun.ts).
const pick = (change: (model: Model) => Model): UpdateStep =>
  stepWhen(
    (model: Model) => !isDareTaken(model),
    combine([modelStep(change), tapSound]),
  )

// NOTE: a pick puts focus on START, so Enter after a pick starts the run
// instead of pressing the tile again. `inPlace` keeps focus where it is,
// for a tile pressed several times in a row (a modifier, the break clock,
// the mark).
const picked = (
  change: (model: Model) => Model,
  isAllowed: (model: Model) => boolean = () => true,
): UpdateStep =>
  stepWhen(
    (model: Model) => isPickOpen(model) && isAllowed(model),
    combine([focusLobby('Start'), pick(change)]),
  )

const inPlace = (
  change: (model: Model) => Model,
  isAllowed: (model: Model) => boolean,
): UpdateStep =>
  stepWhen(
    (model: Model) => isPickOpen(model) && isAllowed(model),
    pick(change),
  )

const chooseMode = (mode: HomeMode): UpdateStep =>
  picked(model => (model.home.mode === mode ? model : switchMode(model)))

// NOTE: the mark is held to what the new difficulty has opened.
const chooseLobbyDifficulty = (difficulty: Difficulty): UpdateStep =>
  picked(
    model => fitDareMark(chooseDifficulty(model, difficulty)),
    model => !isLocked(lobbyPicksOf(model).difficulty, difficulty),
  )

// NOTE: a modifier turns on and off where it sits, so a player can turn
// several on in a row. Friendly Fire waits for a bot to hit, as the tile
// says.
const toggleModifier = (modifier: Modifier): UpdateStep =>
  inPlace(
    model =>
      UiStruct.evolve(model, {
        modifiers: modifiers => toggledModifier(modifiers, modifier),
      }),
    model => isModifierPickable(lobbyPicksOf(model), modifier),
  )

// NOTE: the dare ladder's mark steps to the next opened where it sits,
// round to none.
const stepDareMark: UpdateStep = inPlace(
  model => {
    const picks = lobbyPicksOf(model)
    const mark = nextMarkOf(picks.dareMark, picks.bestMark)
    return fitDareMark(UiStruct.evolve(model, { dareMark: () => mark }))
  },
  model => isMarkShown(lobbyPicksOf(model)),
)

// NOTE: Dare's break clock steps to its next choice where it sits.
const stepEasyBreak: UpdateStep = inPlace(
  model => {
    const seconds = nextEasyBreakOf(lobbyPicksOf(model).easyBreakSeconds)
    return UiStruct.evolve(model, { easyBreakSeconds: () => seconds })
  },
  model => isEasyBreakShown(lobbyPicksOf(model)),
)

// BOTS

// NOTE: + BOT seats a bot in the next empty seat, with a goofy name and a
// hero picked at random from the heroes this player has unlocked. With no
// seat free it changes nothing, but it is still a pick: its tap and
// START's focus.
const addLobbyBot: UpdateStep = picked(addBot)

// NOTE: the x on a bot sends it home, and a picker choosing for a bot
// chooses for nobody. The last bot leaving takes Friendly Fire with it: it
// has nobody to hit, and the tile goes dim.
const dropLobbyBot = (index: number): UpdateStep =>
  combine([
    whenActive(lobbyStep(withoutPickingBot)),
    picked(model => {
      const removed = removeBot(model, index)
      return Array.isReadonlyArrayEmpty(activeBots(removed))
        ? UiStruct.evolve(removed, {
            modifiers: modifiers =>
              UiStruct.evolve(modifiers, { friendlyFire: () => false }),
          })
        : removed
    }),
  ])

// THE HERO PICKER

// NOTE: the hero card opens the picker for the player, a bot's card for
// that bot, in the Dialog over the lobby: its tap, its heroes no longer
// NEW on the lobby's card, and no key or stick held under it.
const openHeroFor = (maybeBot: Option.Option<number>): UpdateStep =>
  whenActive(
    stepWhen(
      (model: Model) =>
        Option.match(maybeBot, {
          onNone: () => true,
          onSome: index => index < lobbyPicksOf(model).bots.length,
        }),
      combine([
        lobbyStep(openedHeroPicker(maybeBot)),
        unlockAudio,
        tapSound,
        modelStep(model => withInput(markCallingsSeen(model), releaseAll)),
      ]),
    ),
  )

// NOTE: the Dialog closed, by its Escape, its backdrop, the picker's close
// or Y: the next opening chooses for the player.
const closeHeroPicker: UpdateStep = stepWhen(
  (model: Model) => model.lobby.isHeroPickerOpen,
  lobbyStep(closedHeroPicker),
)

// NOTE: the picker's answers: a hero worn (the player's, or a bot's at its
// seat) closes it; one for sale is tried on, its BUY pill showing; a try-on
// ends.
const worn: UpdateStep = lobbyStep(closedHeroPicker)

const triedOn = (calling: Calling): UpdateStep =>
  lobbyStep(withTrying(Option.some(calling)))

const tryOnEnded: UpdateStep = lobbyStep(withTrying(Option.none()))

const denied = (answer: UpdateStep): UpdateStep =>
  combine([playSounds([uiCue('Denied')]), answer])

const standingOf = (model: Model, calling: Calling): CallingStanding =>
  callingStandingOf(
    calling,
    rankOf(totalPointsOf(model.rank)),
    model.boughtCosmetics,
  )

// NOTE: a hero card for the player's own pick. An owned hero is the pick.
// One for sale (its rank is reached) is tried on, and its BUY pill buys it.
// A locked one shakes.
const PLAYER_TAPS: {
  readonly [Standing in CallingStanding]: (calling: Calling) => UpdateStep
} = {
  Owned: calling =>
    combine([modelStep(model => chooseCalling(model, calling)), worn]),
  ForSale: calling => combine([playSounds([uiCue('Pop')]), triedOn(calling)]),
  Locked: () => denied(tryOnEnded),
}

// NOTE: a teammate bot only takes a hero the player owns.
const forBot = (model: Model, index: number, calling: Calling): UpdateStep =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? combine([
        modelStep(current => setBotCalling(current, index, calling)),
        worn,
      ])
    : denied(tryOnEnded)

// NOTE: a calling is picked in the lobby's picker, never in a run.
const pickHero = (calling: Calling): UpdateStep =>
  stepWhen(
    (model: Model) => isHeroPickerUp(model.lobby) && isOnHome(model.phase),
    $ =>
      Option.match($.model.lobby.maybePickingBot, {
        onNone: () => PLAYER_TAPS[standingOf($.model, calling)](calling),
        onSome: index => forBot($.model, index, calling),
      })($),
  )

// NOTE: the BUY pill: spends the Bones on the hero being tried on and makes
// it the pick, and the picker closes. Short of Bones it shakes and stays.
// Nothing but the try-on's end for a hero no longer for sale. BUY is for
// the player's own hero: a bot only takes a hero the player owns, so a
// try-on for a bot only ends.
const buyHero =
  (calling: Calling): UpdateStep =>
  $ => {
    const model = $.model
    if (!isHeroPickerUp(model.lobby)) {
      return model
    } else if (Option.isSome(model.lobby.maybePickingBot)) {
      return tryOnEnded($)
    } else if (!isOnHome(model.phase)) {
      return model
    } else if (standingOf(model, calling) !== 'ForSale') {
      return tryOnEnded($)
    } else if (canAffordCalling(model.rank, calling)) {
      return $.combine(
        modelStep(current => buyCalling(current, calling)),
        playSounds([uiCue('Purchase')]),
        worn,
      )
    } else {
      return denied(unchanged)($)
    }
  }

// KEYS

// NOTE: every key goes to the open lobby, a controller's menu presses too
// (src/app/update/padMenu.ts). Y opens the hero picker, as the hero card's
// tap does; Enter starts, Escape goes back, and E, X, and B pick as their
// tiles do. The arrows walk the controls. A key on a focused button is
// that button's own (src/app/subscriptions.ts), so Enter there presses it.
const KEY_STEPS: ReadonlyArray<readonly [string, UpdateStep]> = [
  [LOBBY_KEYS.Start.code, startFromLobby],
  [LOBBY_KEYS.Back.code, leaveLobby],
  [
    LOBBY_KEYS.Mode.code,
    $ =>
      chooseMode($.model.home.mode === 'Campaign' ? 'Endless' : 'Campaign')($),
  ],
  [
    LOBBY_KEYS.Difficulty.code,
    $ =>
      chooseLobbyDifficulty(nextDifficultyOf(lobbyPicksOf($.model).difficulty))(
        $,
      ),
  ],
  [LOBBY_KEYS.Bot.code, addLobbyBot],
]

const arrowStep =
  (code: string): UpdateStep =>
  $ =>
    Option.match(maybeFocusStep(code), {
      onNone: () => $.model,
      onSome: step =>
        focusLobby(
          steppedLobbyFocus(
            $.model.lobby.maybeFocus,
            step,
            lobbyPicksOf($.model),
          ),
        )($),
    })

export const lobbyFromKey = (code: string): UpdateStep =>
  code === LOBBY_KEYS.Hero.code
    ? openHeroFor(Option.none())
    : whenActive(
        Option.match(
          Array.findFirst(KEY_STEPS, ([key]) => key === code),
          {
            onNone: () => arrowStep(code),
            onSome: ([, step]) => step,
          },
        ),
      )

// HANDLERS

// NOTE: PLAY from home opens the lobby (or starts a new player's run), and
// each of the Lobby component's events (src/app/lobbyView.ts) is judged
// and made here.
export const lobbyHandlers = defineHandlers({
  ClickedPlayButton: playFromHome,
  RequestedLeaveLobby: leaveLobby,
  RequestedStartFromLobby: startFromLobby,
  RequestedLobbyHeroPicker: openHeroFor(Option.none()),
  RequestedLobbyBotHeroPicker: ($, { index }) =>
    openHeroFor(Option.some(index))($),
  RequestedAddLobbyBot: addLobbyBot,
  RequestedDropLobbyBot: ($, { index }) => dropLobbyBot(index)($),
  PickedLobbyMode: ($, { mode }) => chooseMode(mode)($),
  PickedLobbyDifficulty: ($, { difficulty }) =>
    chooseLobbyDifficulty(difficulty)($),
  ToggledLobbyModifier: ($, { modifier }) => toggleModifier(modifier)($),
  SteppedLobbyEasyBreak: stepEasyBreak,
  SteppedLobbyDareMark: stepDareMark,
  FocusedLobbyControl: ($, { control }) =>
    lobbyStep(withLobbyFocus(Option.some(control)))($),
  BlurredLobbyControl: lobbyStep(withLobbyFocus(Option.none())),
  PickedLobbyHero: ($, { calling }) => pickHero(calling)($),
  RequestedBuyLobbyHero: ($, { calling }) => buyHero(calling)($),
  RequestedCloseLobbyHeroPicker: closeHeroPicker,
  CompletedLobbyFold: lobbyStep(finishedFold),
})
