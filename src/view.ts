import { Array, Option, Result, pipe } from 'effect'
import type { Document, Html } from 'foldkit/html'

import { CoopBinding } from './bindings'
import {
  ApplicationComposition,
  type ApplicationViewBuilder,
} from './composition'
import { GAME_TITLE } from './constants'
import { DIFFICULTIES } from './difficulty'
import { crewOf, isRunCardHeld, mvpOf } from './endBeat'
import { bestsFor, feedbackSentence } from './home'
import {
  homeMenuView,
  manorHandView,
  menuPanelView,
  newEntryNoticeView,
} from './homeView'
import { homeScreenGuideView } from './installView'
import { keyGrabToastView } from './keyGrab'
import { gameStageView } from './layers'
import { isPracticeGateHeld } from './lessons'
import {
  cornerButtonsView,
  debutCardView,
  debutPitch,
  modeChoiceView,
  toSentenceCase,
} from './menus'
import { Message, type PressedPointer } from './message'
import {
  DebutCard,
  type Model,
  Phase,
  type PointerDevice,
  RunMode,
  type RunStats,
} from './model'
import { ListenForTouchTaps, MeasureGameSurface } from './mount'
import { isOpenBreak } from './onboarding'
import { pauseHelpView } from './pauseHelp'
import { BOOST_KIND_ORDER, PICKUPS, isBoosted } from './powerups'
import { profileView } from './profileView'
import { ammoTagButtonView, purchaseAnnouncementView } from './purchaseHud'
import { questTrackerView } from './questView'
import { landscapeFrameOffset, screenOf } from './screen'
import { isShopOpenFor } from './shop'
import { shopDialogView } from './shopView'
import {
  accuracyPercent,
  defeatVerdict,
  runTimeLabel,
  totalKills,
  victoryVerdict,
} from './stats'
import { victorySupportView } from './supportView'
import {
  ghostSticksView,
  gunClusterView,
  preparationControlsView,
  stickView,
} from './touchControls'
import { TRAPS, TRAP_KIND_ORDER } from './traps'
import { isCoopOpen } from './update/coop'
import { updateGreetingView } from './updateGift'
import { FINAL_WAVE } from './wavePlans'
import { isRoundActive, roundWave } from './waves'
import {
  WEAPONS,
  hasEndlessRounds,
  heldTier,
  heldWeapon,
  isWieldingMelee,
  maxTier,
  maybeOtherGun,
  meleeNameOf,
  tierName,
} from './weapons'
import { ZOMBIE_KINDS, ZOMBIE_KIND_ORDER } from './zombies'

// STATUS

const statusWave = (model: Model, wave: number): string =>
  RunMode.match(model.mode, {
    Campaign: () => `wave ${wave} of ${FINAL_WAVE}`,
    Endless: () => `endless wave ${wave}`,
  })

const shopHint = (model: Model): string =>
  isShopOpenFor(model.phase)
    ? ' The shop stall in the bottom right corner is open. Walk up to it from any side to browse.'
    : ''

const PLAY_AGAIN =
  'Press Enter or choose Retry to play again, or E for an endless run. Press X or choose Share to post your run on X.'

const HOME_MENU =
  'Main menu. Press Enter or choose Play to start. Press E to switch between the campaign and endless, and X to pick the difficulty. Press V or choose Manor for your character, the Munchopedia, what is new, and how to play. Press O or choose the gear for settings. Arrow keys move between the buttons.'

const BACK_HOME = 'Press H or choose Menu to go back to the main menu.'

const KEEP_GOING = `Press K or choose Keep going to carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps.`

const killLabel = (stats: RunStats): string =>
  pipe(
    ZOMBIE_KIND_ORDER,
    Array.map(kind => `${stats.kills[kind]} ${ZOMBIE_KINDS[kind].name}`),
    Array.join(', '),
  )

