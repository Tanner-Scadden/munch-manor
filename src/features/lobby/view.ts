import { Array, Function, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { PROP_ICONS } from '#art/callingArt.ts'
import {
  CHICKEN_ICON,
  SHAKE_ICON,
  TIN_BOT_ICON,
  portraitOf,
} from '#art/coopIcons.ts'
import {
  CAMPAIGN_ICON,
  CLOSE_ICON,
  ENDLESS_ICON,
  MANOR_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
} from '#art/icons.ts'
import {
  type Special,
  specialsNoteOf,
  specialsOf,
} from '#domain/callingSpecials.ts'
import type { Bot, HomeMode } from '#domain/clientSchema.ts'
import { HeroPicker } from '#features/heroes/block.ts'
import type { MapId } from '#shared/nameKeys.ts'
import type { Difficulty } from '#shared/playerData.ts'
import { dareMarkFaceView, dareMarkLabel } from '#ui/dareMarkView.ts'
import { type DialogParts, dialogShellView } from '#ui/dialog.ts'
import { easyBreakFaceView, easyBreakLabel } from '#ui/easyBreakView.ts'
import {
  callingPropView,
  iconView,
  newPipView,
  rankTagView,
  skullFaceViews,
} from '#ui/menuParts.ts'
import {
  bonusChipView,
  modifierFaceView,
  modifierLabel,
} from '#ui/modifiersView.ts'
import { CALLING_NAMES, MAP_NAMES, MODE_NAMES } from '#world/names.ts'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  isLocked,
} from '#world/run/difficulty.ts'
import { MODIFIER_ORDER, type Modifier } from '#world/run/modifiers.ts'

import {
  HERO_DIALOG_ID,
  LOBBY_KEYS,
  MAPS,
  MODE_CONTROLS,
  SEATS,
  isEasyBreakShown,
  isLockedByDare,
  isMarkShown,
  isModifierLocked,
  isModifierPickable,
  isModifierShownOn,
  lobbyControlId,
  picksBonusPercentOf,
} from './lobby.ts'
import { Message } from './message.ts'
import {
  type LobbyControl,
  type LobbyPicks,
  type LobbyProps,
  isLobbyShown,
} from './model.ts'

type LobbyH = Html.H<Message>
type Content = View.Content<Message>

const CREW_SEATS = 3

const capView = (props: LobbyProps, cap: string, h: LobbyH): Content | null =>
  props.isKeyboard
    ? h.span.class('home-key').attr('aria-hidden', 'true').children(cap)
    : null

const controlButton = (control: LobbyControl, h: LobbyH) =>
  h.button
    .id(lobbyControlId(control))
    .attr('type', 'button')
    .on('focus', Message.FocusedControl({ control }))
    .on('blur', Message.BlurredControl())

const scrawlView = (
  words: string,
  placement: 'Corner' | 'Inline',
  h: LobbyH,
): Content =>
  h.span
    .class('dare-scrawl')
    .attrs({ 'data-place': placement, 'aria-hidden': 'true' })
    .children(words)

const lobbyBackView = (props: LobbyProps, h: LobbyH): Content =>
  controlButton('Back', h)
    .class('coop-back lobby-chicken')
    .attrs({
      'aria-label': 'Chicken out',
      'aria-keyshortcuts': LOBBY_KEYS.Back.name,
    })
    .on('click', Message.ClickedBackButton())
    .children(
      iconView('lobby-chicken-icon', CHICKEN_ICON, h),
      h.span
        .class('lobby-chicken-label')
        .attr('aria-hidden', 'true')
        .children('CHICKEN OUT'),
      capView(props, LOBBY_KEYS.Back.cap, h),
    )

const specialChipView = (special: Special, h: LobbyH): Content =>
  h.span
    .class('lobby-special')
    .attr('data-sign', special.isPerk ? 'Perk' : 'Drawback')
    .children(
      iconView('lobby-special-icon', special.art, h),
      h.span
        .class('lobby-special-sign')
        .attr('aria-hidden', 'true')
        .children(special.isPerk ? '+' : '-'),
    )

const heroFaceViews = (calling: Bot['calling'], h: LobbyH) => [
  iconView('lobby-hero-prop', PROP_ICONS[calling], h),
  h.span
    .class('lobby-hero-body')
    .attr('aria-hidden', 'true')
    .children(
      h.span.class('lobby-hero-name').children(CALLING_NAMES[calling]),
      h.span
        .class('lobby-specials')
        .children(
          Array.map(specialsOf(calling), special =>
            specialChipView(special, h),
          ),
        ),
    ),
]

