import { Array, Option, Result, pipe } from 'effect'
import type { Document, Html } from 'foldkit/html'

import { joinName } from '../domain/playerName'
import { hasUnseenCalling, hasUnseenLook } from '../domain/unlocks'
import { awardsOf, crewOf } from '../features/end/crewAwards'
import { isRunCardHeld } from '../features/end/endBeat'
import { startingCallingOf } from '../features/heroes/callingPick'
import type { ViewInputs as LobbyViewInputs } from '../features/lobby/block'
import { pauseHelpView } from '../features/menus/pauseHelp'
import { isOpenBreak } from '../features/onboarding/onboarding'
import { questTrackerView } from '../features/onboarding/questView'
import type { ViewInputs as ProfileViewInputs } from '../features/profile/block'
import { tabOf } from '../features/profile/profile'
import { purchaseAnnouncementView } from '../features/shop/purchaseHud'
import { escapeSupportView } from '../features/support/supportView'
import type { PointerDevice } from '../input/inputSchema'
import { keyGrabToastView } from '../input/keyGrab'
import { isPortrait, landscapeFrameOffset, screenOf } from '../render/screen'
import {
  cornerButtonsView,
  debutCardView,
  debutPitch,
  modeChoiceView,
  toSentenceCase,
} from '../screens/game/menus'
import {
  ghostSticksView,
  gunClusterView,
  preparationControlsView,
  stickView,
} from '../screens/game/touchControls'
import { bestsFor, feedbackSentence, lobbyPicksOf } from '../screens/home/home'
import { homeMenuView, newEntryNoticeView } from '../screens/home/homeView'
import { GAME_TITLE } from '../shared/constants'
import { closeButtonView } from '../ui/cornerButtons'
import { isKeyboard } from '../ui/menuParts'
import { rankPlateView } from '../ui/rankBadgeView'
import { BOOST_KIND_ORDER, PICKUPS, isBoosted } from '../world/gear/powerups'
import { TRAPS, TRAP_KIND_ORDER } from '../world/gear/traps'
import {
  WEAPONS,
  heldTier,
  heldWeapon,
  isWieldingMelee,
  maxTier,
  maybeOtherGun,
  meleeNameOf,
  tierName,
} from '../world/gear/weapons'
import { bonesBalanceOf, rankOf, totalPointsOf } from '../world/heroes/rank'
import { heldKeys } from '../world/keys/keys'
import { CREW_AWARD_NAMES } from '../world/names'
import { focusOf } from '../world/party/party'
import { DIFFICULTIES } from '../world/run/difficulty'
import { isPracticeGateHeld } from '../world/run/lessons'
import {
  accuracyPercent,
  defeatVerdict,
  escapeVerdict,
  runTimeLabel,
  totalKills,
} from '../world/run/stats'
import { isRoundActive, roundWave } from '../world/waves/waves'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from '../world/zombies/zombies'
import {
  CoopBinding,
  LobbyBinding,
  ProfileBinding,
  ProfileDialogBinding,
} from './bindings'
import {
  type ApplicationAttribute,
  ApplicationComposition,
  type ApplicationViewBuilder,
} from './composition'
import { dialogShell } from './dialogs'
import { manorHandView, menuPanelView } from './dialogs'
import { homeScreenGuideView } from './dialogs'
import { updateGreetingView } from './dialogs'
import { gameStageView } from './layers'
import { isLobbyUp, isProfileOpen } from './menuState'
import { Message, type PressedPointer } from './message'
import { DebutCard, type Model, Phase, RunMode, type RunStats } from './model'
import { ListenForTouchTaps, MeasureGameSurface, ShareFromClick } from './mount'
import { isCoopOpen } from './update/coop'

// STATUS

const statusWave = (model: Model, wave: number): string =>
  RunMode.match(model.mode, {
    Campaign: () => `wave ${wave}`,
    Endless: () => `endless wave ${wave}`,
  })

// NOTE: the crew's keys, read out in a break, since the key ring on the
// HUD is a picture.
const keysHint = (model: Model): string =>
  ` Keys on the ring: ${heldKeys(model)}.`

const PLAY_AGAIN =
  'Press Enter or choose Retry to play again, or E for an endless run. Press X or choose Share to post your run on X.'

const HOME_MENU =
  'Main menu. Press Enter or choose Play. Press V or choose Manor for your character, the Munchopedia, what is new, and how to play. Press O or choose the gear for settings. Arrow keys move between the buttons.'

