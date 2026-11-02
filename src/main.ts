import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { bootCommands } from './boot'
import { ApplicationComposition } from './composition'
import { makeStep } from './definition'
import { endQuest } from './firstBreakQuest'
import { refreshIntent } from './frame'
import {
  type PointerPress,
  moveMouse,
  movePointer,
  pressHoldButton,
  pressPointer,
  releaseKeys,
  releasePointer,
  releaseSticks,
} from './input'
import { noteMissedKeyDown } from './keyGrab'
import { skipKitchenTour } from './kitchenTour'
import {
  AudioState,
  type InputDevice,
  LOAD_STEPS,
  Loading,
  type Model,
  MunchopediaPage,
  type PointerDevice,
  RunMode,
  cosmeticSeedOf,
  initialModel,
} from './model'
import { skipDebutCard } from './onboarding'
import { LinkFlow } from './playerSync'
import { forgetTutorial } from './save'
import { stepWhen } from './stepWhen'
import { askForRoomLink, openCoop, tickRoomFrame } from './update/coop'
import { orInRun } from './update/coopRun'
import {
  leaveRoomFromCard,
  retry,
  runItBack,
  settleShare,
  shareFromButton,
  skipFromPointer,
  toRoomLobby,
} from './update/end'
import { toggleFullscreen } from './update/fullscreen'
import {
  buyHero,
  closeHand,
  closePanel,
  greetUpdate,
  leaveFromMenu,
  leaveRun,
  newsFromGreeting,
  openHand,
  openMunchopedia,
  openPanel,
  openSettingsFromGear,
  openWhatsNew,
  pickCalling,
  pickFromCard,
  pressInstall,
  reloadOntoNewerBuild,
  rewrapUpdateGift,
  settleInstallPrompt,
  showHelpLine,
  startOrAsk,
  stepHandFocus,
  toggleCursor,
  toggleShake,
  toggleShareStats,
  turnMunchopediaPage,
  turnNews,
  unwrapUpdateGift,
} from './update/home'
import {
  addLobbyBot,
  backFromLobby,
  blurredLobbyControl,
  dropLobbyBot,
  focusedLobbyControl,
  openLobbyBotHero,
  openLobbyHero,
  pickLobbyDifficulty,
  pickLobbyMode,
  playFromHome,
  startFromLobby,
} from './update/lobby'
import {
  asAllowedPress,
  buyAmmoFromHoldButton,
  clickAmmoTag,
  clickNextTrap,
  clickPause,
  clickPlaceTrap,
  clickStartWave,
  isDebutCardBlocking,
  isFreshRun,
  isSlotClickPassingThrough,
  isSlotPressAShot,
  notePageVisibility,
  orientationOf,
  pauseWhenAway,
  pressGunSlot,
  pressMeleeSlot,
  pressedKey,
  releasedKey,
  reloadFromButton,
  resumeFromPointer,
  skipDebutCardWhenUp,
  swapFromButton,
  tickFrame,
  useDevice,
  withSlotClick,
} from './update/play'
import {
  leaveNameInput,
  openProfile,
  rollNameDice,
  submitName,
  typeName,
} from './update/profile'
import { toggleRotation } from './update/rotation'
import { keepGoingWhenAllowed, startFromButton, startsRun } from './update/run'
import {
  answerTutorialReset,
  askToResetTutorial,
  failWrite,
  finishLoading,
  finishWrite,
  finishWriteWithRun,
  forgetRunWait,
  loadSave,
  settleRun,
  startLinking,
  submitLinkCode,
  takeSyncedSave,
  typeLinkCode,
} from './update/save'
import { type SaveWrite, afterMessage } from './update/settle'
import { buy, focusShopItem, moveShopFocus } from './update/shop'
import {
  ResumeAudio,
  notePlayOutcome,
  playSounds,
  playStartSoundWhen,
  tapSound,
  toggleMusic,
  toggleSound,
  uiCue,
  unlockAudio,
} from './update/sound'
import {
  type UpdateReturn,
  combine,
  modelStep,
  unchanged,
  withInput,
} from './update/step'
import {
  checkForUpdate,
  recordRemoteBuild,
  registerServiceWorkerAfterSplash,
} from './update/version'
import { RUNNING_BUILD, isGreetingDue } from './version'
import { isRoundActive } from './waves'
// INIT