const heroCardView = (props: LobbyProps, h: LobbyH): Content => {
  const calling = props.calling
  const isNew = props.isHeroNew
  return controlButton('Hero', h)
    .class('lobby-hero')
    .attrs({
      'data-calling': calling,
      'aria-label': `Hero: ${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}. Change it${isNew ? '. Something new' : ''}`,
      'aria-haspopup': 'dialog',
      'aria-keyshortcuts': LOBBY_KEYS.Hero.name,
    })
    .on('click', Message.ClickedHeroButton())
    .children(
      heroFaceViews(calling, h),
      capView(props, LOBBY_KEYS.Hero.cap, h),
      isNew && newPipView(h),
    )
}

const mySeatView = (props: LobbyProps, h: LobbyH): Content => {
  const rank = props.rank
  const calling = props.calling
  return h.li
    .class('coop-seat lobby-seat')
    .attrs({
      'data-state': 'Here',
      'data-me': 'Me',
      'aria-label': `${props.name}, you, rank ${rank}`,
    })
    .children(
      scrawlView('GOING IN', 'Corner', h),
      iconView(
        'coop-portrait coop-seat-head',
        portraitOf(props.look, calling),
        h,
      ),
      h.div
        .class('lobby-seat-info')
        .children(
          h.div
            .class('coop-nameline')
            .children(
              rankTagView('coop-rank', rank, 2, h),
              callingPropView('coop-calling', calling, h),
              h.span
                .class('coop-nameplate')
                .attr('aria-hidden', 'true')
                .children(props.name),
            ),
          scrawlView('COMING AS', 'Inline', h),
          heroCardView(props, h),
        ),
    )
}

const seatControlsAt = (index: number): readonly [LobbyControl, LobbyControl] =>
  Option.getOrElse(
    Array.get(SEATS, index),
    (): readonly [LobbyControl, LobbyControl] => ['Bot1', 'Drop1'],
  )

const dragAlongView = (seat: number, h: LobbyH): Content | null =>
  seat === 0 ? scrawlView('DRAG ALONG', 'Corner', h) : null

const addBotTileView = (
  props: LobbyProps,
  seat: number,
  isFirst: boolean,
  h: LobbyH,
): Content => {
  const [control] = seatControlsAt(seat)
  return h.li
    .key(`seat-${seat}`)
    .class('coop-seat lobby-seat-empty')
    .attr('data-state', 'Empty')
    .children(
      dragAlongView(seat, h),
      controlButton(control, h)
        .class('lobby-add-bot')
        .attrs({
          'aria-label': 'Add a bot teammate',
          'aria-keyshortcuts': LOBBY_KEYS.Bot.name,
        })
        .on('click', Message.ClickedAddBotButton())
        .children(
          iconView('lobby-add-bot-icon', TIN_BOT_ICON, h),
          h.span
            .class('lobby-add-bot-label')
            .attr('aria-hidden', 'true')
            .children(
              h.span.class('lobby-add-bot-plus').children('+'),
              h.span.children('BOT'),
            ),
          isFirst && capView(props, LOBBY_KEYS.Bot.cap, h),
        ),
    )
}

const closedSeatView = (seat: number, h: LobbyH): Content =>
  h.li
    .key(`seat-${seat}`)
    .class('coop-seat lobby-seat-empty')
    .attrs({ 'data-state': 'Empty', 'aria-hidden': 'true' })
    .children(dragAlongView(seat, h))

const botHeroView = (bot: Bot, index: number, h: LobbyH): Content => {
  const [control] = seatControlsAt(index)
  return controlButton(control, h)
    .class('lobby-hero lobby-hero-bot')
    .attrs({
      'data-calling': bot.calling,
      'aria-label': `${bot.name}'s hero: ${CALLING_NAMES[bot.calling]}. ${specialsNoteOf(bot.calling)}. Change it`,
      'aria-haspopup': 'dialog',
    })
    .on('click', Message.ClickedBotHeroButton({ index }))
    .children(heroFaceViews(bot.calling, h))
}

const dropBotView = (bot: Bot, index: number, h: LobbyH): Content => {
  const [, control] = seatControlsAt(index)
  return controlButton(control, h)
    .class('lobby-drop-bot')
    .attr('aria-label', `Remove ${bot.name}`)
    .on('click', Message.ClickedDropBotButton({ index }))
    .children(iconView('lobby-drop-bot-icon', CLOSE_ICON, h))
}

