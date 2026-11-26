import { Array, Duration, Effect, Function, Option, Schema, pipe } from 'effect'

import { Command, Component, UiStruct } from '@effect/ui'

import { markJournalSeen } from '../../domain/journal'
import { runDifficultyOf } from '../../domain/onlineRun'
import { isEndScreen, isOnHome } from '../../domain/run'
import { END_MENU_BUTTON_ID, endOffer } from '../../features/end/endOffer'
import {
  HandCard,
  HomeButton,
  type MenuPanel,
} from '../../features/home/homeSchema'
import type { HelpCard } from '../../features/menus/message'
import { MunchopediaPage } from '../../features/munchopedia/model'
import { skipTutorial } from '../../features/onboarding/onboarding'
import { markProofSeen } from '../../features/proof/proof'
import { NEWS_DAYS } from '../../features/whatsNew/changelog'
import { PAD_A, PAD_B, PAD_START } from '../../input/gamepad'
import {
  isMenuKey,
  isStartKey,
  maybeFocusStep,
  releaseAll,
} from '../../input/input'
import type { InstallOutcome } from '../../platform/deviceSchema'
import { InstallPrompt } from '../../platform/install'
import { InstallMessage, VersionMessage } from '../../platform/message'
import { forgetTutorial } from '../../platform/save'
import { activateNewBuild } from '../../platform/serviceWorker'
import { reloadOnto } from '../../platform/version'
import {
  HAND_CARDS,
  type KeyedHandCard,
  handCardId,
  homeButtonId,
  homeButtonsOf,
  isInstallTileShown,
  isManorKey,
  isMissionCardShown,
  isMissionsKey,
  isSettingsKey,
  isSupportKey,
  isSupportShown,
  isUpdateGiftShown,
  maybeHandCardOfKey,
  seeNews,
  seeTurnHint,
  steppedHomeFocus,
  turnNewsPage,
} from '../../screens/home/home'
import type { TutorialChoice } from '../../shared/nameKeys'
import type { Difficulty } from '../../shared/playerData'
import { stepWhen } from '../../shared/stepWhen'
import { clickById, focusById } from '../../ui/menuParts'
import {
  chooseDifficulty,
  isLocked,
  isNightmareUnlockedBy,
  settleNightmare,
  unlockNightmare,
} from '../../world/run/difficulty'
import { noModifiers } from '../../world/run/modifiers'
import { RunMode } from '../../world/schema/worldSchema'
import {
  MenuState,
  isAnyPanelOpen,
  isHandOpen,
  isOnHomeMenu,
  isPanelOpen,
  isPastRestartGrace,
  menuState,
} from '../menuState'
import { DifficultyCard, type Model } from '../model'
import { returnHome } from '../runReset'
import { closeRootDialog, openRootDialog } from './dialog'
import { openProfile } from './profile'
import { isPaused, startFromButton, startWhenAllowed, startsRun } from './run'
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

export class ShowInstallPrompt extends Command.Service<ShowInstallPrompt>()(
  'app/ShowInstallPrompt',
  { args: {}, success: InstallMessage },
) {
  static readonly layer = this.toLayer(
    Effect.gen(function* () {
      const installPrompt = yield* InstallPrompt
      return () =>
        Effect.map(installPrompt.prompt, outcome =>
          InstallMessage.CompletedShowInstallPrompt({ outcome }),
        )
    }),
  )
}

export const FocusHomeButton = Command.make(
  'FocusHomeButton',
  { args: { button: HomeButton } },
  ({ button }) => Effect.as(focusById(homeButtonId(button)), Component.noop),
)

export const ClickSupportLink = Command.make(
  'ClickSupportLink',
  { args: {} },
  () => Effect.as(clickById(homeButtonId('Support')), Component.noop),
)

const clickSupportLink: UpdateStep = $ =>
  isSupportShown($.model) ? $.run(ClickSupportLink.make()) : $.model