// NOTE: every LoadStep must finish before the splash goes. A step that
// fails still counts as finished, so a missing font never holds the game.
// New assets, such as images for Canvas.Image, join LOAD_STEPS with a
// Command that loads them.
export const init = ApplicationComposition.makeInit(() => ({
  model: modifyFields(initialModel, {
    loading: () => Loading.Loading({ pending: LOAD_STEPS }),
  }),
  commands: bootCommands(),
}))

// SETTLING

// NOTE: a plain handler's result, then the after-message Steps from the
// Model before it (src/update/settle.ts). A handler whose Step uses a
// Binding ends its own `Update.combineSteps` with `...afterMessage(model)`.
const settle = (
  before: Model,
  result: UpdateReturn,
  saveWrite: SaveWrite = 'Write',
): UpdateReturn => {
  const settled = combine(result.model, afterMessage(before, saveWrite))
  return {
    model: settled.model,
    commands: [...(result.commands ?? []), ...(settled.commands ?? [])],
  }
}

const deviceOf = (device: PointerDevice): InputDevice =>
  device === 'Touch' ? 'Touch' : 'KeyboardMouse'

const pressedPointer = (model: Model, pointer: PointerPress): UpdateReturn => {
  const press = asAllowedPress(model, pointer)
  const started = resumeFromPointer(useDevice(model, deviceOf(press.device)))
  const pressed = isRoundActive(model.phase)
    ? withInput(skipDebutCardWhenUp(started), input =>
        pressPointer(input, started.maybeSurface, press),
      )
    : refreshIntent(skipFromPointer(started))
  return settle(
    model,
    combine(pressed, [
      unlockAudio,
      playStartSoundWhen(startsRun(model, pressed)),
    ]),
  )
}

// NOTE: the click after a mouse's shot through a slot (PressedHudSlot) is
// spent, and the next click on a slot acts again.
const passSlotClick = (model: Model): UpdateReturn =>
  settle(model, { model: withSlotClick(model, 'Acts') })

