import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { PROP_ICONS } from '../../art/callingArt'
import {
  CHICKEN_ICON,
  SHAKE_ICON,
  TIN_BOT_ICON,
  portraitOf,
} from '../../art/coopIcons'
import {
  CAMPAIGN_ICON,
  CLOSE_ICON,
  ENDLESS_ICON,
  MANOR_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
} from '../../art/icons'
import {
  type Special,
  specialsNoteOf,
  specialsOf,
} from '../../domain/callingSpecials'
import type { Bot, HomeMode } from '../../domain/clientSchema'
import type { MapId } from '../../shared/nameKeys'
import type { Difficulty } from '../../shared/playerData'
import {
  callingPropView,
  iconView,
  newPipView,
  rankTagView,
  skullFaceViews,
} from '../../ui/menuParts'
import { easyBreakFaceView, easyBreakLabel } from '../../ui/easyBreakView'
import {
  bonusChipView,
  modifierFaceView,
  modifierLabel,
} from '../../ui/modifiersView'
import { CALLING_NAMES, MAP_NAMES, MODE_NAMES } from '../../world/names'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  isLocked,
} from '../../world/run/difficulty'
import {
  MODIFIER_ORDER,
  type Modifier,
  bonusPercentOf,
  isModifierOn,
} from '../../world/run/modifiers'
import { HeroDialogBinding, HeroPickerBinding } from './bindings'
import type { ViewInputs } from './block'
import { LobbyComposition, type LobbyViewBuilder } from './composition'
import {
  LOBBY_KEYS,
  MAPS,
  MODE_CONTROLS,
  SEATS,
  isEasyBreakShown,
  isModifierPickable,
  lobbyControlId,
} from './lobby'
import { Message } from './message'
import {
  type LobbyControl,
  type LobbyPicks,
  type Model,
  isLobbyDrawn,
  isLobbyShown,
} from './model'

// The single player lobby (GAME_DESIGN.md, "The single player lobby"),
// dressed as the dare card your friends hand you (LORE.md, "PLAY is the
// dare, the lobby is the dare card"): the co-op lobby's layout
// (src/features/coop/view.ts) on a scrawled napkin. Each part is a line of
// the card with a word or two in pencil: who is going in (your seat), coming
// as (your hero), who you drag along (wind-up tin robots), out or stay (the
// mode), the stakes, extra dares, which house, then SHAKE ON IT, and CHICKEN
// OUT in the corner. Its classes are co-op's wherever the part is the same,
// and `lobby.css` restyles them under `.lobby` alone, so co-op keeps its
// own look.

const CREW_SEATS = 3

// PIECES

// NOTE: a key cap beside a control, on a keyboard only.
const capView = (
  inputs: ViewInputs,
  cap: string,
  h: LobbyViewBuilder,
): ReadonlyArray<Html> =>
  inputs.isKeyboard
    ? [h.span([h.Class('home-key'), h.AriaHidden(true)], [cap])]
    : []

// NOTE: every control has an id for focus, and tells the root when it takes
// or loses focus, so the arrow keys know where to step from.
const controlAttributes = (control: LobbyControl, h: LobbyViewBuilder) => [
  h.Id(lobbyControlId(control)),
  h.OnFocus(Message.FocusedControl({ control })),
  h.OnBlur(Message.BlurredControl()),
]

// NOTE: a line's word or two, scrawled in pencil on the card. Read aloud
// through the control or group it sits on, so it is hidden here.
const scrawlView = (
  words: string,
  placement: 'Corner' | 'Inline',
  h: LobbyViewBuilder,
): Html =>
  h.span(
    [
      h.Class('dare-scrawl'),
      h.DataAttribute('place', placement),
      h.AriaHidden(true),
    ],
    [words],
  )

