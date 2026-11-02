import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { PROP_ICONS } from './callingArt'
import { startingCallingOf } from './callingPick'
import { type Special, specialsNoteOf, specialsOf } from './callingSpecials'
import type { ApplicationViewBuilder } from './composition'
import { BACK_ICON, portraitOf } from './coop/icons'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  isLocked,
} from './difficulty'
import {
  CAMPAIGN_ICON,
  ENDLESS_ICON,
  MANOR_ICON,
  PADLOCK_ICON,
  PLAY_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
} from './icons'
import { LOBBY_KEYS, MAPS, MODE_CONTROLS, lobbyControlId } from './lobby'
import { newPipView } from './lookGearView'
import { callingPropView, iconView, keyCapView, rankTagView } from './menuParts'
import { isLobbyUp } from './menuState'
import { Message } from './message'
import type { Difficulty, HomeMode, LobbyControl, MapId, Model } from './model'
import { CALLING_NAMES, MAP_NAMES, MODE_NAMES } from './names'
import { joinName } from './profile'
import { rankOf, totalPointsOf } from './rank'
import { hasUnseenCalling } from './unlocks'

// The single player lobby (GAME_DESIGN.md, "The single player lobby"): the
// co-op lobby's look and layout (src/coop/view.ts, src/coop/coop.css),
// alone. Your seat with your hero card, the mode, the difficulty, and the
// map, three empty crew seats where teammates will sit, and START. Its
// classes are co-op's wherever the part is the same, and `lobby.css` holds
// what is only the lobby's.

const CREW_SEATS = 3

// PIECES

// NOTE: every control has an id for focus, and tells the root when it takes
// or loses focus, so the arrow keys know where to step from.
const controlAttributes = (
  control: LobbyControl,
  h: ApplicationViewBuilder,
) => [
  h.Id(lobbyControlId(control)),
  h.OnFocus(Message.FocusedLobbyControl({ control })),
  h.OnBlur(Message.BlurredLobbyControl()),
]

const backButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      ...controlAttributes('Back', h),
      h.Type('button'),
      h.Class('coop-back'),
      h.AriaLabel('Back to the menu'),
      h.AriaKeyshortcuts(LOBBY_KEYS.Back.name),
      h.OnClick(Message.ClickedLobbyBackButton()),
    ],
    [
      iconView('coop-back-icon', BACK_ICON, h),
      ...keyCapView(model, LOBBY_KEYS.Back.cap, h),
    ],
  )

// YOUR SEAT

const specialChipView = (special: Special, h: ApplicationViewBuilder): Html =>
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
// with the lines (src/callingView.ts).
const heroCardView = (model: Model, h: ApplicationViewBuilder): Html => {
  const calling = startingCallingOf(model)
  const isNew = hasUnseenCalling(
    rankOf(totalPointsOf(model.rank)),
    model.seenUnlocks,
  )
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
      h.OnClick(Message.ClickedLobbyHeroButton()),
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
      ...keyCapView(model, LOBBY_KEYS.Hero.cap, h),
      ...(isNew ? [newPipView(h)] : []),
    ],
  )
}

const mySeatView = (model: Model, h: ApplicationViewBuilder): Html => {
  const rank = rankOf(totalPointsOf(model.rank))
  const calling = startingCallingOf(model)
  return h.li(
    [
      h.Class('coop-seat lobby-seat'),
      h.DataAttribute('state', 'Here'),
      h.DataAttribute('me', 'Me'),
      h.AriaLabel(`${joinName(model)}, you, rank ${rank}`),
    ],
    [
      iconView(
        'coop-portrait coop-seat-head',
        portraitOf(model.appearance, calling),
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
                [joinName(model)],
              ),
            ],
          ),
          heroCardView(model, h),
        ],
      ),
    ],
  )
}

// NOTE: where teammates will sit. They are faint outlines for now, shown
// to nobody and pressed by nobody.
const emptySeatView = (seat: number, h: ApplicationViewBuilder): Html =>
  h.keyed('li')(`seat-${seat}`, [
    h.Class('coop-seat lobby-seat-empty'),
    h.DataAttribute('state', 'Empty'),
    h.AriaHidden(true),
  ])

const seatsView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.ol(
    [h.Class('coop-seats lobby-seats'), h.AriaLabel('Players')],
    [
      mySeatView(model, h),
      ...Array.makeBy(CREW_SEATS, seat => emptySeatView(seat + 1, h)),
    ],
  )

// PICKS