export const update = ApplicationComposition.makeUpdate({
  TickedFrame: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, tickFrame(message.deltaTime))),
      ...afterMessage(model),
    ]),

  TickedRoomFrame: (model, { nowMs }) =>
    Update.combineSteps(model, [tickRoomFrame(nowMs), ...afterMessage(model)]),

  PressedKey: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, pressedKey(message.code))),
      ...afterMessage(model),
    ]),

  ReleasedKey: (model, { code }) =>
    Update.combineSteps(model, [releasedKey(code), ...afterMessage(model)]),

  PressedMetaKey: model =>
    settle(model, { model: withInput(model, releaseKeys) }),

  MissedKeyDown: model => settle(model, { model: noteMissedKeyDown(model) }),

  BlurredWindow: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, pauseWhenAway)),
      ...afterMessage(model),
    ]),

  ChangedPageVisibility: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, notePageVisibility(message.visibility))),
      ...afterMessage(model),
    ]),

  PressedPointer: (model, press) => pressedPointer(model, press),

  PressedHudSlot: (model, press) =>
    isSlotPressAShot(model, press.device)
      ? pressedPointer(withSlotClick(model, 'PassesThrough'), press)
      : settle(model, {
          model: withSlotClick(
            useDevice(model, deviceOf(press.device)),
            'Acts',
          ),
        }),

  MovedPointer: (model, { pointerId, clientX, clientY }) =>
    settle(model, {
      model: withInput(model, input =>
        movePointer(input, model.maybeSurface, { pointerId, clientX, clientY }),
      ),
    }),

  ReleasedPointer: (model, { pointerId }) =>
    settle(
      model,
      unlockAudio(withInput(model, input => releasePointer(input, pointerId))),
    ),

  // NOTE: the finger holds the interact until it lifts, and at the ammo
  // window its landing buys at once.
  PressedHoldButton: (model, message) =>
    Update.combineSteps(model, [
      modelStep(held =>
        withInput(useDevice(held, 'Touch'), input =>
          pressHoldButton(input, message.pointerId),
        ),
      ),
      unlockAudio,
      makeStep(orInRun(message, buyAmmoFromHoldButton)),
      ...afterMessage(model),
    ]),

  ClickedAmmoTag: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, clickAmmoTag)),
      ...afterMessage(model),
    ]),

  CancelledPointer: (model, { pointerId }) =>
    settle(model, {
      model: withInput(model, input => releasePointer(input, pointerId)),
    }),

  ReleasedEveryTouch: model =>
    settle(model, { model: withInput(model, releaseSticks) }),

  MovedMouse: (model, { clientX, clientY }) =>
    settle(model, {
      model: withInput(useDevice(model, 'KeyboardMouse'), input =>
        moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
      ),
    }),

  SuppressedContextMenu: model => settle(model, { model }),

  // NOTE: the touch tap listener (src/touchTaps.ts) reports each tap it
  // made. The tapped button's own Message did the work.
  TappedWithTouch: model => settle(model, { model }),

  MeasuredGameSurface: (model, { left, top, width, height }) =>
    settle(model, {
      model: modifyFields(model, {
        maybeSurface: () => Option.some({ left, top, width, height }),
        orientation: () => orientationOf(width, height),
      }),
    }),

  CompletedGenerateSeed: (model, { seed }) =>
    settle(model, {
      model: modifyFields(model, {
        rngState: () => seed,
        cosmeticRngState: () => cosmeticSeedOf(seed),
      }),
    }),

  CompletedDetectInputDevice: (model, { touchControls }) =>
    settle(model, {
      model: useDevice(
        modifyFields(model, { touchControls: () => touchControls }),
        touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
      ),
    }),

  ClickedMuteButton: model => settle(model, unlockAudio(toggleSound(model))),

  ClickedPauseButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, clickPause)),
      ...afterMessage(model),
    ]),

  ClickedMusicButton: model => settle(model, unlockAudio(toggleMusic(model))),

  ClickedCursorButton: model => settle(model, { model: toggleCursor(model) }),

  ClickedCampaignButton: model =>
    Update.combineSteps(model, [
      startOrAsk(RunMode.Campaign()),
      ...afterMessage(model),
    ]),

  ClickedEndlessButton: model =>
    Update.combineSteps(model, [
      startOrAsk(RunMode.Endless()),
      ...afterMessage(model),
    ]),

  ClickedKeepGoingButton: model =>
    settle(model, startFromButton(model, keepGoingWhenAllowed(model))),

  ClickedRetryButton: model =>
    settle(model, startFromButton(model, retry(model))),

  ClickedShareButton: model =>
    settle(model, combine(model, [unlockAudio, shareFromButton])),

  ClickedRunItBackButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      runItBack,
      ...afterMessage(model),
    ]),

  ClickedRoomLobbyButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      toRoomLobby,
      ...afterMessage(model),
    ]),

  ClickedLeaveRoomButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      leaveRoomFromCard,
      ...afterMessage(model),
    ]),

  ClickedCharacterButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openProfile('Look'),
      ...afterMessage(model),
    ]),

  UpdatedNameDraft: (model, { value }) => settle(model, typeName(model, value)),

  SubmittedName: model => settle(model, submitName(model)),

  BlurredNameInput: model => settle(model, leaveNameInput(model)),

  ClickedNameDiceButton: model => settle(model, rollNameDice(model)),

  ClickedStartWaveButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, clickStartWave)),
      ...afterMessage(model),
    ]),

  ClickedDebutCardButton: model =>
    settle(
      model,
      stepWhen(isDebutCardBlocking, stepModel =>
        unlockAudio(skipDebutCard(stepModel)),
      )(model),
    ),

  ClickedSwapButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, swapFromButton)),
      ...afterMessage(model),
    ]),

  ClickedGunSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressGunSlot(message.slot))),
          ...afterMessage(model),
        ]),

  ClickedMeleeSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressMeleeSlot)),
          ...afterMessage(model),
        ]),

  // NOTE: on touch the reload button is a tap like any button, made into a
  // click by src/touchTaps.ts even with a thumb on the move stick.
  ClickedReloadButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, reloadFromButton)),
      ...afterMessage(model),
    ]),

  ClickedFullscreenButton: model => settle(model, toggleFullscreen(model)),

  CompletedSetFullscreen: (model, { fullscreen }) =>
    settle(model, {
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

  FailedSetFullscreen: model => settle(model, { model }),

  ChangedFullscreen: (model, { fullscreen }) =>
    settle(model, {
      model: modifyFields(model, { fullscreen: () => fullscreen }),
    }),

  CompletedDetectScreenFit: (model, { screenFit }) =>
    settle(model, {
      model: modifyFields(model, { screenFit: () => screenFit }),
    }),

  CompletedDetectOrientationLock: (model, { orientationLock }) =>
    settle(model, {
      model: modifyFields(model, { orientationLock: () => orientationLock }),
    }),

  CompletedDetectLocalPlayers: (model, { count }) =>
    settle(model, {
      model: modifyFields(model, { localPlayers: () => count }),
    }),

  CompletedApplyRotation: model => settle(model, { model }),

  ClickedRotationButton: model =>
    settle(model, { model: toggleRotation(model) }),

  ClickedInstallButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      pressInstall,
      ...afterMessage(model),
    ]),

  ChangedInstallOffer: (model, { installOffer }) =>
    settle(model, {
      model: modifyFields(model, { installOffer: () => installOffer }),
    }),

  CompletedShowInstallPrompt: (model, { outcome }) =>
    settle(model, { model: settleInstallPrompt(model, outcome) }),

  ClickedPlaceTrapButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, clickPlaceTrap)),
      ...afterMessage(model),
    ]),

  ClickedNextTrapButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, clickNextTrap)),
      ...afterMessage(model),
    ]),

  ClickedBuyButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(
        orInRun(message, (buyingModel: Model) =>
          buy(buyingModel, message.item),
        ),
      ),
      ...afterMessage(model),
    ]),

  PressedBuyKey: (model, message) =>
    Update.combineSteps(model, [
      makeStep(
        orInRun(message, (buyingModel: Model) =>
          buy(buyingModel, message.item),
        ),
      ),
      ...afterMessage(model),
    ]),

  MovedShopFocus: (model, { item }) =>
    settle(model, moveShopFocus(model, item)),

  FocusedShopItem: (model, { item }) =>
    settle(model, { model: focusShopItem(model, item) }),

  CompletedFocusShopItem: model => settle(model, { model }),
  CompletedFocusLookOption: model => settle(model, { model }),

  AcquiredAudioEngine: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      commands: [ResumeAudio()],
    }),

  FailedAcquireAudioEngine: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Unavailable() }),
    }),

  ReleasedAudioEngine: model => settle(model, { model }),

  CompletedResumeAudio: (model, { playback }) => {
    if (playback === 'Running') {
      const ready = modifyFields(model, { audio: () => AudioState.Ready() })
      return settle(model, playStartSoundWhen(isFreshRun(ready))(ready))
    } else {
      return settle(model, {
        model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      })
    }
  },

  FailedResumeAudio: model =>
    settle(model, {
      model: modifyFields(model, { audio: () => AudioState.Suspended() }),
    }),

  CompletedPlaySound: (model, { outcome }) =>
    settle(model, notePlayOutcome(outcome)(model)),

  FailedPlaySound: model => settle(model, { model }),

  CompletedCueMusic: model => settle(model, { model }),

  FailedCueMusic: model => settle(model, { model }),

  FocusedWindow: model => settle(model, checkForUpdate(model)),

  RestoredPageFromCache: model => settle(model, checkForUpdate(model)),

  TickedUpdateCheck: model => settle(model, checkForUpdate(model)),

  CompletedFetchBuild: (model, { build }) =>
    settle(model, recordRemoteBuild(model, RUNNING_BUILD, build)),

  FailedFetchBuild: model => settle(model, { model }),

  ClickedUpdateButton: model =>
    settle(model, combine(model, [unlockAudio, unwrapUpdateGift])),

  CompletedWaitForUnwrap: model => settle(model, reloadOntoNewerBuild(model)),

  CompletedReadUpdateMarker: (model, { maybeBuild }) =>
    Update.combineSteps(model, [
      greetUpdate(isGreetingDue(RUNNING_BUILD, maybeBuild)),
      ...afterMessage(model),
    ]),

  ClickedUpdateGreetingNewsButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      newsFromGreeting,
      ...afterMessage(model),
    ]),

  CompletedReloadPage: model => settle(model, { model }),

  FailedReloadPage: model => settle(model, { model: rewrapUpdateGift(model) }),

  CompletedRegisterServiceWorker: model => settle(model, { model }),

  FailedRegisterServiceWorker: model => settle(model, { model }),

  CompletedUpdateServiceWorker: model => settle(model, { model }),

  FailedUpdateServiceWorker: model => settle(model, { model }),

  ClickedHowToPlayButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openPanel('HowToPlay'),
      ...afterMessage(model),
    ]),

  FocusedHelpCard: (model, { card }) =>
    settle(model, { model: showHelpLine(model, card) }),

  ClickedHelpCard: (model, { card }) =>
    settle(model, unlockAudio(showHelpLine(model, card))),

  ClickedSkipQuestButton: model => settle(model, unlockAudio(endQuest(model))),

  ClickedSkipKitchenTourButton: model =>
    settle(model, unlockAudio(skipKitchenTour(model))),

  ClickedSettingsButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openSettingsFromGear,
      ...afterMessage(model),
    ]),

  // NOTE: the coffee is a real link, so the browser opens it; this only
  // plays the tap.
  ClickedSupportButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, ...afterMessage(model)]),

  ClickedMenuButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      leaveFromMenu,
      ...afterMessage(model),
    ]),

  ClickedLeaveRunButton: model =>
    Update.combineSteps(model, [leaveRun, ...afterMessage(model)]),

  ClickedStayButton: model =>
    Update.combineSteps(model, [closePanel, ...afterMessage(model)]),

  ClickedShakeButton: model => settle(model, { model: toggleShake(model) }),

  ClickedCallingCardButton: (model, { calling }) =>
    Update.combineSteps(model, [pickCalling(calling), ...afterMessage(model)]),

  ClickedBuyCallingButton: model =>
    Update.combineSteps(model, [buyHero, ...afterMessage(model)]),

  ClickedDifficultyCardButton: (model, { difficulty }) =>
    Update.combineSteps(model, [
      pickFromCard(difficulty),
      ...afterMessage(model),
    ]),

  FocusedHomeButton: (model, { button }) =>
    settle(model, {
      model: modifyFields(model, { maybeHomeFocus: () => Option.some(button) }),
    }),

  BlurredHomeButton: model =>
    settle(model, {
      model: modifyFields(model, { maybeHomeFocus: () => Option.none() }),
    }),

  CompletedFocusHomeButton: model => settle(model, { model }),

  CompletedFocusEndMenuButton: model => settle(model, { model }),

  CompletedClickSupportLink: model => settle(model, { model }),

  SettledShare: (model, { outcome }) =>
    settle(model, settleShare(outcome)(model)),

  CompletedDetectShareSheet: (model, { shareSheet }) =>
    settle(model, {
      model: modifyFields(model, { shareSheet: () => shareSheet }),
    }),

  CompletedLoadStyles: model => settle(model, finishLoading(model, 'Styles')),

  CompletedLoadFonts: model => settle(model, finishLoading(model, 'Fonts')),

  FailedLoadFonts: model => settle(model, finishLoading(model, 'Fonts')),

  CompletedAwaitFirstFrame: model =>
    settle(model, finishLoading(model, 'FirstFrame')),

  CompletedDecodeSprites: model =>
    settle(model, finishLoading(model, 'Sprites')),

  CompletedShowLoadProgress: model => settle(model, { model }),

  CompletedHideSplash: model =>
    settle(
      model,
      combine(model, [
        stepModel => registerServiceWorkerAfterSplash(stepModel, RUNNING_BUILD),
        askForRoomLink,
      ]),
    ),

  CompletedLoadSave: (model, { maybeSave }) =>
    settle(model, loadSave(model, maybeSave)),

  FailedLoadSave: model => settle(model, loadSave(model, Option.none())),

  CompletedWriteSave: model => settle(model, finishWrite(model)),

  CompletedWriteSaveWithRun: (model, { runId }) =>
    settle(model, finishWriteWithRun(model, runId)),

  FailedWriteSave: (model, { changes }) =>
    settle(model, failWrite(model, changes)),

  ClickedShareStatsButton: model =>
    settle(model, { model: toggleShareStats(model) }),

  CompletedGenerateVisitId: (model, { visitId }) =>
    settle(model, {
      model: modifyFields(model, { maybeVisitId: () => Option.some(visitId) }),
    }),

  CompletedStartSummaryQueue: model => settle(model, { model }),

  CompletedSendRunSummary: model => settle(model, { model }),

  FailedSendRunSummary: model => settle(model, { model }),

  CompletedSendShareEvent: model => settle(model, { model }),

  FailedSendShareEvent: model => settle(model, { model }),

  ClickedResetTutorialButton: model => settle(model, askToResetTutorial(model)),

  ClickedConfirmResetTutorialButton: model =>
    settle(model, answerTutorialReset(model, forgetTutorial, 'Done')),

  ClickedCancelResetTutorialButton: model =>
    settle(
      model,
      answerTutorialReset(model, unchangedModel => unchangedModel, 'Idle'),
    ),

  CompletedFocusTutorialReset: model => settle(model, { model }),

  UpdatedSyncedSave: (model, { save }) =>
    settle(model, takeSyncedSave(model, save), 'Synced'),

  CompletedReloadSyncedSave: (model, { maybeSave }) =>
    settle(
      model,
      Option.match(maybeSave, {
        onNone: () => ({ model }),
        onSome: save => takeSyncedSave(model, save),
      }),
      'Synced',
    ),

  UpdatedSyncStatus: (model, { state }) =>
    settle(model, {
      model: modifyFields(model, { syncState: () => state }),
    }),

  UpdatedPlayerScopeStatus: (model, { status }) =>
    settle(model, {
      model: modifyFields(model, { playerScopeStatus: () => status }),
    }),

  SettledRecordedRun: (model, { runId, settled }) =>
    settle(model, settleRun(model, runId, settled)),

  FailedAwaitRunSettled: (model, { runId }) =>
    settle(model, forgetRunWait(model, runId)),

  ClickedLinkDeviceButton: model => settle(model, startLinking(model)),

  SucceededRequestLinkCode: (model, { code }) =>
    settle(
      model,
      playSounds([uiCue('Whoosh')])(
        modifyFields(model, { linkFlow: () => LinkFlow.Showing({ code }) }),
      ),
    ),

  FailedRequestLinkCode: (model, { problem }) =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

  ClickedUseCodeButton: model =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Entering({ code: '' }),
      }),
    }),

  UpdatedLinkCode: (model, { value }) =>
    settle(model, typeLinkCode(model, value)),

  SubmittedLinkCode: model => settle(model, submitLinkCode(model)),

  SucceededRedeemLinkCode: model =>
    settle(
      model,
      playSounds([uiCue('PowerUp')])(
        modifyFields(model, { linkFlow: () => LinkFlow.Linked() }),
      ),
    ),

  FailedRedeemLinkCode: (model, { problem }) =>
    settle(model, {
      model: modifyFields(model, {
        linkFlow: () => LinkFlow.Failed({ problem }),
      }),
    }),

  ClickedCancelLinkButton: model =>
    settle(model, {
      model: modifyFields(model, { linkFlow: () => LinkFlow.Idle() }),
    }),

  ClickedPlayButton: model =>
    Update.combineSteps(model, [playFromHome, ...afterMessage(model)]),

  ClickedLobbyBackButton: model =>
    Update.combineSteps(model, [backFromLobby, ...afterMessage(model)]),

  ClickedLobbyStartButton: model =>
    Update.combineSteps(model, [startFromLobby, ...afterMessage(model)]),

  ClickedLobbyHeroButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openLobbyHero,
      ...afterMessage(model),
    ]),

  ClickedLobbyAddBotButton: model =>
    Update.combineSteps(model, [addLobbyBot, ...afterMessage(model)]),

  ClickedLobbyDropBotButton: (model, { index }) =>
    Update.combineSteps(model, [dropLobbyBot(index), ...afterMessage(model)]),

  ClickedLobbyBotHeroButton: (model, { index }) =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openLobbyBotHero(index),
      ...afterMessage(model),
    ]),

  ClickedLobbyModeButton: (model, { mode }) =>
    Update.combineSteps(model, [pickLobbyMode(mode), ...afterMessage(model)]),

  ClickedLobbyDifficultyButton: (model, { difficulty }) =>
    Update.combineSteps(model, [
      pickLobbyDifficulty(difficulty),
      ...afterMessage(model),
    ]),

  FocusedLobbyControl: (model, { control }) =>
    settle(model, { model: focusedLobbyControl(model, control) }),

  BlurredLobbyControl: model =>
    settle(model, { model: blurredLobbyControl(model) }),

  CompletedFocusLobbyControl: model => settle(model, { model }),

  ClickedWhatsNewButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openWhatsNew,
      ...afterMessage(model),
    ]),

  ClickedOlderNewsButton: model => settle(model, turnNews(model, 1)),

  ClickedNewerNewsButton: model => settle(model, turnNews(model, -1)),

  ClickedMunchopediaButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openMunchopedia(MunchopediaPage.List()),
      ...afterMessage(model),
    ]),

  ClickedMunchopediaEntryButton: (model, { kind }) =>
    settle(model, turnMunchopediaPage(model, MunchopediaPage.Entry({ kind }))),

  ClickedMunchopediaListButton: model =>
    settle(model, turnMunchopediaPage(model, MunchopediaPage.List())),

  ClickedNewEntryButton: (model, { kind }) =>
    Update.combineSteps(model, [
      unlockAudio,
      openMunchopedia(MunchopediaPage.Entry({ kind })),
      ...afterMessage(model),
    ]),

  ClickedManorButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openHand,
      ...afterMessage(model),
    ]),

  SteppedHandFocus: (model, { card }) =>
    settle(model, stepHandFocus(model, card)),

  CompletedFocusHandCard: model => settle(model, { model }),

  ClickedCoopButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openCoop(Option.none()),
      ...afterMessage(model),
    ]),

  CompletedReadRoomLink: (model, { maybeCode }) =>
    Update.combineSteps(model, [
      makeStep(() =>
        Option.isSome(maybeCode) ? openCoop(maybeCode) : unchanged,
      ),
      ...afterMessage(model),
    ]),
})