// NOTE: BACK is CHICKEN OUT: a hen over the words, in the corner where
// every screen keeps its way back.
const lobbyBackView = (inputs: ViewInputs, h: LobbyViewBuilder): Html =>
  h.button(
    [
      ...controlAttributes('Back', h),
      h.Type('button'),
      h.Class('coop-back lobby-chicken'),
      h.AriaLabel('Chicken out'),
      h.AriaKeyshortcuts(LOBBY_KEYS.Back.name),
      h.OnClick(Message.ClickedBackButton()),
    ],
    [
      iconView('lobby-chicken-icon', CHICKEN_ICON, h),
      h.span(
        [h.Class('lobby-chicken-label'), h.AriaHidden(true)],
        ['CHICKEN OUT'],
      ),
      ...capView(inputs, LOBBY_KEYS.Back.cap, h),
    ],
  )

// YOUR SEAT

const specialChipView = (special: Special, h: LobbyViewBuilder): Html =>
  h.span(
    [
      h.Class('lobby-special'),
      h.DataAttribute('sign', special.isPerk ? 'Perk' : 'Drawback'),
    ],
    [
      iconView('lobby-special-icon', special.art, h),
      h.span(
        [h.Class('lobby-special-sign'), h.AriaHidden(true)],
        [special.isPerk ? '+' : '-'],
      ),
    ],
  )

// NOTE: the hero card is the hero's prop, its name, and each special as a
// picture with a plus or a minus. A tap opens the picker over the lobby,
// with the lines (src/features/heroes/callingView.ts).
const heroCardView = (inputs: ViewInputs, h: LobbyViewBuilder): Html => {
  const calling = inputs.calling
  const isNew = inputs.isHeroNew
  return h.button(
    [
      ...controlAttributes('Hero', h),
      h.Type('button'),
      h.Class('lobby-hero'),
      h.DataAttribute('calling', calling),
      h.AriaLabel(
        `Hero: ${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}. Change it${isNew ? '. Something new' : ''}`,
      ),
      h.AriaHasPopup('dialog'),
      h.AriaKeyshortcuts(LOBBY_KEYS.Hero.name),
      h.OnClick(Message.ClickedHeroButton()),
    ],
    [
      iconView('lobby-hero-prop', PROP_ICONS[calling], h),
      h.span(
        [h.Class('lobby-hero-body'), h.AriaHidden(true)],
        [
          h.span([h.Class('lobby-hero-name')], [CALLING_NAMES[calling]]),
          h.span(
            [h.Class('lobby-specials')],
            Array.map(specialsOf(calling), special =>
              specialChipView(special, h),
            ),
          ),
        ],
      ),
      ...capView(inputs, LOBBY_KEYS.Hero.cap, h),
      ...(isNew ? [newPipView(h)] : []),
    ],
  )
}

const mySeatView = (inputs: ViewInputs, h: LobbyViewBuilder): Html => {
  const rank = inputs.rank
  const calling = inputs.calling
  return h.li(
    [
      h.Class('coop-seat lobby-seat'),
      h.DataAttribute('state', 'Here'),
      h.DataAttribute('me', 'Me'),
      h.AriaLabel(`${inputs.name}, you, rank ${rank}`),
    ],
    [
      scrawlView('GOING IN', 'Corner', h),
      iconView(
        'coop-portrait coop-seat-head',
        portraitOf(inputs.look, calling),
        h,
      ),
      h.div(
        [h.Class('lobby-seat-info')],
        [
          h.div(
            [h.Class('coop-nameline')],
            [
              rankTagView('coop-rank', rank, 2, h),
              callingPropView('coop-calling', calling, h),
              h.span(
                [h.Class('coop-nameplate'), h.AriaHidden(true)],
                [inputs.name],
              ),
            ],
          ),
          scrawlView('COMING AS', 'Inline', h),
          heroCardView(inputs, h),
        ],
      ),
    ],
  )
}

// TEAMMATE BOTS

