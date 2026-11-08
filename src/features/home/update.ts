import { Array, Duration, Effect, Function, Option, Schema, pipe } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  HandDialogBinding,
  HomeScreenStepsBinding,
  MunchopediaBinding,
  PanelDialogBinding,
  UpdateGreetingBinding,
} from '../../app/bindings'
import { ApplicationBlock, makeStep } from '../../app/definition'
import {
  MenuState,
  isAnyPanelOpen,
  isHandOpen,
  isOnHomeMenu,
  isPanelOpen,
  isPastRestartGrace,
  menuState,
} from '../../app/menuState'
import { DifficultyCard, type Model } from '../../app/model'
import { stepWhen } from '../../app/stepWhen'
import { openProfile } from '../../app/update/profile'
import {
  isPaused,
  startFromButton,
  startWhenAllowed,
  startsRun,
} from '../../app/update/run'
import {
  playSounds,
  tapSound,
  uiCue,
  unlockAudio,
} from '../../app/update/sound'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  defineHandlers,
  modelStep,
  releaseInput,
  unchanged,
  withInput,
} from '../../app/update/step'
import {
  isMenuKey,
  isStartKey,
  maybeFocusStep,
  releaseAll,
} from '../../input/input'
import type { InstallOutcome } from '../../platform/deviceSchema'
import { InstallPrompt } from '../../platform/install'
import { InstallMessage, VersionMessage } from '../../platform/message'
import { activateNewBuild } from '../../platform/serviceWorker'
import { reloadOnto } from '../../platform/version'
import type { TutorialChoice } from '../../shared/nameKeys'
import type { Difficulty } from '../../shared/playerData'
import {
  chooseDifficulty,
  isLocked,
  isNightmareUnlockedBy,
  settleNightmare,
  unlockNightmare,
} from '../../world/run/difficulty'
import { RunMode } from '../../world/schema/worldSchema'
import type { HelpCard } from '../menus/message'
import { MunchopediaPage } from '../munchopedia/model'
import { skipTutorial } from '../onboarding/onboarding'
import { runDifficultyOf } from '../onlineRun/onlineRun'
import { NEWS_DAYS } from '../whatsNew/changelog'
import {
  END_MENU_BUTTON_ID,
  HAND_CARDS,
  type KeyedHandCard,
  endOffer,
  handCardId,
  homeButtonId,
  homeButtonsOf,
  isEndScreen,
  isInstallTileShown,
  isManorKey,
  isOnHome,
  isSettingsKey,
  isSupportKey,
  isSupportShown,
  isUpdateGiftShown,
  maybeHandCardOfKey,
  returnHome,
  seeNews,
  seeTurnHint,
  steppedHomeFocus,
  turnNewsPage,
} from './home'
import { HandCard, HomeButton, type MenuPanel } from './homeSchema'
import { HomeMessage } from './message'

// COMMAND

export const ShowInstallPrompt = ApplicationBlock.makeCommand(
  'ShowInstallPrompt',
  {
    messages: [InstallMessage.CompletedShowInstallPrompt],
    handler: function* () {
      return () =>
        InstallPrompt.use(installPrompt =>
          Effect.map(installPrompt.prompt, outcome =>
            InstallMessage.CompletedShowInstallPrompt({ outcome }),
          ),
        )
    },
  },
)

export const FocusHomeButton = ApplicationBlock.makeCommand('FocusHomeButton', {
  args: { button: HomeButton },
  messages: [HomeMessage.CompletedFocusHomeButton],
  handler: function* () {
    return ({ button }) =>
      Dom.focus(`#${homeButtonId(button)}`).pipe(
        Effect.ignore,
        Effect.as(HomeMessage.CompletedFocusHomeButton()),
      )
  },
})

