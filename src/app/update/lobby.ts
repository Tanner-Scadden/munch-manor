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

export const FocusLobbyControl = Command.make(
  'FocusLobbyControl',
  { args: { control: LobbyControl }, mode: 'switch' },
  ({ control }) =>
    Effect.as(focusById(lobbyControlId(control)), Component.noop),
)

const FOLD_MS = 280

export const FoldLobby = Command.make(
  'FoldLobby',
  { args: {}, mode: 'switch' },
  () =>
    Effect.sleep(Duration.millis(FOLD_MS)).pipe(
      Effect.as(LobbyMessage.CompletedLobbyFold()),
    ),
)

const lobbyStep = (change: (lobby: LobbyState) => LobbyState): UpdateStep =>
  modelStep(model => UiStruct.evolve(model, { lobby: change }))

const focusLobby =
  (control: LobbyControl): UpdateStep =>
  $ =>
    $.evolve({ lobby: withLobbyFocus(Option.some(control)) }).run(
      FocusLobbyControl.make({ control }),
    )

const whenActive = (step: UpdateStep): UpdateStep =>
  stepWhen((model: Model) => isLobbyActive(model.lobby), step)

const isInPracticeGate = (model: Model): boolean =>
  !isLearned(model.lessons.move) || !isLearned(model.lessons.fire)

const skipsLobby = (model: Model): boolean =>
  isAskingDifficultyFirst(model) || isInPracticeGate(model)

export const openLobby: UpdateStep = combine([
  unlockAudio,
  tapSound,
  releaseInput,
  lobbyStep(openedLobby),
  focusLobby('Start'),
])

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

const startFromLobby: UpdateStep = whenActive(
  combine([
    lobbyStep(withLobbyStatus('Closed')),
    $ => startWithMode(runModeOf($.model.home.mode))($),
  ]),
)

const focusHomePlay: UpdateStep = $ =>
  $.run(FocusHomeButton.make({ button: 'Play' }))

const leaveLobby: UpdateStep = whenActive(
  combine([
    lobbyStep(withLobbyStatus('Folding')),
    $ => $.run(FoldLobby.make()),
    playSounds([uiCue('Cluck')]),
    modelStep(releaseDare),
    focusHomePlay,
  ]),
)

const isPickOpen = (model: Model): boolean =>
  isLobbyActive(model.lobby) && !isLockedByDare(lobbyPicksOf(model))

const pick = (change: (model: Model) => Model): UpdateStep =>
  stepWhen(
    (model: Model) => !isDareTaken(model),
    combine([modelStep(change), tapSound]),
  )

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

const chooseLobbyDifficulty = (difficulty: Difficulty): UpdateStep =>
  picked(
    model => fitDareMark(chooseDifficulty(model, difficulty)),
    model => !isLocked(lobbyPicksOf(model).difficulty, difficulty),
  )

const toggleModifier = (modifier: Modifier): UpdateStep =>
  inPlace(
    model =>
      UiStruct.evolve(model, {
        modifiers: modifiers => toggledModifier(modifiers, modifier),
      }),
    model => isModifierPickable(lobbyPicksOf(model), modifier),
  )

const stepDareMark: UpdateStep = inPlace(
  model => {
    const picks = lobbyPicksOf(model)
    const mark = nextMarkOf(picks.dareMark, picks.bestMark)
    return fitDareMark(UiStruct.evolve(model, { dareMark: () => mark }))
  },
  model => isMarkShown(lobbyPicksOf(model)),
)

const stepEasyBreak: UpdateStep = inPlace(
  model => {
    const seconds = nextEasyBreakOf(lobbyPicksOf(model).easyBreakSeconds)
    return UiStruct.evolve(model, { easyBreakSeconds: () => seconds })
  },
  model => isEasyBreakShown(lobbyPicksOf(model)),
)

const addLobbyBot: UpdateStep = picked(addBot)

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

const closeHeroPicker: UpdateStep = stepWhen(
  (model: Model) => model.lobby.isHeroPickerOpen,
  lobbyStep(closedHeroPicker),
)

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

const PLAYER_TAPS: {
  readonly [Standing in CallingStanding]: (calling: Calling) => UpdateStep
} = {
  Owned: calling =>
    combine([modelStep(model => chooseCalling(model, calling)), worn]),
  ForSale: calling => combine([playSounds([uiCue('Pop')]), triedOn(calling)]),
  Locked: () => denied(tryOnEnded),
}

const forBot = (model: Model, index: number, calling: Calling): UpdateStep =>
  isCallingOwned(calling, model.boughtCosmetics)
    ? combine([
        modelStep(current => setBotCalling(current, index, calling)),
        worn,
      ])
    : denied(tryOnEnded)

const pickHero = (calling: Calling): UpdateStep =>
  stepWhen(
    (model: Model) => isHeroPickerUp(model.lobby) && isOnHome(model.phase),
    $ =>
      Option.match($.model.lobby.maybePickingBot, {
        onNone: () => PLAYER_TAPS[standingOf($.model, calling)](calling),
        onSome: index => forBot($.model, index, calling),
      })($),
  )

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