const LOBBY_MENU =
  'Lobby. Press Enter, or choose Start, to start your run. Press E to switch between the campaign and endless, X to pick the difficulty, and Y to pick your hero. Press Escape, or choose Back, to leave. Arrow keys move between the buttons.'

const BACK_HOME = 'Press H or choose Menu to go back to the main menu.'

const killLabel = (stats: RunStats): string =>
  pipe(
    ZOMBIE_KIND_ORDER,
    Array.map(kind => `${stats.kills[kind]} ${ZOMBIE_KINDS[kind].name}`),
    Array.join(', '),
  )

const waveStatsLabel = (model: Model): string =>
  RunMode.match(model.mode, {
    Campaign: () => `Waves cleared: ${model.stats.wavesCleared}.`,
    Endless: () =>
      `Wave reached: ${roundWave(model.phase)}. ${Option.match(
        bestsFor(model).maybeBestEndlessWave,
        {
          onNone: () => '',
          onSome: best => `Your best: wave ${best}.`,
        },
      )}`,
  })

const nightmareNews = (model: Model): string =>
  model.difficulty.nightmare === 'JustUnlocked'
    ? ` ${DIFFICULTIES.Nightmare.name} unlocked!`
    : ''

const recordNews = (model: Model): string =>
  Array.isReadonlyArrayEmpty(model.runRecords) ? '' : ' A new best!'

const crewLabel = (model: Model): string => {
  const crew = crewOf(model)
  return Array.isReadonlyArrayEmpty(crew)
    ? ''
    : ` ${Array.join(
        Array.map(crew, member => {
          const awards = Array.map(
            awardsOf(crew, member.slot),
            award => CREW_AWARD_NAMES[award],
          )
          return `${member.name}: ${member.kills} kills, ${member.revives} revives, ${member.downs} downs, ${member.aim} percent aim, ${member.keysFound} keys found${Array.isReadonlyArrayEmpty(awards) ? '' : `, ${Array.join(awards, ', ')}`}.`
        }),
        ' ',
      )}`
}

const statsLabel = (model: Model): string => {
  const { stats } = model
  return `Difficulty: ${DIFFICULTIES[model.difficulty.chosen].name}.${nightmareNews(model)} ${waveStatsLabel(model)}${recordNews(model)} Zombies splatted: ${totalKills(stats)} (${killLabel(stats)}). Best streak ${model.bestStreak}. Run time ${runTimeLabel(stats)}. Accuracy ${accuracyPercent(stats)} percent. Keys found ${model.keys.found}.${crewLabel(model)}`
}

const debutCardStatus = (model: Model): Option.Option<string> =>
  DebutCard.match(model.debutCard, {
    Hidden: () => Option.none(),
    Showing: ({ kind }) =>
      Option.some(
        `New zombie: ${ZOMBIE_KINDS[kind].name}. ${debutPitch(kind)} The wave starts in a moment. Once Continue shows, press Enter or choose it to start now.`,
      ),
  })

const practiceGateNote = (model: Model): string =>
  isPracticeGateHeld(model)
    ? ' The wave waits until you try moving, aiming, and firing.'
    : ''