const botSeatView = (bot: Bot, index: number, h: LobbyH): Content =>
  h.li
    .key(`seat-${index}`)
    .class('coop-seat lobby-seat-bot')
    .attrs({
      'data-state': 'Here',
      'data-bot': 'Bot',
      'aria-label': `${bot.name}, bot teammate, ${CALLING_NAMES[bot.calling]}`,
    })
    .children(
      dragAlongView(index, h),
      iconView(
        'coop-portrait coop-seat-head',
        portraitOf(bot.look, bot.calling),
        h,
      ),
      h.div
        .class('coop-nameline lobby-bot-nameline')
        .children(
          iconView('lobby-bot-mark', TIN_BOT_ICON, h),
          h.span
            .class('coop-nameplate')
            .attr('aria-hidden', 'true')
            .children(bot.name),
        ),
      botHeroView(bot, index, h),
      dropBotView(bot, index, h),
    )

const seatsView = (props: LobbyProps, h: LobbyH): Content => {
  const bots = props.picks.bots
  const emptyCount = Math.max(0, CREW_SEATS - bots.length)
  const canAdd = bots.length < props.picks.botSeats
  return h.ol
    .class('coop-seats lobby-seats')
    .attr('aria-label', 'Players')
    .children(
      mySeatView(props, h),
      Array.map(bots, (bot, index) => botSeatView(bot, index, h)),
      Array.makeBy(emptyCount, offset =>
        canAdd
          ? addBotTileView(props, bots.length + offset, offset === 0, h)
          : closedSeatView(bots.length + offset, h),
      ),
    )
}

const MODE_PICK_ICONS: Readonly<Record<HomeMode, string>> = {
  Campaign: CAMPAIGN_ICON,
  Endless: ENDLESS_ICON,
}

const MODES: ReadonlyArray<HomeMode> = ['Campaign', 'Endless']

const modePickView = (
  picks: LobbyPicks,
  mode: HomeMode,
  h: LobbyH,
): Content => {
  const isChosen = picks.mode === mode
  return controlButton(MODE_CONTROLS[mode], h)
    .class('coop-pick coop-mode-pick')
    .attrs({
      'data-mode': mode,
      'data-state': isChosen ? 'Chosen' : 'Other',
      'aria-pressed': isChosen ? 'true' : 'false',
      'aria-label': MODE_NAMES[mode],
    })
    .on('click', Message.ClickedModeButton({ mode }))
    .children(iconView('coop-pick-icon', MODE_PICK_ICONS[mode], h))
}

const skullIndexOf = (difficulty: Difficulty): number =>
  Option.getOrElse(
    Array.findFirstIndex(DIFFICULTY_ORDER, level => level === difficulty),
    () => 0,
  )

const skullPickView = (
  picks: LobbyPicks,
  difficulty: Difficulty,
  h: LobbyH,
): Content => {
  const setting = picks.difficulty
  const chosen = setting.chosen
  const isLit = skullIndexOf(difficulty) <= skullIndexOf(chosen)
  const isLockedOut = isLocked(setting, difficulty)
  const isFresh =
    difficulty === 'Nightmare' && setting.nightmare === 'JustUnlocked'
  return controlButton(difficulty, h)
    .class('coop-pick coop-skull-pick')
    .attrs({
      'data-difficulty': difficulty,
      'data-state': chosen === difficulty ? 'Chosen' : isLit ? 'Lit' : 'Other',
      'aria-pressed': chosen === difficulty ? 'true' : 'false',
      'aria-label': isLockedOut
        ? `${DIFFICULTIES[difficulty].name}, locked. ${NIGHTMARE_LOCK_NOTE}`
        : `${DIFFICULTIES[difficulty].name}: ${DIFFICULTIES[difficulty].blurb}`,
    })
    .attr('aria-disabled', isLockedOut ? 'true' : undefined)
    .on('click', Message.ClickedDifficultyButton({ difficulty }))
    .children(
      skullFaceViews(
        {
          className: 'coop-pick-icon',
          icon: isLit ? SKULL_ICONS[chosen] : SKULL_OFF_ICON,
          isLocked: isLockedOut,
        },
        h,
      ),
      isFresh && newPipView(h),
    )
}

