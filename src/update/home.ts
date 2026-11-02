import { Array, Duration, Effect, Option, Schema, pipe } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import {
  HandDialogBinding,
  HomeScreenStepsBinding,
  PanelDialogBinding,
  UpdateGreetingBinding,
} from '../bindings'
import { setBotCalling } from '../bots'
import {
  type CallingStanding,
  callingStandingOf,
  canAffordCalling,
} from '../calling'
import {
  buyCalling,
  chooseCalling,
  tryOnCalling,
  withoutTryOn,
} from '../callingPick'
import { NEWS_DAYS } from '../changelog'
import { makeCommand, makeStep } from '../definition'
import {
  chooseDifficulty,
  isLocked,
  isNightmareUnlockedBy,
  settleNightmare,
  unlockNightmare,
} from '../difficulty'
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
  showMunchopediaPage,
  steppedHomeFocus,
  turnNewsPage,
} from '../home'
import { isMenuKey, isStartKey, maybeFocusStep, releaseAll } from '../input'
import { InstallPrompt } from '../install'
import {
  MenuState,
  isAnyPanelOpen,
  isHandOpen,
  isOnHomeMenu,
  isPanelOpen,
  isPastRestartGrace,
  menuState,
} from '../menuState'
import { Message } from '../message'
import {
  type Difficulty,
  DifficultyCard,
  HandCard,
  type HelpCard,
  HomeButton,
  type InstallOutcome,
  type MenuPanel,
  type Model,
  MunchopediaPage,
  type RunMode,
} from '../model'
import { runDifficultyOf } from '../onlineRun'
import type { Calling } from '../playerData'
import { rankOf, totalPointsOf } from '../rank'
import { activateNewBuild } from '../serviceWorker'
import { stepWhen } from '../stepWhen'
import { reloadOnto } from '../version'
import { openProfile } from './profile'
import { isPaused, startFromButton, startWhenAllowed, startsRun } from './run'
import { playSounds, uiCue, unlockAudio } from './sound'
import {
  type UpdateReturn,
  type UpdateStep,
  combine,
  modelStep,
  releaseInput,
  unchanged,
  withInput,
} from './step'
import { markCallingsSeen } from './unlocks'

// COMMAND

export const ShowInstallPrompt = makeCommand('ShowInstallPrompt', {
  messages: [Message.CompletedShowInstallPrompt],
  handler: function* () {
    return () =>
      InstallPrompt.use(installPrompt =>
        Effect.map(installPrompt.prompt, outcome =>
          Message.CompletedShowInstallPrompt({ outcome }),
        ),
      )
  },
})

export const FocusHomeButton = makeCommand('FocusHomeButton', {
  args: { button: HomeButton },
  messages: [Message.CompletedFocusHomeButton],
  handler: function* () {
    return ({ button }) =>
      Dom.focus(`#${homeButtonId(button)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusHomeButton()),
      )
  },
})

// NOTE: B buys Rattles a coffee from the keyboard. The coffee is a real
// link, so the key clicks it, as SHARE's key does: the browser opens the
// link from a click, which no popup blocker stops, and the click sends
// ClickedSupportButton like a tap.
export const ClickSupportLink = makeCommand('ClickSupportLink', {
  messages: [Message.CompletedClickSupportLink],
  handler: function* () {
    return () =>
      Dom.clickElement(`#${homeButtonId('Support')}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedClickSupportLink()),
      )
  },
})

const clickSupportLink: UpdateStep = model =>
  isSupportShown(model) ? { model, commands: [ClickSupportLink()] } : { model }

export const FocusHandCard = makeCommand('FocusHandCard', {
  args: { card: HandCard },
  messages: [Message.CompletedFocusHandCard],
  handler: function* () {
    return ({ card }) =>
      Dom.focus(`#${handCardId(card)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusHandCard()),
      )
  },
})

export const FocusEndMenuButton = makeCommand('FocusEndMenuButton', {
  messages: [Message.CompletedFocusEndMenuButton],
  handler: function* () {
    return () =>
      Dom.focus(`#${END_MENU_BUTTON_ID}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusEndMenuButton()),
      )
  },
})

// NOTE: long enough for the gift's unwrap animation (src/menu.css) to
// play out before the page goes.
const UNWRAP_DURATION = Duration.millis(650)

export const WaitForUnwrap = makeCommand('WaitForUnwrap', {
  messages: [Message.CompletedWaitForUnwrap],
  handler: function* () {
    return () =>
      Effect.as(Effect.sleep(UNWRAP_DURATION), Message.CompletedWaitForUnwrap())
  },
})