export const FocusHandCard = Command.make(
  'FocusHandCard',
  { args: { card: HandCard } },
  ({ card }) => Effect.as(focusById(handCardId(card)), Component.noop),
)

export const FocusEndMenuButton = Command.make(
  'FocusEndMenuButton',
  { args: {} },
  () => Effect.as(focusById(END_MENU_BUTTON_ID), Component.noop),
)

const UNWRAP_DURATION = Duration.millis(650)

export const WaitForUnwrap = Command.make('WaitForUnwrap', { args: {} }, () =>
  Effect.as(
    Effect.sleep(UNWRAP_DURATION),
    VersionMessage.CompletedWaitForUnwrap(),
  ),
)

export const ReloadPage = Command.make(
  'ReloadPage',
  { args: { build: Schema.String } },
  ({ build }) =>
    pipe(
      Effect.ignore(activateNewBuild),
      Effect.andThen(reloadOnto(build)),
      Effect.match({
        onSuccess: () => Component.noop,
        onFailure: error =>
          VersionMessage.FailedReloadPage({ reason: error.reason }),
      }),
    ),
)

const isPanelAllowed = (model: Model, panel: MenuPanel): boolean =>
  panel === 'LeaveRun'
    ? MenuState.isAnyOf(['Paused'])(menuState(model))
    : MenuState.isAnyOf(['Home'])(menuState(model))

const showPanel = (panel: MenuPanel): UpdateStep =>
  modelStep(model =>
    withInput(
      UiStruct.evolve(model, {
        panel: () => panel,
        maybeOpenHelpCard: () => Option.none(),
      }),
      releaseAll,
    ),
  )

const showHelpLine: {
  (card: HelpCard): (model: Model) => Model
  (model: Model, card: HelpCard): Model
} = Function.dual(2, (model: Model, card: HelpCard): Model =>
  UiStruct.evolve(model, { maybeOpenHelpCard: () => Option.some(card) }),
)

const openPanel = (panel: MenuPanel): UpdateStep =>
  stepWhen(
    (model: Model) => isPanelAllowed(model, panel),
    combine([showPanel(panel), openRootDialog('Panel')]),
  )

export const openMissions: UpdateStep = stepWhen(
  isMissionCardShown,
  openPanel('Missions'),
)

const closePanel: UpdateStep = stepWhen(
  isAnyPanelOpen,
  closeRootDialog('Panel'),
)

export const goHome = modelStep(model =>
  returnHome(withInput(model, releaseAll)),
)

const leaveFromMenu: UpdateStep = $ => {
  if (isPaused($.model.phase)) {
    return openPanel('LeaveRun')($)
  } else if (isEndScreen($.model.phase) && isPastRestartGrace($.model)) {
    return goHome($)
  } else {
    return $.model
  }
}

const leaveRun: UpdateStep = stepWhen(
  (model: Model) => isPaused(model.phase) && isPanelOpen(model, 'LeaveRun'),
  combine([closePanel, goHome]),
)

export const leaveRunFromPad =
  (code: string): UpdateStep =>
  $ => {
    if (!isPaused($.model.phase) || !isPanelOpen($.model, 'LeaveRun')) {
      return $.model
    } else if (code === PAD_A) {
      return leaveRun($)
    } else if (code === PAD_B || code === PAD_START) {
      return closePanel($)
    } else {
      return $.model
    }
  }

const isEndMenuKey = (model: Model, code: string): boolean =>
  isMenuKey(code) || (isStartKey(code) && endOffer(model) === 'MenuOnly')

export const menuFromKey = (code: string): UpdateStep =>
  stepWhen((model: Model) => isEndMenuKey(model, code), leaveFromMenu)

const openSettingsFromGear: UpdateStep = stepWhen(
  isOnHomeMenu,
  openProfile('Settings'),
)

const openHand: UpdateStep = stepWhen(
  isOnHomeMenu,
  combine([releaseInput, openRootDialog('Hand')]),
)

const closeHand: UpdateStep = stepWhen(isHandOpen, closeRootDialog('Hand'))