const modifierPickView = (
  picks: LobbyPicks,
  modifier: Modifier,
  h: LobbyH,
): Content => {
  const isOn = isModifierShownOn(picks, modifier)
  const isLockedOn = isModifierLocked(picks, modifier)
  const isPickable = isModifierPickable(picks, modifier)
  return controlButton(modifier, h)
    .class('coop-pick modifier-pick')
    .attrs({
      'data-modifier': modifier,
      'data-state': isOn ? 'On' : 'Off',
      'data-available': isPickable ? 'Yes' : 'No',
      'data-locked': isLockedOn ? 'Yes' : 'No',
      'aria-pressed': isOn ? 'true' : 'false',
      'aria-label': isLockedOn
        ? `${modifierLabel(modifier, isOn)}. Held by the dare mark`
        : isPickable
          ? modifierLabel(modifier, isOn)
          : `${modifierLabel(modifier, isOn)}. Add a bot teammate first`,
    })
    .attr('aria-disabled', isPickable ? undefined : 'true')
    .on('click', Message.ClickedModifierButton({ modifier }))
    .children(modifierFaceView(modifier, h))
}

const easyBreakPickView = (picks: LobbyPicks, h: LobbyH): Content =>
  controlButton('EasyBreak', h)
    .class('coop-pick easy-break-pick')
    .attrs({
      'data-state': picks.easyBreakSeconds > 0 ? 'On' : 'Off',
      'aria-label': easyBreakLabel(picks.easyBreakSeconds),
    })
    .on('click', Message.ClickedEasyBreakButton())
    .children(easyBreakFaceView(picks.easyBreakSeconds, h))

const markPickView = (picks: LobbyPicks, h: LobbyH): Content =>
  controlButton('Mark', h)
    .class('coop-pick dare-mark-pick')
    .attrs({
      'data-state': picks.dareMark > 0 ? 'On' : 'Off',
      'data-mark': `${picks.dareMark}`,
      'aria-label': dareMarkLabel(picks.dareMark),
    })
    .on('click', Message.ClickedMarkButton())
    .children(dareMarkFaceView(picks.dareMark, h))

const MAP_ICONS: Readonly<Record<MapId, string>> = {
  Manor: MANOR_ICON,
}

const mapCardView = (map: MapId, h: LobbyH): Content =>
  h.div
    .class('lobby-map')
    .attrs({
      'data-map': map,
      'data-state': 'Chosen',
      role: 'img',
      'aria-label': `Map: ${MAP_NAMES[map]}`,
    })
    .children(
      iconView('lobby-map-icon', MAP_ICONS[map], h),
      h.span
        .class('lobby-map-name')
        .attr('aria-hidden', 'true')
        .children(MAP_NAMES[map]),
    )

const heldStampView = (props: LobbyProps, h: LobbyH): Content | null =>
  isLockedByDare(props.picks)
    ? h.span
        .class('lobby-held-stamp')
        .attr('role', 'note')
        .children("PAL'S DARE")
    : null

const picksView = (props: LobbyProps, h: LobbyH): Content => {
  const picks = props.picks
  const isHeld = isLockedByDare(picks)
  return h.div
    .class('coop-picks lobby-picks')
    .attrs({ 'data-host': 'Picking', 'data-held': isHeld ? 'Yes' : 'No' })
    .attr('inert', isHeld ? '' : undefined)
    .attr('aria-label', isHeld ? "Picks held to your friend's dare" : undefined)
    .children(
      h.div
        .class('coop-pick-group')
        .attrs({ role: 'group', 'aria-label': 'Mode' })
        .children(
          scrawlView('OUT OR STAY', 'Corner', h),
          Array.map(MODES, mode => modePickView(picks, mode, h)),
          capView(props, LOBBY_KEYS.Mode.cap, h),
        ),
      h.div
        .class('coop-pick-group coop-skulls')
        .attrs({ role: 'group', 'aria-label': 'Difficulty' })
        .children(
          scrawlView('STAKES', 'Corner', h),
          Array.map(DIFFICULTY_ORDER, difficulty =>
            skullPickView(picks, difficulty, h),
          ),
          capView(props, LOBBY_KEYS.Difficulty.cap, h),
          isMarkShown(picks) && markPickView(picks, h),
          isEasyBreakShown(picks) && easyBreakPickView(picks, h),
        ),
      h.div
        .class('coop-pick-group modifier-group')
        .attrs({ role: 'group', 'aria-label': 'Modifiers' })
        .children(
          scrawlView('EXTRA DARES', 'Corner', h),
          Array.map(MODIFIER_ORDER, modifier =>
            modifierPickView(picks, modifier, h),
          ),
          bonusChipView(picksBonusPercentOf(picks), h),
        ),
      h.div
        .class('coop-pick-group lobby-maps')
        .attrs({ role: 'group', 'aria-label': 'Map' })
        .children(
          scrawlView('WHICH HOUSE', 'Corner', h),
          Array.map(MAPS, map => mapCardView(map, h)),
        ),
    )
}