const seatControlsAt = (index: number): readonly [LobbyControl, LobbyControl] =>
  Option.getOrElse(
    Array.get(SEATS, index),
    (): readonly [LobbyControl, LobbyControl] => ['Bot1', 'Drop1'],
  )

// NOTE: the crew's first seat carries the line's words, who you drag along.
const dragAlongView = (
  seat: number,
  h: LobbyViewBuilder,
): ReadonlyArray<Html> =>
  seat === 0 ? [scrawlView('DRAG ALONG', 'Corner', h)] : []

// NOTE: an empty seat is a button you can see: a tin robot and + BOT.
// A tap seats a bot there, with a goofy name and a hero picked from the
// ones this player has unlocked. The first empty seat wears the key, B.
const addBotTileView = (
  inputs: ViewInputs,
  seat: number,
  isFirst: boolean,
  h: LobbyViewBuilder,
): Html => {
  const [control] = seatControlsAt(seat)
  return h.keyed('li')(
    `seat-${seat}`,
    [h.Class('coop-seat lobby-seat-empty'), h.DataAttribute('state', 'Empty')],
    [
      ...dragAlongView(seat, h),
      h.button(
        [
          ...controlAttributes(control, h),
          h.Type('button'),
          h.Class('lobby-add-bot'),
          h.AriaLabel('Add a bot teammate'),
          h.AriaKeyshortcuts(LOBBY_KEYS.Bot.name),
          h.OnClick(Message.ClickedAddBotButton()),
        ],
        [
          iconView('lobby-add-bot-icon', TIN_BOT_ICON, h),
          h.span(
            [h.Class('lobby-add-bot-label'), h.AriaHidden(true)],
            [
              h.span([h.Class('lobby-add-bot-plus')], ['+']),
              h.span([], ['BOT']),
            ],
          ),
          ...(isFirst ? capView(inputs, LOBBY_KEYS.Bot.cap, h) : []),
        ],
      ),
    ],
  )
}

// NOTE: where teammates cannot sit: a dev link with players at the keyboard
// leaves fewer seats. Faint, and pressed by nobody.
const closedSeatView = (seat: number, h: LobbyViewBuilder): Html =>
  h.keyed('li')(
    `seat-${seat}`,
    [
      h.Class('coop-seat lobby-seat-empty'),
      h.DataAttribute('state', 'Empty'),
      h.AriaHidden(true),
    ],
    dragAlongView(seat, h),
  )

// NOTE: a bot's hero card is the same card as yours, smaller: tap it for
// the hero picker, which then chooses for this bot.
const botHeroView = (bot: Bot, index: number, h: LobbyViewBuilder): Html => {
  const [control] = seatControlsAt(index)
  return h.button(
    [
      ...controlAttributes(control, h),
      h.Type('button'),
      h.Class('lobby-hero lobby-hero-bot'),
      h.DataAttribute('calling', bot.calling),
      h.AriaLabel(
        `${bot.name}'s hero: ${CALLING_NAMES[bot.calling]}. ${specialsNoteOf(bot.calling)}. Change it`,
      ),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedBotHeroButton({ index })),
    ],
    [
      iconView('lobby-hero-prop', PROP_ICONS[bot.calling], h),
      h.span(
        [h.Class('lobby-hero-body'), h.AriaHidden(true)],
        [
          h.span([h.Class('lobby-hero-name')], [CALLING_NAMES[bot.calling]]),
          h.span(
            [h.Class('lobby-specials')],
            Array.map(specialsOf(bot.calling), special =>
              specialChipView(special, h),
            ),
          ),
        ],
      ),
    ],
  )
}

const dropBotView = (bot: Bot, index: number, h: LobbyViewBuilder): Html => {
  const [, control] = seatControlsAt(index)
  return h.button(
    [
      ...controlAttributes(control, h),
      h.Type('button'),
      h.Class('lobby-drop-bot'),
      h.AriaLabel(`Remove ${bot.name}`),
      h.OnClick(Message.ClickedDropBotButton({ index })),
    ],
    [iconView('lobby-drop-bot-icon', CLOSE_ICON, h)],
  )
}

