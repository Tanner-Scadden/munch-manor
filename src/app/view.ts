import { Array, Option, Result, pipe } from 'effect'

import {
  isPocketCardOpened,
  isPocketCardReading,
} from '../features/dare/pocketCard'
import { awardsOf, crewOf } from '../features/end/crewAwards'
import { pauseHelpView } from '../features/menus/pauseHelp'
import { caseCardView } from '../features/onboarding/caseCardView'
import { isOpenBreak } from '../features/onboarding/onboarding'
import { questTrackerView } from '../features/onboarding/questView'
import { purchaseAnnouncementView } from '../features/shop/purchaseHud'
import { escapeSupportView } from '../features/support/supportView'
import { keyGrabToastView } from '../input/keyGrab'
import {
  landscapeFrameOffset,
  screenOf,
  stagePlacement,
} from '../render/screen'
import { dareListButtonView } from '../screens/game/dareListButton'
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
import { bestsFor, feedbackSentence } from '../screens/home/home'
import { homeMenuView, newEntryNoticeView } from '../screens/home/homeView'
import { GAME_TITLE } from '../shared/constants'
import { dareCardOf, dareItemsFoundOf } from '../world/dare/dare'
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
import { heldKeys } from '../world/keys/keys'
import { CREW_AWARD_NAMES, DARE_LINES, DARE_NAMES } from '../world/names'
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
import { coopView } from './coopView'
import type { ApplicationHtml, ApplicationViewBuilder } from './definition'
import {
  homeScreenGuideView,
  manorHandView,
  menuPanelView,
  updateGreetingView,
} from './dialogs'
import { gameStageView } from './layers'
import { lobbyView } from './lobbyView'
import { isLobbyUp, isProfileOpen } from './menuState'
import { Message } from './message'
import { DebutCard, type Model, Phase, RunMode, type RunStats } from './model'
import {
  ListenForTouchTaps,
  PressGameSurface,
  ShareFromClick,
  WatchGameSurface,
} from './mount'
import { profileDialogView } from './profileView'
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

// NOTE: the dare card in your pocket, open after the slam
// (src/features/dare/pocketCardView.ts).
const POCKET_CARD_STATUS =
  "Your friends' dare card: find the things they drew, then get out the front door. Press any key or tap to put it away."

// NOTE: the dare card opened again from the HUD, with its satchel: the
// things found, each with its line, and the ones still to find.
const openedCardStatus = (model: Model): string => {
  const card = dareCardOf(model)
  const found = Array.filter(card, ({ isFound }) => isFound)
  const missing = Array.filter(card, ({ isFound }) => !isFound)
  const foundText = Array.isReadonlyArrayEmpty(found)
    ? 'Your satchel is empty.'
    : `In your satchel: ${Array.join(
        Array.map(
          found,
          ({ kind }) => `the ${DARE_NAMES[kind]}, ${DARE_LINES[kind]}`,
        ),
        ' ',
      )}`
  const missingText = Array.isReadonlyArrayEmpty(missing)
    ? 'Now get out the front door.'
    : `Still to find: ${Array.join(
        Array.map(missing, ({ kind }) => `the ${DARE_NAMES[kind]}`),
        ', ',
      )}.`
  return `Your dare card. ${foundText} ${missingText} Press any key or tap to put it away.`
}

const statusText = (model: Model): string =>
  isPocketCardOpened(model) ? openedCardStatus(model) : roundStatusText(model)