// NOTE: B buys Rattles a coffee from the keyboard. The coffee is a real
// link, so the key clicks it, as SHARE's key does: the browser opens the
// link from a click, which no popup blocker stops, and the click sends
// ClickedSupportButton like a tap.
export const ClickSupportLink = ApplicationBlock.makeCommand(
  'ClickSupportLink',
  {
    messages: [HomeMessage.CompletedClickSupportLink],
    handler: function* () {
      return () =>
        Dom.clickElement(`#${homeButtonId('Support')}`).pipe(
          Effect.ignore,
          Effect.as(HomeMessage.CompletedClickSupportLink()),
        )
    },
  },
)

const clickSupportLink: UpdateStep = model =>
  isSupportShown(model) ? { model, commands: [ClickSupportLink()] } : { model }

export const FocusHandCard = ApplicationBlock.makeCommand('FocusHandCard', {
  args: { card: HandCard },
  messages: [HomeMessage.CompletedFocusHandCard],
  handler: function* () {
    return ({ card }) =>
      Dom.focus(`#${handCardId(card)}`).pipe(
        Effect.ignore,
        Effect.as(HomeMessage.CompletedFocusHandCard()),
      )
  },
})

export const FocusEndMenuButton = ApplicationBlock.makeCommand(
  'FocusEndMenuButton',
  {
    messages: [HomeMessage.CompletedFocusEndMenuButton],
    handler: function* () {
      return () =>
        Dom.focus(`#${END_MENU_BUTTON_ID}`).pipe(
          Effect.ignore,
          Effect.as(HomeMessage.CompletedFocusEndMenuButton()),
        )
    },
  },
)

// NOTE: long enough for the gift's unwrap animation (src/features/home/menu.css) to
// play out before the page goes.
const UNWRAP_DURATION = Duration.millis(650)

export const WaitForUnwrap = ApplicationBlock.makeCommand('WaitForUnwrap', {
  messages: [VersionMessage.CompletedWaitForUnwrap],
  handler: function* () {
    return () =>
      Effect.as(
        Effect.sleep(UNWRAP_DURATION),
        VersionMessage.CompletedWaitForUnwrap(),
      )
  },
})

// NOTE: the new build's service worker takes over first, when there is one,
// so the reload and any later offline start run the new build. A worker that
// fails or is slow never stops the reload.
export const ReloadPage = ApplicationBlock.makeCommand('ReloadPage', {
  args: { build: Schema.String },
  messages: [
    VersionMessage.CompletedReloadPage,
    VersionMessage.FailedReloadPage,
  ],
  handler: function* () {
    return ({ build }) =>
      pipe(
        Effect.ignore(activateNewBuild),
        Effect.andThen(reloadOnto(build)),
        Effect.as(VersionMessage.CompletedReloadPage()),
        Effect.catch(error =>
          Effect.succeed(
            VersionMessage.FailedReloadPage({ reason: error.reason }),
          ),
        ),
      )
  },
})

// MENU

// NOTE: the panel's Closed fold (src/app/composition.ts): a Difficulty panel
// that asked before a run, closed without a pick, asks again next time.
export const forgetAskedMode: UpdateStep = stepModel => ({
  model: DifficultyCard.isAnyOf(['Asking'])(stepModel.difficultyCard)
    ? modifyFields(stepModel, {
        difficultyCard: () => DifficultyCard.Unseen(),
      })
    : stepModel,
})

// NOTE: Leave Run opens over the pause menu, every other panel over the
// bare home menu.
const isPanelAllowed = (model: Model, panel: MenuPanel): boolean =>
  panel === 'LeaveRun'
    ? MenuState.isAnyOf(['Paused'])(menuState(model))
    : MenuState.isAnyOf(['Home'])(menuState(model))

const showPanel =
  (panel: MenuPanel): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(stepModel, {
        panel: () => panel,
        maybeOpenHelpCard: () => Option.none(),
      }),
      releaseAll,
    ),
  })