const botSeatView = (bot: Bot, index: number, h: LobbyViewBuilder): Html =>
  h.keyed('li')(
    `seat-${index}`,
    [
      h.Class('coop-seat lobby-seat-bot'),
      h.DataAttribute('state', 'Here'),
      h.DataAttribute('bot', 'Bot'),
      h.AriaLabel(`${bot.name}, bot teammate, ${CALLING_NAMES[bot.calling]}`),
    ],
    [
      ...dragAlongView(index, h),
      iconView(
        'coop-portrait coop-seat-head',
        portraitOf(bot.look, bot.calling),
        h,
      ),
      h.div(
        [h.Class('coop-nameline lobby-bot-nameline')],
        [
          iconView('lobby-bot-mark', TIN_BOT_ICON, h),
          h.span([h.Class('coop-nameplate'), h.AriaHidden(true)], [bot.name]),
        ],
      ),
      botHeroView(bot, index, h),
      dropBotView(bot, index, h),
    ],
  )

const seatsView = (inputs: ViewInputs, h: LobbyViewBuilder): Html => {
  const bots = inputs.picks.bots
  const emptyCount = CREW_SEATS - bots.length
  const canAdd = bots.length < inputs.picks.botSeats
  return h.ol(
    [h.Class('coop-seats lobby-seats'), h.AriaLabel('Players')],
    [
      mySeatView(inputs, h),
      ...Array.map(bots, (bot, index) => botSeatView(bot, index, h)),
      ...(emptyCount > 0
        ? Array.makeBy(emptyCount, offset =>
            canAdd
              ? addBotTileView(inputs, bots.length + offset, offset === 0, h)
              : closedSeatView(bots.length + offset, h),
          )
        : []),
    ],
  )
}

// PICKS

const MODE_PICK_ICONS: Readonly<Record<HomeMode, string>> = {
  Campaign: CAMPAIGN_ICON,
  Endless: ENDLESS_ICON,
}

const MODES: ReadonlyArray<HomeMode> = ['Campaign', 'Endless']

const modePickView = (
  picks: LobbyPicks,
  mode: HomeMode,
  h: LobbyViewBuilder,
): Html => {
  const isChosen = picks.mode === mode
  return h.button(
    [
      ...controlAttributes(MODE_CONTROLS[mode], h),
      h.Type('button'),
      h.Class('coop-pick coop-mode-pick'),
      h.DataAttribute('mode', mode),
      h.DataAttribute('state', isChosen ? 'Chosen' : 'Other'),
      h.AriaPressed(isChosen ? 'true' : 'false'),
      h.AriaLabel(MODE_NAMES[mode]),
      h.OnClick(Message.ClickedModeButton({ mode })),
    ],
    [iconView('coop-pick-icon', MODE_PICK_ICONS[mode], h)],
  )
}

const skullIndexOf = (difficulty: Difficulty): number =>
  Option.getOrElse(
    Array.findFirstIndex(DIFFICULTY_ORDER, level => level === difficulty),
    () => 0,
  )

