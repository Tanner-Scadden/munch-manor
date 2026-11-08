import { Option } from 'effect'
import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { bootCommands } from './boot'
import { ApplicationComposition } from './composition'
import { makeStep } from './definition'
import { endQuest } from './firstBreakQuest'
import { refreshIntent } from './frame'
import { isTurnHintShown, seeTurnHint } from './home'
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
  pickTutorialChoice,
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
  pickLobbyModifier,
  playFromHome,
  startFromLobby,
} from './update/lobby'
import {
  asAllowedPress,
  buyAmmoFromHoldButton,
  clickAmmoTag,
  clickMedic,
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
import { afterMessage } from './update/settle'
import { buy, focusShopItem, moveShopFocus } from './update/shop'
import {
  closeShopGuide,
  openShopGuide,
  showShopGuide,
} from './update/shopGuide'
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
  return combine(pressed, [
    unlockAudio,
    playStartSoundWhen(startsRun(model, pressed)),
  ])
}

// NOTE: the click after a mouse's shot through a slot (PressedHudSlot) is
// spent, and the next click on a slot acts again.
const passSlotClick = (model: Model): UpdateReturn => ({
  model: withSlotClick(model, 'Acts'),
})

const { makeUpdate } = ApplicationComposition

// NOTE: each handler holds only its own change; `update` below settles
// every dispatch once after it.
const handlers = makeUpdate({
  TickedFrame: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, tickFrame(message.deltaTime))),
    ]),

  TickedRoomFrame: (model, { nowMs }) =>
    Update.combineSteps(model, [tickRoomFrame(nowMs)]),

  PressedKey: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, pressedKey(message.code))),
    ]),

  ReleasedKey: (model, { code }) =>
    Update.combineSteps(model, [releasedKey(code)]),

  PressedMetaKey: model => ({ model: withInput(model, releaseKeys) }),

  MissedKeyDown: model => ({ model: noteMissedKeyDown(model) }),

  BlurredWindow: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, pauseWhenAway))]),

  ChangedPageVisibility: (model, message) =>
    Update.combineSteps(model, [
      makeStep(orInRun(message, notePageVisibility(message.visibility))),
    ]),

  PressedPointer: (model, press) => pressedPointer(model, press),

  PressedHudSlot: (model, press) =>
    isSlotPressAShot(model, press.device)
      ? pressedPointer(withSlotClick(model, 'PassesThrough'), press)
      : {
          model: withSlotClick(
            useDevice(model, deviceOf(press.device)),
            'Acts',
          ),
        },

  MovedPointer: (model, { pointerId, clientX, clientY }) => ({
    model: withInput(model, input =>
      movePointer(input, model.maybeSurface, { pointerId, clientX, clientY }),
    ),
  }),

  ReleasedPointer: (model, { pointerId }) =>
    unlockAudio(withInput(model, input => releasePointer(input, pointerId))),

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
    ]),

  ClickedAmmoTag: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickAmmoTag))]),

  CancelledPointer: (model, { pointerId }) => ({
    model: withInput(model, input => releasePointer(input, pointerId)),
  }),

  ReleasedEveryTouch: model => ({ model: withInput(model, releaseSticks) }),

  MovedMouse: (model, { clientX, clientY }) => ({
    model: withInput(useDevice(model, 'KeyboardMouse'), input =>
      moveMouse(input, model.maybeSurface, { x: clientX, y: clientY }),
    ),
  }),

  SuppressedContextMenu: model => ({ model }),

  // NOTE: the touch tap listener (src/touchTaps.ts) reports each tap it
  // made. The tapped button's own Message did the work.
  TappedWithTouch: model => ({ model }),

  // NOTE: turning the phone while the turn hint is up is the hint done.
  MeasuredGameSurface: (model, { left, top, width, height }) => {
    const measured = modifyFields(model, {
      maybeSurface: () => Option.some({ left, top, width, height }),
      orientation: () => orientationOf(width, height),
    })
    return {
      model:
        isTurnHintShown(model) && !isTurnHintShown(measured)
          ? seeTurnHint(measured)
          : measured,
    }
  },

  CompletedGenerateSeed: (model, { seed }) => ({
    model: modifyFields(model, {
      rngState: () => seed,
      cosmeticRngState: () => cosmeticSeedOf(seed),
    }),
  }),

  CompletedDetectInputDevice: (model, { touchControls }) => ({
    model: useDevice(
      modifyFields(model, { touchControls: () => touchControls }),
      touchControls === 'Allowed' ? 'Touch' : 'KeyboardMouse',
    ),
  }),

  ClickedMuteButton: model => unlockAudio(toggleSound(model)),

  ClickedPauseButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickPause))]),

  ClickedMusicButton: model => unlockAudio(toggleMusic(model)),

  ClickedCursorButton: model => ({ model: toggleCursor(model) }),

  ClickedCampaignButton: model =>
    Update.combineSteps(model, [startOrAsk(RunMode.Campaign())]),

  ClickedEndlessButton: model =>
    Update.combineSteps(model, [startOrAsk(RunMode.Endless())]),

  ClickedKeepGoingButton: model =>
    startFromButton(model, keepGoingWhenAllowed(model)),

  ClickedRetryButton: model => startFromButton(model, retry(model)),

  ClickedShareButton: model => combine(model, [unlockAudio, shareFromButton]),

  ClickedRunItBackButton: model =>
    Update.combineSteps(model, [unlockAudio, runItBack]),

  ClickedRoomLobbyButton: model =>
    Update.combineSteps(model, [unlockAudio, toRoomLobby]),

  ClickedLeaveRoomButton: model =>
    Update.combineSteps(model, [unlockAudio, leaveRoomFromCard]),

  ClickedCharacterButton: model =>
    Update.combineSteps(model, [unlockAudio, closeHand, openProfile('Look')]),

  UpdatedNameDraft: (model, { value }) => typeName(model, value),

  SubmittedName: model => submitName(model),

  BlurredNameInput: model => leaveNameInput(model),

  ClickedNameDiceButton: model => rollNameDice(model),

  ClickedStartWaveButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickStartWave))]),

  ClickedDebutCardButton: model =>
    stepWhen(isDebutCardBlocking, stepModel =>
      unlockAudio(skipDebutCard(stepModel)),
    )(model),

  ClickedSwapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, swapFromButton))]),

  ClickedGunSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressGunSlot(message.slot))),
        ]),

  ClickedMeleeSlot: (model, message) =>
    isSlotClickPassingThrough(model)
      ? passSlotClick(model)
      : Update.combineSteps(model, [
          makeStep(orInRun(message, pressMeleeSlot)),
        ]),

  // NOTE: on touch the reload button is a tap like any button, made into a
  // click by src/touchTaps.ts even with a thumb on the move stick.
  ClickedReloadButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, reloadFromButton))]),

  // NOTE: MEDIC! from a downed player, a tap on the red cross.
  ClickedMedicButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickMedic))]),

  ClickedFullscreenButton: model => toggleFullscreen(model),

  CompletedSetFullscreen: (model, { fullscreen }) => ({
    model: modifyFields(model, { fullscreen: () => fullscreen }),
  }),

  FailedSetFullscreen: model => ({ model }),

  ChangedFullscreen: (model, { fullscreen }) => ({
    model: modifyFields(model, { fullscreen: () => fullscreen }),
  }),

  CompletedDetectScreenFit: (model, { screenFit }) => ({
    model: modifyFields(model, { screenFit: () => screenFit }),
  }),

  CompletedDetectOrientationLock: (model, { orientationLock }) => ({
    model: modifyFields(model, { orientationLock: () => orientationLock }),
  }),

  CompletedDetectLocalPlayers: (model, { count }) => ({
    model: modifyFields(model, { localPlayers: () => count }),
  }),

  CompletedApplyRotation: model => ({ model }),

  ClickedRotationButton: model => ({ model: toggleRotation(model) }),

  ClickedInstallButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, pressInstall]),

  ChangedInstallOffer: (model, { installOffer }) => ({
    model: modifyFields(model, { installOffer: () => installOffer }),
  }),

  CompletedShowInstallPrompt: (model, { outcome }) => ({
    model: settleInstallPrompt(model, outcome),
  }),

  ClickedPlaceTrapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickPlaceTrap))]),

  ClickedNextTrapButton: (model, message) =>
    Update.combineSteps(model, [makeStep(orInRun(message, clickNextTrap))]),

  ClickedBuyButton: (model, message) =>
    Update.combineSteps(model, [
      makeStep(
        orInRun(message, (buyingModel: Model) =>
          buy(buyingModel, message.item),
        ),
      ),
    ]),

  PressedBuyKey: (model, message) =>
    Update.combineSteps(model, [
      makeStep(
        orInRun(message, (buyingModel: Model) =>
          buy(buyingModel, message.item),
        ),
      ),
    ]),

  MovedShopFocus: (model, { item }) => moveShopFocus(model, item),

  FocusedShopItem: (model, { item }) => ({ model: focusShopItem(model, item) }),

  CompletedFocusShopItem: model => ({ model }),
  CompletedFocusShopGuide: model => ({ model }),

  ClickedShopGuideButton: model => openShopGuide(model),

  ClickedShopGuideSectionButton: (model, { section }) => ({
    model: showShopGuide(model, section),
  }),

  ClickedShopGuideBackButton: model => closeShopGuide(model),
  CompletedFocusLookOption: model => ({ model }),

  AcquiredAudioEngine: model => ({
    model: modifyFields(model, { audio: () => AudioState.Suspended() }),
    commands: [ResumeAudio()],
  }),

  FailedAcquireAudioEngine: model => ({
    model: modifyFields(model, { audio: () => AudioState.Unavailable() }),
  }),

  ReleasedAudioEngine: model => ({ model }),

  CompletedResumeAudio: (model, { playback }) => {
    if (playback === 'Running') {
      const ready = modifyFields(model, { audio: () => AudioState.Ready() })
      return playStartSoundWhen(isFreshRun(ready))(ready)
    } else {
      return {
        model: modifyFields(model, { audio: () => AudioState.Suspended() }),
      }
    }
  },

  FailedResumeAudio: model => ({
    model: modifyFields(model, { audio: () => AudioState.Suspended() }),
  }),

  CompletedPlaySound: (model, { outcome }) => notePlayOutcome(outcome)(model),

  FailedPlaySound: model => ({ model }),

  CompletedCueMusic: model => ({ model }),

  FailedCueMusic: model => ({ model }),

  FocusedWindow: model => checkForUpdate(model),

  RestoredPageFromCache: model => checkForUpdate(model),

  TickedUpdateCheck: model => checkForUpdate(model),

  CompletedFetchBuild: (model, { build }) =>
    recordRemoteBuild(model, RUNNING_BUILD, build),

  FailedFetchBuild: model => ({ model }),

  ClickedUpdateButton: model => combine(model, [unlockAudio, unwrapUpdateGift]),

  CompletedWaitForUnwrap: model => reloadOntoNewerBuild(model),

  CompletedReadUpdateMarker: (model, { maybeBuild }) =>
    Update.combineSteps(model, [
      greetUpdate(isGreetingDue(RUNNING_BUILD, maybeBuild)),
    ]),

  ClickedUpdateGreetingNewsButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, newsFromGreeting]),

  CompletedReloadPage: model => ({ model }),

  FailedReloadPage: model => ({ model: rewrapUpdateGift(model) }),

  CompletedRegisterServiceWorker: model => ({ model }),

  FailedRegisterServiceWorker: model => ({ model }),

  CompletedUpdateServiceWorker: model => ({ model }),

  FailedUpdateServiceWorker: model => ({ model }),

  ClickedHowToPlayButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openPanel('HowToPlay'),
    ]),

  FocusedHelpCard: (model, { card }) => ({ model: showHelpLine(model, card) }),

  ClickedHelpCard: (model, { card }) => unlockAudio(showHelpLine(model, card)),

  ClickedSkipQuestButton: model => unlockAudio(endQuest(model)),

  ClickedSkipKitchenTourButton: model => unlockAudio(skipKitchenTour(model)),

  ClickedSettingsButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openSettingsFromGear]),

  // NOTE: the coffee is a real link, so the browser opens it; this only
  // plays the tap.
  ClickedSupportButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound]),

  ClickedMenuButton: model =>
    Update.combineSteps(model, [unlockAudio, leaveFromMenu]),

  ClickedLeaveRunButton: model => Update.combineSteps(model, [leaveRun]),

  ClickedStayButton: model => Update.combineSteps(model, [closePanel]),

  ClickedShakeButton: model => ({ model: toggleShake(model) }),

  ClickedCallingCardButton: (model, { calling }) =>
    Update.combineSteps(model, [pickCalling(calling)]),

  ClickedBuyCallingButton: model => Update.combineSteps(model, [buyHero]),

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

  CompletedClickSupportLink: model => ({ model }),

  SettledShare: (model, { outcome }) => settleShare(outcome)(model),

  CompletedDetectShareSheet: (model, { shareSheet }) => ({
    model: modifyFields(model, { shareSheet: () => shareSheet }),
  }),

  CompletedLoadStyles: model => finishLoading(model, 'Styles'),

  CompletedLoadFonts: model => finishLoading(model, 'Fonts'),

  FailedLoadFonts: model => finishLoading(model, 'Fonts'),

  CompletedAwaitFirstFrame: model => finishLoading(model, 'FirstFrame'),

  CompletedDecodeSprites: model => finishLoading(model, 'Sprites'),

  CompletedShowLoadProgress: model => ({ model }),

  CompletedHideSplash: model =>
    combine(model, [
      stepModel => registerServiceWorkerAfterSplash(stepModel, RUNNING_BUILD),
      askForRoomLink,
    ]),

  CompletedLoadSave: (model, { maybeSave }) => loadSave(model, maybeSave),

  FailedLoadSave: model => loadSave(model, Option.none()),

  CompletedWriteSave: model => finishWrite(model),

  CompletedWriteSaveWithRun: (model, { runId }) =>
    finishWriteWithRun(model, runId),

  FailedWriteSave: (model, { changes }) => failWrite(model, changes),

  ClickedShareStatsButton: model => ({ model: toggleShareStats(model) }),

  CompletedGenerateVisitId: (model, { visitId }) => ({
    model: modifyFields(model, { maybeVisitId: () => Option.some(visitId) }),
  }),

  CompletedStartSummaryQueue: model => ({ model }),

  CompletedSendRunSummary: model => ({ model }),

  FailedSendRunSummary: model => ({ model }),

  CompletedSendShareEvent: model => ({ model }),

  FailedSendShareEvent: model => ({ model }),

  ClickedResetTutorialButton: model => askToResetTutorial(model),

  ClickedConfirmResetTutorialButton: model =>
    answerTutorialReset(model, forgetTutorial, 'Done'),

  ClickedCancelResetTutorialButton: model =>
    answerTutorialReset(model, unchangedModel => unchangedModel, 'Idle'),

  CompletedFocusTutorialReset: model => ({ model }),

  UpdatedSyncedSave: (model, { save }) => takeSyncedSave(model, save),

  CompletedReloadSyncedSave: (model, { maybeSave }) =>
    Option.match(maybeSave, {
      onNone: () => ({ model }),
      onSome: save => takeSyncedSave(model, save),
    }),

  UpdatedSyncStatus: (model, { state }) => ({
    model: modifyFields(model, { syncState: () => state }),
  }),

  UpdatedPlayerScopeStatus: (model, { status }) => ({
    model: modifyFields(model, { playerScopeStatus: () => status }),
  }),

  SettledRecordedRun: (model, { runId, settled }) =>
    settleRun(model, runId, settled),

  FailedAwaitRunSettled: (model, { runId }) => forgetRunWait(model, runId),

  ClickedLinkDeviceButton: model => startLinking(model),

  SucceededRequestLinkCode: (model, { code }) =>
    playSounds([uiCue('Whoosh')])(
      modifyFields(model, { linkFlow: () => LinkFlow.Showing({ code }) }),
    ),

  FailedRequestLinkCode: (model, { problem }) => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Failed({ problem }),
    }),
  }),

  ClickedUseCodeButton: model => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Entering({ code: '' }),
    }),
  }),

  UpdatedLinkCode: (model, { value }) => typeLinkCode(model, value),

  SubmittedLinkCode: model => submitLinkCode(model),

  SucceededRedeemLinkCode: model =>
    playSounds([uiCue('PowerUp')])(
      modifyFields(model, { linkFlow: () => LinkFlow.Linked() }),
    ),

  FailedRedeemLinkCode: (model, { problem }) => ({
    model: modifyFields(model, {
      linkFlow: () => LinkFlow.Failed({ problem }),
    }),
  }),

  ClickedCancelLinkButton: model => ({
    model: modifyFields(model, { linkFlow: () => LinkFlow.Idle() }),
  }),

  ClickedPlayButton: model => Update.combineSteps(model, [playFromHome]),

  ClickedLobbyBackButton: model => Update.combineSteps(model, [backFromLobby]),

  ClickedLobbyStartButton: model =>
    Update.combineSteps(model, [startFromLobby]),

  ClickedLobbyHeroButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openLobbyHero]),

  ClickedLobbyAddBotButton: model => Update.combineSteps(model, [addLobbyBot]),

  ClickedLobbyDropBotButton: (model, { index }) =>
    Update.combineSteps(model, [dropLobbyBot(index)]),

  ClickedLobbyBotHeroButton: (model, { index }) =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openLobbyBotHero(index),
    ]),

  ClickedLobbyModeButton: (model, { mode }) =>
    Update.combineSteps(model, [pickLobbyMode(mode)]),

  ClickedLobbyDifficultyButton: (model, { difficulty }) =>
    Update.combineSteps(model, [pickLobbyDifficulty(difficulty)]),

  ClickedLobbyModifierButton: (model, { modifier }) =>
    Update.combineSteps(model, [pickLobbyModifier(modifier)]),

  FocusedLobbyControl: (model, { control }) => ({
    model: focusedLobbyControl(model, control),
  }),

  BlurredLobbyControl: model => ({ model: blurredLobbyControl(model) }),

  CompletedFocusLobbyControl: model => ({ model }),

  ClickedWhatsNewButton: model =>
    Update.combineSteps(model, [unlockAudio, closeHand, openWhatsNew]),

  ClickedOlderNewsButton: model => turnNews(model, 1),

  ClickedNewerNewsButton: model => turnNews(model, -1),

  ClickedMunchopediaButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      closeHand,
      openMunchopedia(MunchopediaPage.List()),
    ]),

  ClickedMunchopediaEntryButton: (model, { kind }) =>
    turnMunchopediaPage(model, MunchopediaPage.Entry({ kind })),

  ClickedMunchopediaListButton: model =>
    turnMunchopediaPage(model, MunchopediaPage.List()),

  ClickedMunchopediaShopButton: model =>
    turnMunchopediaPage(model, MunchopediaPage.Shop({ section: 'Guns' })),

  ClickedMunchopediaShopSectionButton: (model, { section }) =>
    turnMunchopediaPage(model, MunchopediaPage.Shop({ section })),

  ClickedNewEntryButton: (model, { kind }) =>
    Update.combineSteps(model, [
      unlockAudio,
      openMunchopedia(MunchopediaPage.Entry({ kind })),
    ]),

  ClickedTurnHint: model => ({ model: seeTurnHint(model) }),

  ClickedManorButton: model =>
    Update.combineSteps(model, [unlockAudio, tapSound, openHand]),

  SteppedHandFocus: (model, { card }) => stepHandFocus(model, card),

  CompletedFocusHandCard: model => ({ model }),

  ClickedCoopButton: model =>
    Update.combineSteps(model, [
      unlockAudio,
      tapSound,
      openCoop(Option.none()),
    ]),

  CompletedReadRoomLink: (model, { maybeCode }) =>
    Update.combineSteps(model, [
      makeStep(() =>
        Option.isSome(maybeCode) ? openCoop(maybeCode) : unchanged,
      ),
    ]),
})

// SETTLING

// NOTE: the after-message Steps (src/update/settle.ts) run once after every
// dispatch, a child's delivery and its OutMessage fold included, against
// the Model from before it. A synced save is already in the store, so its
// Messages settle without writing it back.
const SYNCED_SAVES = ['UpdatedSyncedSave', 'CompletedReloadSyncedSave'] as const

const settleWritten = makeUpdate.except(SYNCED_SAVES)(
  (model, _message, { before }) =>
    combine(model, afterMessage(before, 'Write')),
)

const settleSynced = makeUpdate.on(SYNCED_SAVES)(
  (model, _message, { before }) =>
    combine(model, afterMessage(before, 'Synced')),
)

export const update = makeUpdate.compose(handlers, settleWritten, settleSynced)