const waveStatsLabel = (model: Model): string =>
  RunMode.match(model.mode, {
    Campaign: () =>
      `Waves cleared: ${model.stats.wavesCleared} of ${FINAL_WAVE}.`,
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
  model.difficulty.nightmare === 'JustUnlocked' ? ' Nightmare unlocked!' : ''

const recordNews = (model: Model): string =>
  Array.isReadonlyArrayEmpty(model.runRecords) ? '' : ' A new best!'

const crewLabel = (model: Model): string => {
  const crew = crewOf(model)
  return Array.isReadonlyArrayEmpty(crew)
    ? ''
    : ` ${Array.join(
        Array.map(
          crew,
          member =>
            `Player ${member.slot + 1}: ${member.kills} kills${Option.exists(mvpOf(crew), slot => slot === member.slot) ? ', MVP' : ''}.`,
        ),
        ' ',
      )}`
}

const statsLabel = (model: Model): string => {
  const { stats } = model
  return `Difficulty: ${DIFFICULTIES[model.difficulty.chosen].name}.${nightmareNews(model)} ${waveStatsLabel(model)}${recordNews(model)} Zombies splatted: ${totalKills(stats)} (${killLabel(stats)}). Best streak ${model.bestStreak}. Run time ${runTimeLabel(stats)}. Accuracy ${accuracyPercent(stats)} percent. Money earned $${model.wallet.earned}.${crewLabel(model)}`
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

const statusText = (model: Model): string => {
  return Phase.match(model.phase, {
    Ready: () => `${GAME_TITLE}, an early alpha. ${HOME_MENU}`,
    Preparation: ({ wave }) =>
      `Get ready for ${statusWave(model, wave)}. ${isOpenBreak(model) ? 'There is no timer this break. ' : ''}Press Enter, or use the Start wave button, to start it now.${practiceGateNote(model)}${shopHint(model)}`,
    Wave: ({ wave }) =>
      Option.getOrElse(
        debutCardStatus(model),
        () => `Fighting ${statusWave(model, wave)}.`,
      ),
    Paused: ({ round }) =>
      `Paused during ${statusWave(model, round.wave)}. Tap, click, or press Escape to resume. Press H or choose Menu to leave the run.`,
    Victory: () =>
      `Victory. ${victoryVerdict(model.stats)}. ${statsLabel(model)} ${KEEP_GOING} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
    GameOver: ({ wave }) =>
      `Game over. ${defeatVerdict(wave, model.stats)}. ${statsLabel(model)} ${PLAY_AGAIN} ${BACK_HOME}${feedbackSentence(model)}`,
  })
}

const gunLabel = (model: Model): string => {
  const { player } = model
  const held = isWieldingMelee(player)
    ? meleeNameOf(player)
    : tierName(heldWeapon(player.arsenal), heldTier(player))
  return Option.match(maybeOtherGun(player.arsenal), {
    onNone: () => `Holding the ${held}. Your second slot is empty.`,
    onSome: other =>
      `Holding the ${held}. Other slot: ${tierName(other.kind, other.tier)}, upgrade tier ${other.tier} of ${maxTier(other.kind)}${hasEndlessRounds(other.kind) ? '' : `, with ${other.rounds} ${WEAPONS[other.kind].roundsLabel}`}.`,
  })
}

const trapLabel = (model: Model): string => {
  const ready = Array.filterMap(TRAP_KIND_ORDER, kind =>
    model.trapStock[kind] > 0
      ? Result.succeed(`${model.trapStock[kind]} ${TRAPS[kind].name}`)
      : Result.failVoid,
  )
  return Array.isReadonlyArrayEmpty(ready)
    ? ''
    : ` Traps ready to place: ${Array.join(ready, ', ')}.`
}

const boostLabel = (model: Model): string => {
  const running = Array.filterMap(BOOST_KIND_ORDER, kind =>
    isBoosted(model.boosts, kind)
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
          `You have $${model.wallet.balance}. ${gunLabel(model)}${trapLabel(model)}${boostLabel(model)}`,
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

// VIEW

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
        isCoopOpen(model) ? h.empty : homeMenuView(model, h),
        preparationControlsView(model, h),
        gunClusterView(model, h),
        ammoTagButtonView(model, h),
        debutCardView(model, h),
        questTrackerView(model, h),
        modeChoiceView(model, h),
        victorySupportView(model, h),
        newEntryNoticeView(model, h),
        cornerButtonsView(model, h),
        keyGrabToastView(model, h),
        homeScreenGuideView(model, h),
        updateGreetingView(model, h),
        shopDialogView(model, h),
        manorHandView(model, h),
        menuPanelView(model, h),
        profileView(model, h),
        h.block(
          CoopBinding.embedView({
            slotId: 'coop',
            model: model.coop,
            viewInputs: {
              look: model.appearance,
              isKeyboard: model.lastDevice === 'KeyboardMouse',
              isRunCardUp: isRunCardHeld(model),
            },
          }),
        ),
      ],
    ),
  }
})