// NOTE: as many skulls lit as the level, as on the home menu used to show
// it. Nightmare is a dim skull with a padlock badge until a Hard campaign
// win, and says so, with its NEW pip on the run it opens.
const skullPickView = (
  picks: LobbyPicks,
  difficulty: Difficulty,
  h: LobbyViewBuilder,
): Html => {
  const setting = picks.difficulty
  const chosen = setting.chosen
  const isLit = skullIndexOf(difficulty) <= skullIndexOf(chosen)
  const isLockedOut = isLocked(setting, difficulty)
  const isFresh =
    difficulty === 'Nightmare' && setting.nightmare === 'JustUnlocked'
  return h.button(
    [
      ...controlAttributes(difficulty, h),
      h.Type('button'),
      h.Class('coop-pick coop-skull-pick'),
      h.DataAttribute('difficulty', difficulty),
      h.DataAttribute(
        'state',
        chosen === difficulty ? 'Chosen' : isLit ? 'Lit' : 'Other',
      ),
      h.AriaPressed(chosen === difficulty ? 'true' : 'false'),
      h.AriaLabel(
        isLockedOut
          ? `${DIFFICULTIES[difficulty].name}, locked. ${NIGHTMARE_LOCK_NOTE}`
          : `${DIFFICULTIES[difficulty].name}: ${DIFFICULTIES[difficulty].blurb}`,
      ),
      ...(isLockedOut ? [h.AriaDisabled(true)] : []),
      h.OnClick(Message.ClickedDifficultyButton({ difficulty })),
    ],
    [
      ...skullFaceViews(
        {
          className: 'coop-pick-icon',
          icon: isLit ? SKULL_ICONS[chosen] : SKULL_OFF_ICON,
          isLocked: isLockedOut,
        },
        h,
      ),
      ...(isFresh ? [newPipView(h)] : []),
    ],
  )
}

// NOTE: a run modifier is a tile that turns on and off, lit when on. Friendly
// Fire is dim until a bot sits in the crew, with nobody to hit before that.
const modifierPickView = (
  picks: LobbyPicks,
  modifier: Modifier,
  h: LobbyViewBuilder,
): Html => {
  const isOn = isModifierOn(picks.modifiers, modifier)
  const isPickable = isModifierPickable(picks, modifier)
  return h.button(
    [
      ...controlAttributes(modifier, h),
      h.Type('button'),
      h.Class('coop-pick modifier-pick'),
      h.DataAttribute('modifier', modifier),
      h.DataAttribute('state', isOn ? 'On' : 'Off'),
      h.DataAttribute('available', isPickable ? 'Yes' : 'No'),
      h.AriaPressed(isOn ? 'true' : 'false'),
      h.AriaLabel(
        isPickable
          ? modifierLabel(modifier, isOn)
          : `${modifierLabel(modifier, isOn)}. Add a bot teammate first`,
      ),
      ...(isPickable ? [] : [h.AriaDisabled(true)]),
      h.OnClick(Message.ClickedModifierButton({ modifier })),
    ],
    modifierFaceView(modifier, h),
  )
}

// NOTE: Dare's break clock, beside the skulls while Dare is picked: a
// press steps it, ∞ (none) first.
const easyBreakPickView = (picks: LobbyPicks, h: LobbyViewBuilder): Html =>
  h.button(
    [
      ...controlAttributes('EasyBreak', h),
      h.Type('button'),
      h.Class('coop-pick easy-break-pick'),
      h.DataAttribute('state', picks.easyBreakSeconds > 0 ? 'On' : 'Off'),
      h.AriaLabel(easyBreakLabel(picks.easyBreakSeconds)),
      h.OnClick(Message.ClickedEasyBreakButton()),
    ],
    easyBreakFaceView(picks.easyBreakSeconds, h),
  )

// NOTE: a map is a card with its picture and its name. With one map there
// is nothing to pick, so it is shown chosen and takes no taps; a second map
// makes this row a button group like the modes.
const MAP_ICONS: Readonly<Record<MapId, string>> = {
  Manor: MANOR_ICON,
}

const mapCardView = (map: MapId, h: LobbyViewBuilder): Html =>
  h.div(
    [
      h.Class('lobby-map'),
      h.DataAttribute('map', map),
      h.DataAttribute('state', 'Chosen'),
      h.Role('img'),
      h.AriaLabel(`Map: ${MAP_NAMES[map]}`),
    ],
    [
      iconView('lobby-map-icon', MAP_ICONS[map], h),
      h.span([h.Class('lobby-map-name'), h.AriaHidden(true)], [MAP_NAMES[map]]),
    ],
  )