const statusText = (model: Model): string =>
  Phase.match(model.phase, {
    Ready: () =>
      `${GAME_TITLE}, an early alpha. ${isLobbyUp(model) ? LOBBY_MENU : HOME_MENU}`,
    Arriving: () => 'Arriving at the manor. Press any key or tap to skip.',
    Preparation: ({ wave }) =>
      `Get ready for ${statusWave(model, wave)}. ${isOpenBreak(model) ? 'There is no timer this break. ' : ''}Press Enter, or use the Start wave button, to start it now.${practiceGateNote(model)}${keysHint(model)}`,
    Wave: ({ wave }) =>
      Option.getOrElse(
        debutCardStatus(model),
        () => `Fighting ${statusWave(model, wave)}.`,
      ),
    Paused: ({ round }) =>
      `Paused during ${statusWave(model, round.wave)}. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.`,
    Escaped: ({ wave }) =>
      `You escaped the manor on wave ${wave}. ${escapeVerdict(model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
    GameOver: ({ wave }) =>
      `Game over. ${defeatVerdict(wave, model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
  })

const gunLabel = (model: Model): string => {
  const { player } = focusOf(model)
  const held = isWieldingMelee(player)
    ? meleeNameOf(player)
    : tierName(heldWeapon(player.arsenal), heldTier(player))
  return Option.match(maybeOtherGun(player.arsenal), {
    onNone: () => `Holding the ${held}. Your second slot is empty.`,
    onSome: other =>
      `Holding the ${held}. Other slot: ${tierName(other.kind, other.tier)}, upgrade tier ${other.tier} of ${maxTier(other.kind)}, ${other.loaded} ${WEAPONS[other.kind].roundsLabel} loaded.`,
  })
}

const trapLabel = (model: Model): string => {
  const ready = Array.filterMap(TRAP_KIND_ORDER, kind =>
    focusOf(model).trapStock[kind] > 0
      ? Result.succeed(`${focusOf(model).trapStock[kind]} ${TRAPS[kind].name}`)
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(ready)
    ? ''
    : ` Traps ready to place: ${Array.join(ready, ', ')}.`
}

const boostLabel = (model: Model): string => {
  const running = Array.filterMap(BOOST_KIND_ORDER, kind =>
    isBoosted(focusOf(model).boosts, kind)
      ? Result.succeed(toSentenceCase(PICKUPS[kind].name))
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(running)
    ? ''
    : ` Power-ups running: ${Array.join(running, ', ')}.`
}

const loadoutView = (model: Model, h: ApplicationViewBuilder): Html =>
  isRoundActive(model.phase)
    ? h.p(
        [h.Class('sr-only')],
        [
          `Keys on the ring: ${heldKeys(model)}. ${gunLabel(model)}${trapLabel(model)}${boostLabel(model)}`,
        ],
      )
    : h.empty

// POINTER

const PRIMARY_MOUSE_BUTTON = 0

const toPointerDevice = (pointerType: string): PointerDevice =>
  pointerType === 'mouse' ? 'Mouse' : 'Touch'

const toPressedPointer = (
  pointerType: string,
  button: number,
  _screenX: number,
  _screenY: number,
  _timeStamp: number,
  clientX: number,
  clientY: number,
  pointerId: number,
): Option.Option<PressedPointer> => {
  const device = toPointerDevice(pointerType)
  if (device === 'Mouse' && button !== PRIMARY_MOUSE_BUTTON) {
    return Option.none()
  } else {
    return Option.some(
      Message.PressedPointer({ pointerId, device, clientX, clientY }),
    )
  }
}

// THE PROFILE

// NOTE: the root's fields the Profile's tabs show, and no more.
const profileInputs = (model: Model): ProfileViewInputs => ({
  look: {
    appearance: model.appearance,
    calling: startingCallingOf(model),
    screenMs: model.screenMs,
    bought: model.boughtCosmetics,
    rank: model.rank,
    fresh: model.freshUnlocks,
  },
  isLookNew: hasUnseenLook(
    rankOf(totalPointsOf(model.rank)),
    model.seenUnlocks,
  ),
  isPortrait: isPortrait(model),
  device: model.lastDevice,
  sync: {
    state: model.syncState,
    scope: model.playerScopeStatus,
    lastRun: model.lastRunSync,
  },
  settings: {
    sound: model.soundSetting,
    music: model.musicSetting,
    shake: model.shakeSetting,
    cursor: model.cursorSetting,
    fullscreen: model.fullscreen,
    rotation: model.rotationSetting,
    shareStats: model.shareStats,
    screenFit: model.screenFit,
    orientationLock: model.orientationLock,
  },
})

// NOTE: the Profile's Dialog is the root's (menuState reads it); the Profile
// Block draws the tabs and pages inside it, and the root the rank plate.
const profileDialogView = (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.profileDialog,
      dialogClass: 'profile-dialog',
      backdropClass: 'profile-backdrop',
      panelClass: 'profile',
      dialogAttributes: [
        h.DataAttribute('tab', tabOf(model.profile)),
        h.DataAttribute('device', model.lastDevice),
      ],
      panelView: ({ title, description, closeButton }) => [
        h.h2([...title, h.Class('sr-only')], ['Profile']),
        h.p(
          [...description, h.Class('sr-only')],
          ['Your look, your name, your devices, and the settings.'],
        ),
        closeButtonView(
          {
            attributes: closeButton,
            className: 'panel-close',
            label: 'Close',
          },
          h,
        ),
        h.block(
          ProfileBinding.embedView({
            slotId: 'profile-panel',
            model: model.profile,
            viewInputs: profileInputs(model),
          }),
        ),
        rankPlateView(model, h),
      ],
      binding: ProfileDialogBinding,
    },
    h,
  )

// THE LOBBY

// NOTE: the root's fields the lobby shows: the player's seat, and what the
// hero picker's cards read.
const lobbyInputs = (model: Model): LobbyViewInputs => {
  const rank = rankOf(totalPointsOf(model.rank))
  return {
    picks: lobbyPicksOf(model),
    name: joinName(model),
    look: model.appearance,
    rank,
    calling: startingCallingOf(model),
    isHeroNew: hasUnseenCalling(rank, model.seenUnlocks),
    bought: model.boughtCosmetics,
    bones: bonesBalanceOf(model.rank),
    fresh: model.freshUnlocks,
    isKeyboard: isKeyboard(model),
  }
}

// NOTE: the lobby is drawn only while it is up, so a closed one costs the
// frame nothing.
const lobbyView = (model: Model, h: ApplicationViewBuilder): Html =>
  isLobbyUp(model)
    ? h.block(
        LobbyBinding.embedView({
          slotId: 'lobby',
          model: model.lobby,
          viewInputs: lobbyInputs(model),
        }),
      )
    : h.empty

// VIEW

// NOTE: SHARE's Mount, made only when the end card draws SHARE.
const shareMountOf = (h: ApplicationViewBuilder): ApplicationAttribute =>
  h.OnMount(ShareFromClick())

// NOTE: Foldkit knows a view by the very function makeView returns (its view
// inputs are registered against it), so a dual wrapper would be a view it
// does not know; the Block and the Scene tests need this one.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const view = ApplicationComposition.makeView((model, h): Document => {
  const screen = screenOf(model)
  return {
    title: GAME_TITLE,
    body: h.main(
      [
        h.Class('game-root'),
        h.OnMount(ListenForTouchTaps()),
        h.DataAttribute('layout', screen.layout),
        h.DataAttribute('cursor', model.cursorSetting),
        h.Style({
          '--screen-w': `${screen.width}`,
          '--screen-h': `${screen.height}`,
          '--world-top': `${screen.world.y}`,
          '--frame-top': `${landscapeFrameOffset(screen).y}`,
        }),
      ],
      [
        h.h1([h.Class('sr-only')], [GAME_TITLE]),
        h.p([h.Class('sr-only'), h.Role('status')], [statusText(model)]),
        purchaseAnnouncementView(model, h),
        h.div(
          [
            h.Class('game-surface'),
            h.Role('application'),
            h.AriaLabel('Game surface'),
            h.Tabindex(-1),
            h.OnMount(MeasureGameSurface()),
            h.OnPointerDown(toPressedPointer),
            h.OnContextMenu(Message.SuppressedContextMenu()),
          ],
          [
            gameStageView(model, h),
            ghostSticksView(model, h),
            stickView(model.input.moveStick, 'move', h),
            stickView(model.input.aimStick, 'aim', h),
          ],
        ),
        loadoutView(model, h),
        pauseHelpView(model, h.OnPointerDown(toPressedPointer), h),
        isCoopOpen(model) || isLobbyUp(model)
          ? h.empty
          : homeMenuView(model, h),
        preparationControlsView(model, h),
        gunClusterView(model, h),
        debutCardView(model, h),
        questTrackerView(model, h),
        modeChoiceView(model, shareMountOf, h),
        escapeSupportView(model, h),
        newEntryNoticeView(model, h),
        isProfileOpen(model) ? h.empty : cornerButtonsView(model, h),
        keyGrabToastView(model, h),
        homeScreenGuideView(model, h),
        updateGreetingView(model, h),
        manorHandView(model, h),
        menuPanelView(model, h),
        profileDialogView(model, h),
        lobbyView(model, h),
        h.block(
          CoopBinding.embedView({
            slotId: 'coop',
            model: model.coop,
            viewInputs: {
              look: model.appearance,
              isKeyboard: model.lastDevice === 'KeyboardMouse',
              isRunCardUp: isRunCardHeld(model),
              bought: model.boughtCosmetics,
              bones: bonesBalanceOf(model.rank),
            },
          }),
        ),
      ],
    ),
  }
})