// NOTE: the new build's service worker takes over first, when there is one,
// so the reload and any later offline start run the new build. A worker that
// fails or is slow never stops the reload.
export const ReloadPage = makeCommand('ReloadPage', {
  args: { build: Schema.String },
  messages: [Message.CompletedReloadPage, Message.FailedReloadPage],
  handler: function* () {
    return ({ build }) =>
      pipe(
        Effect.ignore(activateNewBuild),
        Effect.andThen(reloadOnto(build)),
        Effect.as(Message.CompletedReloadPage()),
        Effect.catch(error =>
          Effect.succeed(Message.FailedReloadPage({ reason: error.reason })),
        ),
      )
  },
})

// MENU

// NOTE: the panel's Closed fold (src/composition.ts): a Difficulty panel
// that asked before a run, closed without a pick, asks again next time.
export const forgetAskedMode: UpdateStep = stepModel => ({
  model: modifyFields(
    DifficultyCard.isAnyOf(['Asking'])(stepModel.difficultyCard)
      ? modifyFields(stepModel, {
          difficultyCard: () => DifficultyCard.Unseen(),
        })
      : stepModel,
    {
      home: home =>
        modifyFields(home, {
          maybePickingBot: () => Option.none(),
          maybeTryingCalling: () => Option.none(),
        }),
    },
  ),
})

// NOTE: Leave Run opens over the pause menu, the hero picker over the bare
// home menu or the single player lobby, every other panel over the bare home
// menu.
const isPanelAllowed = (model: Model, panel: MenuPanel): boolean => {
  if (panel === 'LeaveRun') {
    return MenuState.isAnyOf(['Paused'])(menuState(model))
  } else if (panel === 'Calling') {
    return MenuState.isAnyOf(['Home', 'Lobby'])(menuState(model))
  } else {
    return MenuState.isAnyOf(['Home'])(menuState(model))
  }
}

const showPanel =
  (panel: MenuPanel): UpdateStep =>
  stepModel => ({
    model: withInput(
      modifyFields(
        panel === 'Calling' ? markCallingsSeen(stepModel) : stepModel,
        {
          panel: () => panel,
          tutorialReset: () => 'Idle',
          maybeOpenHelpCard: () => Option.none(),
        },
      ),
      releaseAll,
    ),
  })

// NOTE: a How to play card shows its line once focused (a keyboard) or
// tapped (touch), and keeps it until another card takes its place.
export const showHelpLine = (model: Model, card: HelpCard): Model =>
  modifyFields(model, { maybeOpenHelpCard: () => Option.some(card) })

export const openPanel = (panel: MenuPanel) =>
  makeStep(model =>
    isPanelAllowed(model, panel)
      ? Update.combineSteps([
          showPanel(panel),
          PanelDialogBinding.requestOpen(),
        ])
      : unchanged,
  )

export const closePanel = makeStep(model =>
  isAnyPanelOpen(model) ? PanelDialogBinding.requestClose() : unchanged,
)

export const goHome = modelStep(model =>
  returnHome(withInput(model, releaseAll)),
)