const picksView = (inputs: ViewInputs, h: LobbyViewBuilder): Html =>
  h.div(
    [h.Class('coop-picks lobby-picks'), h.DataAttribute('host', 'Picking')],
    [
      h.div(
        [h.Class('coop-pick-group'), h.Role('group'), h.AriaLabel('Mode')],
        [
          scrawlView('OUT OR STAY', 'Corner', h),
          ...Array.map(MODES, mode => modePickView(inputs.picks, mode, h)),
          ...capView(inputs, LOBBY_KEYS.Mode.cap, h),
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group coop-skulls'),
          h.Role('group'),
          h.AriaLabel('Difficulty'),
        ],
        [
          scrawlView('STAKES', 'Corner', h),
          ...Array.map(DIFFICULTY_ORDER, difficulty =>
            skullPickView(inputs.picks, difficulty, h),
          ),
          ...capView(inputs, LOBBY_KEYS.Difficulty.cap, h),
          ...(isEasyBreakShown(inputs.picks)
            ? [easyBreakPickView(inputs.picks, h)]
            : []),
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group modifier-group'),
          h.Role('group'),
          h.AriaLabel('Modifiers'),
        ],
        [
          scrawlView('EXTRA DARES', 'Corner', h),
          ...Array.map(MODIFIER_ORDER, modifier =>
            modifierPickView(inputs.picks, modifier, h),
          ),
          bonusChipView(bonusPercentOf(inputs.picks.modifiers), h),
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group lobby-maps'),
          h.Role('group'),
          h.AriaLabel('Map'),
        ],
        [
          scrawlView('WHICH HOUSE', 'Corner', h),
          ...Array.map(MAPS, map => mapCardView(map, h)),
        ],
      ),
    ],
  )

// SHAKE ON IT

// NOTE: START is the handshake that seals the dare.
const startButtonView = (inputs: ViewInputs, h: LobbyViewBuilder): Html =>
  h.button(
    [
      ...controlAttributes('Start', h),
      h.Type('button'),
      h.Class('coop-ready lobby-start'),
      h.DataAttribute('ready', 'NotReady'),
      h.AriaLabel('Shake on it'),
      h.AriaKeyshortcuts(LOBBY_KEYS.Start.name),
      h.OnClick(Message.ClickedStartButton()),
    ],
    [
      h.span(
        [h.Class('coop-ready-face')],
        [
          iconView('coop-ready-icon', SHAKE_ICON, h),
          h.span([h.Class('coop-ready-label')], ['SHAKE ON IT']),
        ],
      ),
      ...capView(inputs, LOBBY_KEYS.Start.cap, h),
    ],
  )

// THE HERO PICKER

// NOTE: the bot whose hero the picker is choosing, when a bot's card
// opened it.
const maybePickingBotOf = (
  model: Model,
  inputs: ViewInputs,
): Option.Option<Bot> =>
  Option.flatMap(model.maybePickingBot, index =>
    Array.get(inputs.picks.bots, index),
  )

// NOTE: the picker in its Dialog over the lobby, as the menu panels look:
// the title, the line (read aloud only), then the picker's cards, Bones,
// and actions. Its cards wear the bot's look and hero when it chooses for
// a bot.
const heroPanelView = (
  model: Model,
  inputs: ViewInputs,
  renderInfo: Dialog.RenderInfo,
  h: LobbyViewBuilder,
): ReadonlyArray<Html> => {
  const maybeBot = maybePickingBotOf(model, inputs)
  return [
    h.h2([...renderInfo.title, h.Class('panel-title')], ['Hero']),
    h.p(
      [...renderInfo.description, h.Class('panel-blurb sr-only')],
      [
        Option.match(maybeBot, {
          onNone: () => 'Pick who you play.',
          onSome: bot => `Pick for ${bot.name}.`,
        }),
      ],
    ),
    h.block(
      HeroPickerBinding.embedView({
        slotId: 'lobby-hero-picker',
        model: model.heroPicker,
        viewInputs: {
          look: Option.match(maybeBot, {
            onNone: () => inputs.look,
            onSome: bot => bot.look,
          }),
          chosen: Option.match(maybeBot, {
            onNone: () => inputs.calling,
            onSome: bot => bot.calling,
          }),
          rank: inputs.rank,
          bought: inputs.bought,
          bones: inputs.bones,
          fresh: inputs.fresh,
          layout: 'Panel',
        },
      }),
    ),
  ]
}