// NOTE: a How to play card shows its line once focused (a keyboard) or
// tapped (touch), and keeps it until another card takes its place.
const showHelpLine: {
  (card: HelpCard): (model: Model) => Model
  (model: Model, card: HelpCard): Model
} = Function.dual(2, (model: Model, card: HelpCard): Model =>
  modifyFields(model, { maybeOpenHelpCard: () => Option.some(card) }),
)

const openPanel = (panel: MenuPanel) =>
  makeStep(model =>
    isPanelAllowed(model, panel)
      ? Update.combineSteps([
          showPanel(panel),
          PanelDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

const closePanel = makeStep(model =>
  isAnyPanelOpen(model) ? PanelDialogBinding.requestClose() : unchanged,
)

export const goHome = modelStep(model =>
  returnHome(withInput(model, releaseAll)),
)

const leaveFromMenu = makeStep(model => {
  if (isPaused(model.phase)) {
    return openPanel('LeaveRun')
  } else if (isEndScreen(model.phase) && isPastRestartGrace(model)) {
    return goHome
  } else {
    return unchanged
  }
})

// NOTE: only from the open Leave Run panel: a LEAVE tapped as the panel
// fades out after Back stays in the run.
const leaveRun = makeStep(model =>
  isPaused(model.phase) && isPanelOpen(model, 'LeaveRun')
    ? Update.combineSteps([closePanel, goHome])
    : unchanged,
)

const isEndMenuKey = (model: Model, code: string): boolean =>
  isMenuKey(code) || (isStartKey(code) && endOffer(model) === 'MenuOnly')

export const menuFromKey = (code: string) =>
  makeStep(model => (isEndMenuKey(model, code) ? leaveFromMenu : unchanged))

// NOTE: the gear opens the Profile on its Settings tab, only from the menu
// itself, as the gear is only there.
const openSettingsFromGear = makeStep(model =>
  isOnHomeMenu(model) ? openProfile('Settings') : unchanged,
)

// THE MANOR HAND

const openHand = makeStep(model =>
  isOnHomeMenu(model)
    ? Update.combineSteps([releaseInput, HandDialogBinding.requestOpen()])
    : unchanged,
)

// NOTE: a card puts the hand away before it opens its panel, so the
// panel's Done or Esc lands back on the menu, not in the hand: a card's
// handler runs closeHand, then the card's own Step.
const closeHand = makeStep(model =>
  isHandOpen(model) ? HandDialogBinding.requestClose() : unchanged,
)

const stepHandFocus: {
  (card: HandCard): (model: Model) => UpdateReturn
  (model: Model, card: HandCard): UpdateReturn
} = Function.dual(2, (model: Model, card: HandCard): UpdateReturn =>
  isHandOpen(model) && Array.contains(HAND_CARDS, card)
    ? { model, commands: [FocusHandCard({ card })] }
    : { model },
)

export const homeFocusFromKey: (code: string) => UpdateStep =
  code => stepModel =>
    Option.match(maybeFocusStep(code), {
      onNone: () => ({ model: stepModel }),
      onSome: step => {
        if (!isOnHomeMenu(stepModel)) {
          return { model: stepModel }
        }

        const button = steppedHomeFocus(
          homeButtonsOf(stepModel),
          stepModel.maybeHomeFocus,
          step,
        )
        return {
          model: modifyFields(stepModel, {
            maybeHomeFocus: () => Option.some(button),
          }),
          commands: [FocusHomeButton({ button })],
        }
      },
    })

// HOME MENU

const openWhatsNew = makeStep(model =>
  isPanelAllowed(model, 'WhatsNew')
    ? Update.combineSteps([modelStep(seeNews), openPanel('WhatsNew')])
    : unchanged,
)

// NOTE: the Munchopedia (src/features/munchopedia/) opens afresh on the page
// asked for; an entry opened says so to its fold (src/app/composition.ts).
const openMunchopedia = (page: MunchopediaPage) =>
  makeStep(model =>
    isPanelAllowed(model, 'Munchopedia')
      ? Update.combineSteps([
          MunchopediaBinding.requestOpen({ page }),
          openPanel('Munchopedia'),
        ])
      : unchanged,
  )

const turnNews: {
  (step: number): (model: Model) => UpdateReturn
  (model: Model, step: number): UpdateReturn
} = Function.dual(2, (model: Model, step: number): UpdateReturn => ({
  model: isPanelOpen(model, 'WhatsNew')
    ? turnNewsPage(model, step, NEWS_DAYS.length)
    : model,
}))

const openCard = (card: KeyedHandCard) => {
  switch (card) {
    case 'WhatsNew':
      return openWhatsNew
    case 'Munchopedia':
      return openMunchopedia(MunchopediaPage.List())
    case 'Character':
      return openProfile('Look')
    case 'HowToPlay':
      return openPanel('HowToPlay')
  }
}

// NOTE: C opens the character picker on every screen that offers it, so it
// stays with characterFromKey and is left out here. The card keys work from
// the menu without opening the hand first.
export const homeFromKey = (code: string) =>
  makeStep(model => {
    if (!isOnHomeMenu(model)) {
      return unchanged
    } else if (isManorKey(code)) {
      return openHand
    } else if (isSupportKey(code)) {
      return clickSupportLink
    } else if (isSettingsKey(code)) {
      return openProfile('Settings')
    } else {
      return Option.match(maybeHandCardOfKey(code), {
        onNone: () => unchanged,
        onSome: card => (card === 'Character' ? unchanged : openCard(card)),
      })
    }
  })

// DIFFICULTY

export const isAskingDifficultyFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Unseen'])(model.difficultyCard) &&
  isOnHome(model.phase)

const markAsking =
  (mode: RunMode): UpdateStep =>
  stepModel => ({
    model: modifyFields(stepModel, {
      difficultyCard: () =>
        DifficultyCard.Asking({ mode, tutorial: 'Tutorial' }),
    }),
  })

const askDifficulty = (mode: RunMode) =>
  makeStep(model =>
    isPanelAllowed(model, 'Difficulty')
      ? Update.combineSteps([markAsking(mode), openPanel('Difficulty')])
      : unchanged,
  )

export const startWithMode =
  (mode: RunMode): UpdateStep =>
  stepModel =>
    startFromButton(stepModel, startWhenAllowed(stepModel, mode))

export const startOrAsk = (mode: RunMode) =>
  makeStep(model =>
    isAskingDifficultyFirst(model)
      ? Update.combineSteps([unlockAudio, askDifficulty(mode)])
      : startWithMode(mode),
  )

// NOTE: SKIP IT starts the run as a returning player's, saved with the
// pick (`skipTutorial`); TUTORIAL, the default, leaves the lessons be.
const TUTORIAL_PICKS: Readonly<
  Record<TutorialChoice, (model: Model) => Model>
> = {
  Tutorial: Function.identity,
  Skip: skipTutorial,
}

const chooseFromCard =
  (difficulty: Difficulty, tutorial: TutorialChoice): UpdateStep =>
  stepModel => ({
    model: modifyFields(
      TUTORIAL_PICKS[tutorial](chooseDifficulty(stepModel, difficulty)),
      {
        difficultyCard: () => DifficultyCard.Seen(),
      },
    ),
  })

// NOTE: the first-run card's TUTORIAL or SKIP IT, held until a difficulty
// is picked. Only while the card asks.
const pickTutorialChoice = (choice: TutorialChoice) =>
  makeStep(model =>
    DifficultyCard.match(model.difficultyCard, {
      Unseen: () => unchanged,
      Seen: () => unchanged,
      Asking: ({ mode, tutorial }) =>
        tutorial === choice
          ? unchanged
          : Update.combineSteps([
              modelStep(stepModel =>
                modifyFields(stepModel, {
                  difficultyCard: () =>
                    DifficultyCard.Asking({ mode, tutorial: choice }),
                }),
              ),
              playSounds([uiCue('Pop')]),
            ]),
    }),
  )

// NOTE: the difficulty panel opens only to ask a new player before a first
// run. Every later pick is in the single player lobby (src/features/lobby/update.ts).
const pickFromCard = (difficulty: Difficulty) =>
  makeStep(model =>
    DifficultyCard.match(model.difficultyCard, {
      Unseen: () => unchanged,
      Seen: () => unchanged,
      Asking: ({ mode, tutorial }) =>
        isLocked(model.difficulty, difficulty)
          ? unchanged
          : Update.combineSteps([
              chooseFromCard(difficulty, tutorial),
              closePanel,
              startWithMode(mode),
            ]),
    }),
  )

export const settleNightmareFrom =
  (before: Model): UpdateStep =>
  stepModel => ({
    model: startsRun(before, stepModel)
      ? settleNightmare(stepModel)
      : stepModel,
  })

export const unlockNightmareFrom = (before: Model): UpdateStep =>
  stepWhen(
    model => isNightmareUnlockedBy(before, model, runDifficultyOf(model)),
    model => playSounds([uiCue('PowerUp')])(unlockNightmare(model)),
  )

// INSTALL

const dismissHomeScreenTip = (model: Model): Model =>
  model.homeScreenTip === 'Dismissed'
    ? model
    : modifyFields(model, { homeScreenTip: () => 'Dismissed' })

const openHomeScreenSteps = makeStep(model =>
  isOnHomeMenu(model)
    ? Update.combineSteps([releaseInput, HomeScreenStepsBinding.requestOpen()])
    : unchanged,
)

const promptInstall: UpdateStep = stepModel => ({
  model: dismissHomeScreenTip(stepModel),
  commands: [ShowInstallPrompt()],
})

// NOTE: the install tile pulses until its first tap. Chrome's own prompt
// comes first where the browser offered one; an iPhone gets the picture
// guide, since Safari has no prompt to show.
const pressInstall = makeStep(model => {
  if (!isInstallTileShown(model)) {
    return unchanged
  } else if (model.installOffer === 'Ready') {
    return promptInstall
  } else {
    return Update.combineSteps([
      modelStep(dismissHomeScreenTip),
      openHomeScreenSteps,
    ])
  }
})

const settleInstallPrompt: {
  (outcome: InstallOutcome): (model: Model) => Model
  (model: Model, outcome: InstallOutcome): Model
} = Function.dual(2, (model: Model, outcome: InstallOutcome): Model =>
  modifyFields(model, {
    installOffer: () => (outcome === 'Accepted' ? 'Installed' : 'None'),
  }),
)

// UPDATE GIFT

export const unwrapUpdateGift: UpdateStep = stepWhen(
  model => isUpdateGiftShown(model) && model.updateGift === 'Wrapped',
  model =>
    combine(model, [
      stepModel => ({
        model: modifyFields(stepModel, { updateGift: () => 'Unwrapping' }),
        commands: [WaitForUnwrap()],
      }),
      playSounds([uiCue('LootPop')]),
    ]),
)

export const rewrapUpdateGift = (model: Model): Model =>
  modifyFields(model, { updateGift: () => 'Wrapped' })

export const reloadOntoNewerBuild: UpdateStep = model =>
  Option.match(model.maybeNewerBuild, {
    onNone: () => ({ model: rewrapUpdateGift(model) }),
    onSome: build => ({ model, commands: [ReloadPage({ build })] }),
  })

// UPDATE GREETING

// NOTE: the page just reloaded from the gift onto the build it unwrapped,
// so the home menu throws a little party, once. A room link read at the
// same boot may already have co-op open: the party goes over it.
export const greetUpdate = (isDue: boolean) =>
  makeStep(model =>
    isDue &&
    isOnHome(model.phase) &&
    MenuState.isAnyOf(['Home', 'Coop'])(menuState(model))
      ? UpdateGreetingBinding.requestOpen()
      : unchanged,
  )

export const newsFromGreeting = makeStep(() =>
  Update.combineSteps([UpdateGreetingBinding.requestClose(), openWhatsNew]),
)

// END SCREENS

const isOfferingOnlyMenu = (model: Model): boolean =>
  endOffer(model) === 'MenuOnly'

export const focusEndMenuFrom =
  (before: Model): UpdateStep =>
  stepModel =>
    !isOfferingOnlyMenu(before) && isOfferingOnlyMenu(stepModel)
      ? { model: stepModel, commands: [FocusEndMenuButton()] }
      : { model: stepModel }

// NOTE: the home menu, the MANOR hand, the panels, the pause MENU pill,
// How to play's cards, What's New's pages, and the install tile
// (./message.ts, src/features/menus/message.ts,
// src/features/whatsNew/message.ts, src/platform/message.ts). PLAY and
// CO-OP open child Blocks: their handlers are the root's.
export const homeHandlers = defineHandlers({
  ClickedCampaignButton: model =>
    Update.combineSteps(model, [startOrAsk(RunMode.Campaign())]),

  ClickedEndlessButton: model =>
    Update.combineSteps(model, [startOrAsk(RunMode.Endless())]),

  ClickedCharacterButton: model =>
    Update.combineSteps(model, [unlockAudio, closeHand, openProfile('Look')]),

  ClickedHowToPlayButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openPanel('HowToPlay'),
    ]),

  ClickedSettingsButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openSettingsFromGear]),

  // NOTE: the coffee is a real link, so the browser opens it; this only
  // plays the tap.
  ClickedSupportButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound]),

  CompletedClickSupportLink: model => ({ model }),

  ClickedMenuButton: model =>
    Update.combineSteps(model, [unlockAudio, leaveFromMenu]),

  ClickedLeaveRunButton: model => Update.combineSteps(model, [leaveRun]),

  ClickedStayButton: model => Update.combineSteps(model, [closePanel]),

  ClickedDifficultyCardButton: (model, { difficulty }) =>
    Update.combineSteps(model, [pickFromCard(difficulty)]),

  ClickedTutorialChoiceButton: (model, { choice }) =>
    Update.combineSteps(model, [pickTutorialChoice(choice)]),

  FocusedHomeButton: (model, { button }) => ({
    model: modifyFields(model, { maybeHomeFocus: () => Option.some(button) }),
  }),

  BlurredHomeButton: model => ({
    model: modifyFields(model, { maybeHomeFocus: () => Option.none() }),
  }),

  CompletedFocusHomeButton: model => ({ model }),

  CompletedFocusEndMenuButton: model => ({ model }),

  ClickedWhatsNewButton: model =>
    Update.combineSteps(model, [unlockAudio, closeHand, openWhatsNew]),

  ClickedMunchopediaButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openMunchopedia(MunchopediaPage.List()),
    ]),

  ClickedNewEntryButton: (model, { kind }) =>
    Update.combineSteps(model, [
      unlockAudio,
      openMunchopedia(MunchopediaPage.Entry({ kind })),
    ]),

  ClickedManorButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openHand]),

  ClickedTurnHint: model => ({ model: seeTurnHint(model) }),

  SteppedHandFocus: (model, { card }) => stepHandFocus(model, card),

  CompletedFocusHandCard: model => ({ model }),

  FocusedHelpCard: (model, { card }) => ({ model: showHelpLine(model, card) }),

  ClickedHelpCard: (model, { card }) => unlockAudio(showHelpLine(model, card)),

  ClickedOlderNewsButton: model => turnNews(model, 1),

  ClickedNewerNewsButton: model => turnNews(model, -1),

  ClickedInstallButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, pressInstall]),

  ChangedInstallOffer: (model, { installOffer }) => ({
    model: modifyFields(model, { installOffer: () => installOffer }),
  }),

  CompletedShowInstallPrompt: (model, { outcome }) => ({
    model: settleInstallPrompt(model, outcome),
  }),
})