const stepHandFocus =
  (card: HandCard): UpdateStep =>
  $ =>
    isHandOpen($.model) && Array.contains(HAND_CARDS, card)
      ? $.run(FocusHandCard.make({ card }))
      : $.model

export const homeFocusFromKey =
  (code: string): UpdateStep =>
  $ =>
    Option.match(maybeFocusStep(code), {
      onNone: () => $.model,
      onSome: step => {
        if (!isOnHomeMenu($.model)) {
          return $.model
        }

        const button = steppedHomeFocus(
          homeButtonsOf($.model),
          $.model.maybeHomeFocus,
          step,
        )
        return $.evolve({
          maybeHomeFocus: () => Option.some(button),
        }).run(FocusHomeButton.make({ button }))
      },
    })

const openWhatsNew: UpdateStep = stepWhen(
  (model: Model) => isPanelAllowed(model, 'WhatsNew'),
  combine([modelStep(seeNews), openPanel('WhatsNew')]),
)

const openMunchopedia = (page: MunchopediaPage): UpdateStep =>
  stepWhen(
    (model: Model) => isPanelAllowed(model, 'Munchopedia'),
    combine([
      modelStep(markJournalSeen),
      modelStep(model =>
        UiStruct.evolve(model, { munchopediaPage: () => page }),
      ),
      openPanel('Munchopedia'),
    ]),
  )

const openProof: UpdateStep = stepWhen(
  (model: Model) => isPanelAllowed(model, 'Proof'),
  combine([modelStep(markProofSeen), openPanel('Proof')]),
)

const turnNews = (step: number): UpdateStep =>
  modelStep(model =>
    isPanelOpen(model, 'WhatsNew')
      ? turnNewsPage(model, step, NEWS_DAYS.length)
      : model,
  )

const openCard = (card: KeyedHandCard): UpdateStep => {
  switch (card) {
    case 'WhatsNew':
      return openWhatsNew
    case 'Munchopedia':
      return openMunchopedia(MunchopediaPage.List())
    case 'Character':
      return openProfile('Look')
    case 'HowToPlay':
      return openPanel('HowToPlay')
    case 'Proof':
      return openProof
  }
}

export const homeFromKey =
  (code: string): UpdateStep =>
  $ => {
    if (!isOnHomeMenu($.model)) {
      return $.model
    } else if (isManorKey(code)) {
      return openHand($)
    } else if (isSupportKey(code)) {
      return clickSupportLink($)
    } else if (isSettingsKey(code)) {
      return openProfile('Settings')($)
    } else if (isMissionsKey(code)) {
      return openMissions($)
    } else {
      return Option.match(maybeHandCardOfKey(code), {
        onNone: () => $.model,
        onSome: card => (card === 'Character' ? unchanged : openCard(card))($),
      })
    }
  }

export const isAskingDifficultyFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Unseen'])(model.difficultyCard) &&
  isOnHome(model.phase)

const markAsking = (mode: RunMode): UpdateStep =>
  modelStep(model =>
    UiStruct.evolve(model, {
      difficultyCard: () =>
        DifficultyCard.Asking({ mode, tutorial: 'Tutorial' }),
    }),
  )

const askDifficulty = (mode: RunMode): UpdateStep =>
  stepWhen(
    (model: Model) => isPanelAllowed(model, 'Difficulty'),
    combine([markAsking(mode), openPanel('Difficulty')]),
  )

export const startWithMode =
  (mode: RunMode): UpdateStep =>
  $ =>
    startFromButton(startWhenAllowed($.model, mode))($)

export const startOrAsk =
  (mode: RunMode): UpdateStep =>
  $ =>
    isAskingDifficultyFirst($.model)
      ? $.combine(unlockAudio, askDifficulty(mode))
      : startWithMode(mode)($)

const TUTORIAL_PICKS: Readonly<
  Record<TutorialChoice, (model: Model) => Model>
> = {
  Tutorial: Function.identity,
  Skip: skipTutorial,
}