const heroDialogView = (
  model: Model,
  inputs: ViewInputs,
  h: LobbyViewBuilder,
): Html =>
  h.block(
    HeroDialogBinding.embedView({
      slotId: model.heroDialog.id,
      model: model.heroDialog,
      viewInputs: {
        hasDescription: true,
        toView: renderInfo =>
          h.dialog(
            [
              h.Key(model.heroDialog.id),
              ...renderInfo.dialog,
              h.Class('panel-dialog'),
              h.DataAttribute('panel', 'Calling'),
            ],
            renderInfo.isVisible
              ? [
                  h.div([...renderInfo.backdrop, h.Class('panel-backdrop')]),
                  h.div(
                    [...renderInfo.panel, h.Class('panel')],
                    heroPanelView(model, inputs, renderInfo, h),
                  ),
                ]
              : [],
          ),
      },
    }),
  )

// THE FOLD

// NOTE: the paper the card unfolds from: a copy of the napkin, folded in
// half, that grows out of PLAY, opens, and gives way to the card
// (lobby.css, `dare-unfold`), and on CHICKEN OUT folds back into PLAY
// (`dare-fold-back`). It is art alone, aria-hidden and taking no taps: the
// card and its buttons never move, they fade in once it is open.
const foldView = (h: LobbyViewBuilder): Html =>
  h.div(
    [h.Class('dare-fold'), h.AriaHidden(true)],
    [
      h.span([h.Class('dare-fold-half'), h.DataAttribute('half', 'Top')]),
      h.span([h.Class('dare-fold-half'), h.DataAttribute('half', 'Bottom')]),
    ],
  )

// VIEW

// NOTE: the dare card over the home menu, sized to what it holds, with the
// menu dimmed around it; a tap on the dim closes it as CHICKEN OUT does.
// While it folds back into PLAY it is still drawn, so the fold has its
// size, but inert and hidden: the home menu has the keys again. The hero
// picker's Dialog opens over it.
const view = LobbyComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) => {
    const isOpen = isLobbyShown(model)
    return isLobbyDrawn(model)
      ? h.div(
          [h.Class('lobby-layer')],
          [
            h.section(
              [
                h.Class('coop lobby'),
                h.DataAttribute('screen', 'Solo'),
                h.DataAttribute('state', isOpen ? 'Open' : 'Folding'),
                ...(isOpen
                  ? [h.AriaLabel('Lobby')]
                  : [h.Inert(true), h.AriaHidden(true)]),
              ],
              [
                h.div([
                  h.Class('lobby-backdrop'),
                  h.OnClick(Message.ClickedBackdrop()),
                ]),
                h.h2([h.Class('sr-only')], ['Lobby']),
                h.div(
                  [h.Class('coop-lobby dare-card')],
                  [
                    lobbyBackView(inputs, h),
                    seatsView(inputs, h),
                    picksView(inputs, h),
                    startButtonView(inputs, h),
                  ],
                ),
              ],
            ),
            foldView(h),
            heroDialogView(model, inputs, h),
          ],
        )
      : h.empty
  },
)

// NOTE: the lobby's view, gathered here so it is not exported alone: a view
// is a function of three arguments with no pipeable form, and Foldkit knows
// a view by its identity. src/features/lobby/layer.ts completes it.
export const lobbyImplementation = { view }