const MODE_PICK_ICONS: Readonly<Record<HomeMode, string>> = {
  Campaign: CAMPAIGN_ICON,
  Endless: ENDLESS_ICON,
}

const MODES: ReadonlyArray<HomeMode> = ['Campaign', 'Endless']

const modePickView = (
  model: Model,
  mode: HomeMode,
  h: ApplicationViewBuilder,
): Html => {
  const isChosen = model.home.mode === mode
  return h.button(
    [
      ...controlAttributes(MODE_CONTROLS[mode], h),
      h.Type('button'),
      h.Class('coop-pick coop-mode-pick'),
      h.DataAttribute('mode', mode),
      h.DataAttribute('state', isChosen ? 'Chosen' : 'Other'),
      h.AriaPressed(isChosen ? 'true' : 'false'),
      h.AriaLabel(MODE_NAMES[mode]),
      h.OnClick(Message.ClickedLobbyModeButton({ mode })),
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
// it. Nightmare is a padlock until a Hard campaign win, and says so, with
// its NEW pip on the run it opens.
const skullPickView = (
  model: Model,
  difficulty: Difficulty,
  h: ApplicationViewBuilder,
): Html => {
  const chosen = model.difficulty.chosen
  const isLit = skullIndexOf(difficulty) <= skullIndexOf(chosen)
  const isLockedOut = isLocked(model.difficulty, difficulty)
  const isFresh =
    difficulty === 'Nightmare' && model.difficulty.nightmare === 'JustUnlocked'
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
      h.OnClick(Message.ClickedLobbyDifficultyButton({ difficulty })),
    ],
    [
      iconView(
        'coop-pick-icon',
        isLockedOut
          ? PADLOCK_ICON
          : isLit
            ? SKULL_ICONS[chosen]
            : SKULL_OFF_ICON,
        h,
      ),
      ...(isFresh ? [newPipView(h)] : []),
    ],
  )
}

// NOTE: a map is a card with its picture and its name. With one map there
// is nothing to pick, so it is shown chosen and takes no taps; a second map
// makes this row a button group like the modes.
const MAP_ICONS: Readonly<Record<MapId, string>> = {
  Manor: MANOR_ICON,
}

const mapCardView = (map: MapId, h: ApplicationViewBuilder): Html =>
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

const picksView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('coop-picks lobby-picks'), h.DataAttribute('host', 'Picking')],
    [
      h.div(
        [h.Class('coop-pick-group'), h.Role('group'), h.AriaLabel('Mode')],
        [
          ...Array.map(MODES, mode => modePickView(model, mode, h)),
          ...keyCapView(model, LOBBY_KEYS.Mode.cap, h),
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group coop-skulls'),
          h.Role('group'),
          h.AriaLabel('Difficulty'),
        ],
        [
          ...Array.map(DIFFICULTY_ORDER, difficulty =>
            skullPickView(model, difficulty, h),
          ),
          ...keyCapView(model, LOBBY_KEYS.Difficulty.cap, h),
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group lobby-maps'),
          h.Role('group'),
          h.AriaLabel('Map'),
        ],
        Array.map(MAPS, map => mapCardView(map, h)),
      ),
    ],
  )

// START

const startButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      ...controlAttributes('Start', h),
      h.Type('button'),
      h.Class('coop-ready lobby-start'),
      h.DataAttribute('ready', 'NotReady'),
      h.AriaLabel('Start'),
      h.AriaKeyshortcuts(LOBBY_KEYS.Start.name),
      h.OnClick(Message.ClickedLobbyStartButton()),
    ],
    [
      h.span(
        [h.Class('coop-ready-face')],
        [
          iconView('coop-ready-icon', PLAY_ICON, h),
          h.span([h.Class('coop-ready-label')], ['START']),
        ],
      ),
      ...keyCapView(model, LOBBY_KEYS.Start.cap, h),
    ],
  )

// VIEW

export const lobbyView = (model: Model, h: ApplicationViewBuilder): Html =>
  isLobbyUp(model)
    ? h.section(
        [
          h.Class('coop lobby'),
          h.DataAttribute('screen', 'Solo'),
          h.AriaLabel('Lobby'),
        ],
        [
          h.h2([h.Class('sr-only')], ['Lobby']),
          h.div(
            [h.Class('coop-lobby')],
            [
              backButtonView(model, h),
              seatsView(model, h),
              picksView(model, h),
              startButtonView(model, h),
            ],
          ),
        ],
      )
    : h.empty