const chooseFromCard = (
  difficulty: Difficulty,
  tutorial: TutorialChoice,
): UpdateStep =>
  modelStep(model =>
    UiStruct.evolve(
      TUTORIAL_PICKS[tutorial](chooseDifficulty(model, difficulty)),
      {
        difficultyCard: () => DifficultyCard.Seen(),
      },
    ),
  )

const pickTutorialChoice =
  (choice: TutorialChoice): UpdateStep =>
  $ =>
    DifficultyCard.match($.model.difficultyCard, {
      Unseen: () => $.model,
      Seen: () => $.model,
      Asking: ({ mode, tutorial }) =>
        (tutorial === choice
          ? unchanged
          : combine([
              modelStep(model =>
                UiStruct.evolve(model, {
                  difficultyCard: () =>
                    DifficultyCard.Asking({ mode, tutorial: choice }),
                }),
              ),
              playSounds([uiCue('Pop')]),
            ]))($),
    })

const pickFromCard =
  (difficulty: Difficulty): UpdateStep =>
  $ =>
    DifficultyCard.match($.model.difficultyCard, {
      Unseen: () => $.model,
      Seen: () => $.model,
      Asking: ({ mode, tutorial }) =>
        (isLocked($.model.difficulty, difficulty)
          ? unchanged
          : combine([
              chooseFromCard(difficulty, tutorial),
              closePanel,
              startWithMode(mode),
            ]))($),
    })

const asNewPlayer = (model: Model): Model =>
  UiStruct.evolve(forgetTutorial(model), {
    home: home => UiStruct.evolve(home, { bots: () => [] }),
    modifiers: () => noModifiers,
  })

const replayTutorial: UpdateStep = stepWhen(
  (model: Model) => isOnHome(model.phase) && isPanelOpen(model, 'HowToPlay'),
  combine([
    modelStep(asNewPlayer),
    closePanel,
    startWithMode(RunMode.Campaign()),
  ]),
)

export const settleNightmareFrom = (before: Model): UpdateStep =>
  modelStep(model =>
    startsRun(before, model) ? settleNightmare(model) : model,
  )

export const unlockNightmareFrom = (before: Model): UpdateStep =>
  stepWhen(
    (model: Model) =>
      isNightmareUnlockedBy(before, model, runDifficultyOf(model)),
    combine([modelStep(unlockNightmare), playSounds([uiCue('PowerUp')])]),
  )

const dismissHomeScreenTip = (model: Model): Model =>
  model.homeScreenTip === 'Dismissed'
    ? model
    : UiStruct.evolve(model, { homeScreenTip: () => 'Dismissed' })

const openHomeScreenSteps: UpdateStep = stepWhen(
  isOnHomeMenu,
  combine([releaseInput, openRootDialog('HomeScreenSteps')]),
)

const promptInstall: UpdateStep = $ =>
  $.set(dismissHomeScreenTip($.model)).run(ShowInstallPrompt.make())

const pressInstall: UpdateStep = $ => {
  if (!isInstallTileShown($.model)) {
    return $.model
  } else if ($.model.release.installOffer === 'Ready') {
    return promptInstall($)
  } else {
    return $.combine(modelStep(dismissHomeScreenTip), openHomeScreenSteps)
  }
}

const settleInstallPrompt: {
  (outcome: InstallOutcome): (model: Model) => Model
  (model: Model, outcome: InstallOutcome): Model
} = Function.dual(2, (model: Model, outcome: InstallOutcome): Model =>
  UiStruct.evolve(model, {
    release: UiStruct.evolve({
      installOffer: () => (outcome === 'Accepted' ? 'Installed' : 'None'),
    }),
  }),
)

export const unwrapUpdateGift: UpdateStep = stepWhen(
  (model: Model) =>
    isUpdateGiftShown(model) && model.release.updateGift === 'Wrapped',
  combine([
    $ =>
      $.evolve({
        release: UiStruct.evolve({ updateGift: () => 'Unwrapping' }),
      }).run(WaitForUnwrap.make()),
    playSounds([uiCue('LootPop')]),
  ]),
)