const roundStatusText = (model: Model): string =>
  Phase.match(model.phase, {
    Ready: () =>
      `${GAME_TITLE}, an early alpha. ${isLobbyUp(model) ? LOBBY_MENU : HOME_MENU}`,
    Arriving: () => 'Arriving at the manor. Press any key or tap to skip.',
    Preparation: ({ wave }) =>
      isPocketCardReading(model)
        ? POCKET_CARD_STATUS
        : `Get ready for ${statusWave(model, wave)}. ${isOpenBreak(model) ? 'There is no timer this break. ' : ''}Press Enter, or use the Start wave button, to start it now.${practiceGateNote(model)}${keysHint(model)}`,
    Wave: ({ wave }) =>
      Option.getOrElse(
        debutCardStatus(model),
        () => `Fighting ${statusWave(model, wave)}.`,
      ),
    Paused: ({ round }) =>
      `Paused during ${statusWave(model, round.wave)}. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.`,
    Escaped: ({ wave }) =>
      `You escaped the manor on wave ${wave}. ${escapeVerdict(model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
    LeftEarly: ({ wave }) =>
      `You chickened out the back door on wave ${wave}, with ${dareItemsFoundOf(model)} of the dare found. ${statsLabel(model)} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
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

const loadoutView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isRoundActive(model.phase)
    ? h.p
        .class('sr-only')
        .children(
          `Keys on the ring: ${heldKeys(model)}. ${gunLabel(model)}${trapLabel(model)}${boostLabel(model)}`,
        )
    : null

// NOTE: the home menu stays in sight, dimmed, around the dare card, since
// the card unfolds out of its PLAY (src/features/lobby/lobby.css), but it is
// inert while the card is up: no tap, Tab, or screen reader reaches it. The
// wrapper takes no room and is always there, so the menu is never drawn
// afresh (its deal-in art would play again) when the card opens or closes.
const homeUnderLobbyView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isHidden = isLobbyUp(model)
  return h.div
    .class('home-under-lobby')
    .attr('inert', isHidden ? '' : undefined)
    .attr('aria-hidden', isHidden ? 'true' : undefined)
    .children(homeMenuView(model, h))
}

// VIEW

const rootStyle = (model: Model): Record<string, string> => {
  const screen = screenOf(model)
  return {
    '--screen-w': `${screen.width}`,
    '--screen-h': `${screen.height}`,
    '--world-top': `${screen.world.y}`,
    '--frame-top': `${landscapeFrameOffset(screen).y}`,
    ...Option.match(model.maybeSurface, {
      onNone: () => ({}),
      onSome: surface => ({
        '--pixel': `${stagePlacement(surface, screen).scale}px`,
        // NOTE: one device pixel, for pixel art in HTML drawn at whole
        // device pixels (src/art/artSize.ts).
        ...(surface.pixelRatio !== undefined && surface.pixelRatio > 0
          ? { '--dpx': `${1 / surface.pixelRatio}px` }
          : {}),
      }),
    }),
  }
}

// NOTE: the game surface: the world, its overlay, and the sticks. Its Mount
// measures it and sends each finger's press by its own pointer id.
const gameSurfaceView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .class('game-surface')
    .attr('role', 'application')
    .attr('aria-label', 'Game surface')
    .attr('tabindex', '-1')
    .onMount(WatchGameSurface())
    .on('contextmenu', Message.SuppressedContextMenu())
    .children(
      gameStageView(model, h),
      ghostSticksView(model, h),
      stickView(model.input.moveStick, 'move', h),
      stickView(model.input.aimStick, 'aim', h),
    )

// NOTE: the root's view (Effect UI's `view: (h, model)`), a signature the
// component fixes, so it has no data-last form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const view = (
  h: ApplicationViewBuilder,
  model: Model,
): ApplicationHtml =>
  h.main
    .class('game-root')
    .onMount(ListenForTouchTaps())
    .attr('data-layout', screenOf(model).layout)
    .attr('data-cursor', model.settings.cursorSetting)
    .attr('data-device', model.lastDevice)
    .style(rootStyle(model))
    .children(
      h.h1.class('sr-only').children(GAME_TITLE),
      h.p.class('sr-only').attr('role', 'status').children(statusText(model)),
      purchaseAnnouncementView(model, h),
      gameSurfaceView(model, h),
      loadoutView(model, h),
      pauseHelpView(model, PressGameSurface(), h),
      isCoopOpen(model) ? null : homeUnderLobbyView(model, h),
      preparationControlsView(model, h),
      gunClusterView(model, h),
      dareListButtonView(model, h),
      debutCardView(model, h),
      caseCardView(model, h),
      questTrackerView(model, h),
      modeChoiceView(model, ShareFromClick(), h),
      escapeSupportView(model, h),
      newEntryNoticeView(model, h),
      isProfileOpen(model) ? null : cornerButtonsView(model, h),
      keyGrabToastView(model, h),
      homeScreenGuideView(model, h),
      updateGreetingView(model, h),
      manorHandView(model, h),
      menuPanelView(model, h),
      profileDialogView(model, h),
      lobbyView(model, h),
      coopView(model, h),
    )