export const leaveFromMenu = makeStep(model => {
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
export const leaveRun = makeStep(model =>
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
export const openSettingsFromGear = makeStep(model =>
  isOnHomeMenu(model) ? openProfile('Settings') : unchanged,
)

// THE MANOR HAND

export const openHand = makeStep(model =>
  isOnHomeMenu(model)
    ? Update.combineSteps([releaseInput, HandDialogBinding.requestOpen()])
    : unchanged,
)

// NOTE: a card puts the hand away before it opens its panel, so the
// panel's Done or Esc lands back on the menu, not in the hand: a card's
// handler runs closeHand, then the card's own Step.
export const closeHand = makeStep(model =>
  isHandOpen(model) ? HandDialogBinding.requestClose() : unchanged,
)

export const stepHandFocus = (model: Model, card: HandCard): UpdateReturn =>
  isHandOpen(model) && Array.contains(HAND_CARDS, card)
    ? { model, commands: [FocusHandCard({ card })] }
    : { model }

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

export const openWhatsNew = makeStep(model =>
  isPanelAllowed(model, 'WhatsNew')
    ? Update.combineSteps([modelStep(seeNews), openPanel('WhatsNew')])
    : unchanged,
)

const showPage = (page: MunchopediaPage) =>
  modelStep(model => showMunchopediaPage(model, page))

export const openMunchopedia = (page: MunchopediaPage) =>
  makeStep(model =>
    isPanelAllowed(model, 'Munchopedia')
      ? Update.combineSteps([showPage(page), openPanel('Munchopedia')])
      : unchanged,
  )

export const turnMunchopediaPage = (
  model: Model,
  page: MunchopediaPage,
): UpdateReturn => ({
  model: isPanelOpen(model, 'Munchopedia')
    ? showMunchopediaPage(model, page)
    : model,
})

export const turnNews = (model: Model, step: number): UpdateReturn => ({
  model: isPanelOpen(model, 'WhatsNew')
    ? turnNewsPage(model, step, NEWS_DAYS.length)
    : model,
})

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
      difficultyCard: () => DifficultyCard.Asking({ mode }),
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

const chooseFromCard =
  (difficulty: Difficulty): UpdateStep =>
  stepModel => ({
    model: modifyFields(chooseDifficulty(stepModel, difficulty), {
      difficultyCard: () => DifficultyCard.Seen(),
    }),
  })

// NOTE: the difficulty panel opens only to ask a new player before a first
// run. Every later pick is in the single player lobby (src/update/lobby.ts).
export const pickFromCard = (difficulty: Difficulty) =>
  makeStep(model =>
    DifficultyCard.match(model.difficultyCard, {
      Unseen: () => unchanged,
      Seen: () => unchanged,
      Asking: ({ mode }) =>
        isLocked(model.difficulty, difficulty)
          ? unchanged
          : Update.combineSteps([
              chooseFromCard(difficulty),
              closePanel,
              startWithMode(mode),
            ]),
    }),
  )

// NOTE: a calling is picked from the home menu's picker, never in a run.
// An owned hero is the pick. One for sale (its rank is reached) is tried on
// for the player's own pick and bought by the BUY pill (`buyHero`); a
// teammate bot only takes a hero the player owns. A locked one shakes.
const pickedOwned = (calling: Calling) =>
  Update.combineSteps([
    modelStep(stepModel =>
      Option.match(stepModel.home.maybePickingBot, {
        onNone: () => chooseCalling(withoutTryOn(stepModel), calling),
        onSome: index => setBotCalling(withoutTryOn(stepModel), index, calling),
      }),
    ),
    closePanel,
  ])

const deniedCard: UpdateStep = stepModel =>
  playSounds([uiCue('Denied')])(withoutTryOn(stepModel))

const CARD_TAPS = {
  Owned: pickedOwned,
  ForSale: (calling: Calling) =>
    makeStep(model =>
      Update.combineSteps([
        Option.isSome(model.home.maybePickingBot)
          ? deniedCard
          : stepModel =>
              playSounds([uiCue('Pop')])(tryOnCalling(stepModel, calling)),
      ]),
    ),
  Locked: () => Update.combineSteps([deniedCard]),
} satisfies Record<CallingStanding, unknown>

export const pickCalling = (calling: Calling) =>
  makeStep(model =>
    isPanelOpen(model, 'Calling') && isOnHome(model.phase)
      ? CARD_TAPS[
          callingStandingOf(
            calling,
            rankOf(totalPointsOf(model.rank)),
            model.boughtCosmetics,
          )
        ](calling)
      : unchanged,
  )

// NOTE: the BUY pill: spends the Bones on the hero being tried on and makes
// it the pick, and the picker closes. Short of Bones it shakes and stays.
// Nothing without a try-on, or for a hero no longer for sale.
export const buyHero = makeStep(model =>
  Option.match(model.home.maybeTryingCalling, {
    onNone: () => unchanged,
    onSome: calling =>
      !isPanelOpen(model, 'Calling') ||
      Option.isSome(model.home.maybePickingBot) ||
      callingStandingOf(
        calling,
        rankOf(totalPointsOf(model.rank)),
        model.boughtCosmetics,
      ) !== 'ForSale'
        ? Update.combineSteps([modelStep(withoutTryOn)])
        : canAffordCalling(model.rank, calling)
          ? Update.combineSteps([
              stepModel =>
                playSounds([uiCue('Purchase')])(buyCalling(stepModel, calling)),
              closePanel,
            ])
          : Update.combineSteps([playSounds([uiCue('Denied')])]),
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

// SETTINGS

export const toggleShake = (model: Model): Model =>
  modifyFields(model, {
    shakeSetting: setting => (setting === 'On' ? 'Off' : 'On'),
  })

export const toggleCursor = (model: Model): Model =>
  modifyFields(model, {
    cursorSetting: setting => (setting === 'Bold' ? 'Thin' : 'Bold'),
  })

export const toggleShareStats = (model: Model): Model =>
  modifyFields(model, {
    shareStats: setting => (setting === 'On' ? 'Off' : 'On'),
  })

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
export const pressInstall = makeStep(model => {
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

export const settleInstallPrompt = (
  model: Model,
  outcome: InstallOutcome,
): Model =>
  modifyFields(model, {
    installOffer: () => (outcome === 'Accepted' ? 'Installed' : 'None'),
  })

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