const startButtonView = (props: LobbyProps, h: LobbyH): Content =>
  controlButton('Start', h)
    .class('coop-ready lobby-start')
    .attrs({
      'data-ready': 'NotReady',
      'aria-label': 'Shake on it',
      'aria-keyshortcuts': LOBBY_KEYS.Start.name,
    })
    .on('click', Message.ClickedStartButton())
    .children(
      h.span
        .class('coop-ready-face')
        .children(
          iconView('coop-ready-icon', SHAKE_ICON, h),
          h.span.class('coop-ready-label').children('SHAKE ON IT'),
        ),
      capView(props, LOBBY_KEYS.Start.cap, h),
    )

const maybePickingBotOf = (props: LobbyProps): Option.Option<Bot> =>
  Option.flatMap(props.lobby.maybePickingBot, index =>
    Array.get(props.picks.bots, index),
  )

const heroPanelViews = (props: LobbyProps, parts: DialogParts, h: LobbyH) => {
  const maybeBot = maybePickingBotOf(props)
  return [
    parts.title(h.h2).class('panel-title').children('Hero'),
    parts
      .description(h.p)
      .class('panel-blurb sr-only')
      .children(
        Option.match(maybeBot, {
          onNone: () => 'Pick who you play.',
          onSome: bot => `Pick for ${bot.name}.`,
        }),
      ),
    HeroPicker(h, {
      key: 'lobby-hero-picker',
      props: {
        look: Option.match(maybeBot, {
          onNone: () => props.look,
          onSome: bot => bot.look,
        }),
        chosen: Option.match(maybeBot, {
          onNone: () => props.calling,
          onSome: bot => bot.calling,
        }),
        trying: Option.getOrNull(props.lobby.maybeTrying),
        rank: props.rank,
        bought: props.bought,
        bones: props.bones,
        fresh: props.fresh,
        layout: 'Panel',
      },
      onEmit: {
        Picked: ({ calling }) => Message.PickedHeroCard({ calling }),
        RequestedBuy: ({ calling }) => Message.RequestedBuyHero({ calling }),
        RequestedClose: () => Message.RequestedCloseHeroPicker(),
      },
    }),
  ]
}

const heroDialogView = (props: LobbyProps, h: LobbyH): Content =>
  dialogShellView({
    h,
    id: HERO_DIALOG_ID,
    isOpen: isLobbyShown(props.lobby) && props.lobby.isHeroPickerOpen,
    dialogClass: 'panel-dialog',
    backdropClass: 'panel-backdrop',
    panelClass: 'panel',
    isCentered: true,
    data: { panel: 'Calling' },
    onClose: Message.RequestedCloseHeroPicker(),
    insides: parts => heroPanelViews(props, parts, h),
  })

const foldView = (h: LobbyH): Content =>
  h.div
    .class('dare-fold')
    .attr('aria-hidden', 'true')
    .children(
      h.span.class('dare-fold-half').attr('data-half', 'Top'),
      h.span.class('dare-fold-half').attr('data-half', 'Bottom'),
    )

const cardLayerView = (props: LobbyProps, h: LobbyH): Content => {
  const isOpen = isLobbyShown(props.lobby)
  return h.div.class('lobby-layer').children(
    h.section
      .class('coop lobby')
      .attrs({
        'data-screen': 'Solo',
        'data-state': isOpen ? 'Open' : 'Folding',
      })
      .attr('aria-label', isOpen ? 'Lobby' : undefined)
      .attr('inert', isOpen ? undefined : '')
      .attr('aria-hidden', isOpen ? undefined : 'true')
      .children(
        h.div.class('lobby-backdrop').on('click', Message.ClickedBackdrop()),
        h.h2.class('sr-only').children('Lobby'),
        h.div
          .class('coop-lobby dare-card')
          .children(
            lobbyBackView(props, h),
            seatsView(props, h),
            heldStampView(props, h),
            picksView(props, h),
            startButtonView(props, h),
          ),
      ),
    foldView(h),
    heroDialogView(props, h),
  )
}

export const lobbyCardView: {
  (h: LobbyH): (props: LobbyProps) => Content
  (props: LobbyProps, h: LobbyH): Content
} = Function.dual(2, cardLayerView)