export const rewrapUpdateGift = (model: Model): Model =>
  UiStruct.evolve(model, {
    release: UiStruct.evolve({ updateGift: () => 'Wrapped' }),
  })

export const reloadOntoNewerBuild: UpdateStep = $ =>
  Option.match($.model.release.maybeNewerBuild, {
    onNone: () => rewrapUpdateGift($.model),
    onSome: build => $.run(ReloadPage.make({ build })),
  })

export const greetUpdate = (isDue: boolean): UpdateStep =>
  stepWhen(
    (model: Model) =>
      isDue &&
      isOnHome(model.phase) &&
      MenuState.isAnyOf(['Home', 'Coop'])(menuState(model)),
    openRootDialog('UpdateGreeting'),
  )

export const newsFromGreeting: UpdateStep = combine([
  closeRootDialog('UpdateGreeting'),
  openWhatsNew,
])

const isOfferingOnlyMenu = (model: Model): boolean =>
  endOffer(model) === 'MenuOnly'

export const focusEndMenuFrom =
  (before: Model): UpdateStep =>
  $ =>
    !isOfferingOnlyMenu(before) && isOfferingOnlyMenu($.model)
      ? $.run(FocusEndMenuButton.make())
      : $.model

export const homeHandlers = defineHandlers({
  ClickedCampaignButton: startOrAsk(RunMode.Campaign()),

  ClickedEndlessButton: startOrAsk(RunMode.Endless()),

  ClickedCharacterButton: combine([
    unlockAudio,
    closeHand,
    openProfile('Look'),
  ]),

  ClickedHowToPlayButton: combine([
    unlockAudio,
    closeHand,
    openPanel('HowToPlay'),
  ]),

  ClickedSettingsButton: combine([unlockAudio, tapSound, openSettingsFromGear]),

  ClickedSupportButton: combine([unlockAudio, tapSound]),

  ClickedMenuButton: combine([unlockAudio, leaveFromMenu]),

  ClickedLeaveRunButton: leaveRun,

  ClickedStayButton: closePanel,

  ClickedPlayTutorialButton: replayTutorial,

  ClickedDifficultyCardButton: ($, { difficulty }) =>
    pickFromCard(difficulty)($),

  ClickedTutorialChoiceButton: ($, { choice }) => pickTutorialChoice(choice)($),

  FocusedHomeButton: ($, { button }) =>
    $.evolve({ maybeHomeFocus: () => Option.some(button) }),

  BlurredHomeButton: $ => $.evolve({ maybeHomeFocus: () => Option.none() }),

  ClickedWhatsNewButton: combine([unlockAudio, closeHand, openWhatsNew]),

  ClickedMunchopediaButton: combine([
    unlockAudio,
    closeHand,
    openMunchopedia(MunchopediaPage.List()),
  ]),

  ClickedProofButton: combine([unlockAudio, closeHand, openProof]),

  ClickedNewEntryButton: ($, { kind }) =>
    $.combine(unlockAudio, openMunchopedia(MunchopediaPage.Entry({ kind }))),

  ClickedManorButton: combine([unlockAudio, tapSound, openHand]),

  ClickedTurnHint: modelStep(seeTurnHint),

  SteppedHandFocus: ($, { card }) => stepHandFocus(card)($),

  FocusedHelpCard: ($, { card }) => showHelpLine($.model, card),

  ClickedHelpCard: ($, { card }) =>
    $.combine(modelStep(showHelpLine(card)), unlockAudio),

  ClickedOlderNewsButton: turnNews(1),

  ClickedNewerNewsButton: turnNews(-1),

  ClickedInstallButton: combine([unlockAudio, tapSound, pressInstall]),

  ChangedInstallOffer: ($, { installOffer }) =>
    $.evolve({
      release: UiStruct.evolve({ installOffer: () => installOffer }),
    }),

  CompletedShowInstallPrompt: ($, { outcome }) =>
    settleInstallPrompt($.model, outcome),
})
