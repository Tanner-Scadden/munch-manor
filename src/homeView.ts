import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { HandDialogBinding, PanelDialogBinding } from './bindings'
import { callingBodyView, callingPanelText } from './callingView'
import type { ApplicationViewBuilder } from './composition'
import { COOP_ICON } from './coop/icons'
import { IS_COOP_RELEASED } from './coop/release'
import { closeButtonView, dialogShell } from './dialogs'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  isLocked,
} from './difficulty'
import { munchopediaBodyView, munchopediaText } from './guideView'
import {
  HAND_CARDS,
  HAND_KEYS,
  HOME_BUTTONS,
  HOME_KEYS,
  KEYED_HAND_CARDS,
  type KeyedHandCard,
  type LinkHandCard,
  SOURCE_URL,
  bestsFor,
  handCardId,
  homeButtonId,
  isEndScreen,
  isLinkHandCard,
  isNewsUnseen,
  isOnHome,
  steppedHandCard,
} from './home'
import {
  AIM_ICON,
  CHARACTER_ICON,
  CLOCK_ICON,
  COFFEE_CUP_ICON,
  COFFEE_STEAM_ICON,
  FULLSCREEN_ICON,
  GITHUB_MARK_ICON,
  HAND_ICON,
  HELP_ICON,
  KILLS_ICON,
  MUNCHOPEDIA_ICON,
  NEWS_ICON,
  PADLOCK_ICON,
  PLAY_ICON,
  SETTINGS_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
  TROPHY_ICON,
  TURN_PHONE_ICON,
} from './icons'
import { installTileView } from './installView'
import { iconView, isKeyboard, keyCapView } from './menuParts'
import { Message } from './message'
import {
  type Difficulty,
  DifficultyCard,
  type HandCard,
  type HomeButton,
  type MenuPanel,
  type Model,
  Phase,
} from './model'
import {
  ENTRY_COUNT,
  discoveredKinds,
  entryName,
  hasUnopenedEntry,
} from './munchopedia'
import { helpLabel, howToPlayView } from './pauseHelp'
import { rankOf, totalPointsOf } from './rank'
import { rankChipView } from './rankBadgeView'
import { isPortrait } from './screen'
import { durationLabel } from './stats'
import { hasUnseenLook } from './unlocks'
import { hasFinishedTutorial } from './update/coop'
import { updateGiftView } from './updateGift'
import { whatsNewBodyView, whatsNewText } from './whatsNewView'

// KEY BADGES

const keyBadgeView = (
  model: Model,
  button: HomeButton,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => keyCapView(model, HOME_KEYS[button].cap, h)

// NOTE: what every home button shares, a link like the coffee too: its id,
// its key, and focus for the arrow keys.
const homeFocusAttributes = (button: HomeButton, h: ApplicationViewBuilder) => [
  h.Id(homeButtonId(button)),
  h.AriaKeyshortcuts(HOME_KEYS[button].name),
  h.OnFocus(Message.FocusedHomeButton({ button })),
  h.OnBlur(Message.BlurredHomeButton()),
]

const homeButtonAttributes = (
  button: HomeButton,
  h: ApplicationViewBuilder,
) => [h.Type('button'), ...homeFocusAttributes(button, h)]

// PLAY

// NOTE: show, don't explain. PLAY is the big play icon alone, and the lobby it
// opens (src/lobbyView.ts) says which run it starts.
const playButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      ...homeButtonAttributes('Play', h),
      h.Class('home-play'),
      h.DataAttribute('mode', model.home.mode),
      h.AriaLabel('Play'),
      h.OnClick(Message.ClickedPlayButton(), { propagation: 'Stop' }),
    ],
    [
      h.span(
        [h.Class('home-play-face')],
        [iconView('home-play-icon', PLAY_ICON, h)],
      ),
      ...keyBadgeView(model, 'Play', h),
    ],
  )

// NOTE: a difficulty reads as a row of four skulls: as many lit as the
// level, each in that level's color and face, and the fourth padlocked
// while Nightmare is locked.
const skullMeterView = (
  model: Model,
  difficulty: Difficulty,
  h: ApplicationViewBuilder,
): Html => {
  const lit = Array.findFirstIndex(
    DIFFICULTY_ORDER,
    level => level === difficulty,
  )
  const litCount = Option.getOrElse(lit, () => 0) + 1
  return h.span(
    [h.Class('skull-meter'), h.AriaHidden(true)],
    Array.map(DIFFICULTY_ORDER, (level, index) =>
      level === 'Nightmare' && isLocked(model.difficulty, 'Nightmare')
        ? iconView('skull skull-locked', PADLOCK_ICON, h)
        : iconView(
            index < litCount ? 'skull skull-lit' : 'skull',
            index < litCount ? SKULL_ICONS[difficulty] : SKULL_OFF_ICON,
            h,
          ),
    ),
  )
}

// NOTE: CO-OP is two heads, pink and teal, by PLAY. Until the tutorial is
// done it is padlocked, with the aim icon of the tutorial's own lesson.
const coopButtonView = (model: Model, h: ApplicationViewBuilder): Html => {
  const isOpen = hasFinishedTutorial(model)
  return h.button(
    [
      ...homeButtonAttributes('Coop', h),
      h.Class('home-coop'),
      h.DataAttribute('lock', isOpen ? 'Open' : 'Locked'),
      h.AriaLabel(
        isOpen
          ? 'Co-op: play with friends'
          : 'Co-op: finish the tutorial to unlock',
      ),
      h.AriaDisabled(!isOpen),
      h.OnClick(Message.ClickedCoopButton(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-coop-icon', COOP_ICON, h),
      ...(isOpen
        ? []
        : [
            h.span(
              [h.Class('home-coop-lock'), h.AriaHidden(true)],
              [
                iconView('home-coop-lock-icon', PADLOCK_ICON, h),
                iconView('home-coop-lock-icon', AIM_ICON, h),
              ],
            ),
          ]),
      ...keyBadgeView(model, 'Coop', h),
    ],
  )
}

const playClusterView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('home-play-cluster'), h.Role('group'), h.AriaLabel('Play')],
    [
      playButtonView(model, h),
      IS_COOP_RELEASED ? coopButtonView(model, h) : h.empty,
    ],
  )

// THE MANOR HAND

type CardLook = Readonly<{
  title: string
  ariaLabel: string
  icon: string
}>

const CARD_LOOKS: Readonly<Record<HandCard, CardLook>> = {
  Character: {
    title: 'CHARACTER',
    ariaLabel: 'Character: change how you look',
    icon: CHARACTER_ICON,
  },
  Munchopedia: {
    title: 'MUNCHOPEDIA',
    ariaLabel: 'Munchopedia: every zombie you have splatted',
    icon: MUNCHOPEDIA_ICON,
  },
  WhatsNew: {
    title: "WHAT'S NEW",
    ariaLabel: "What's new: the latest changes",
    icon: NEWS_ICON,
  },
  HowToPlay: {
    title: 'HOW TO PLAY',
    ariaLabel: 'How to play: the controls',
    icon: HELP_ICON,
  },
  Code: {
    title: 'CODE',
    ariaLabel: "Code: the game's source on GitHub. Opens in a new tab",
    icon: GITHUB_MARK_ICON,
  },
}

// NOTE: show, don't explain. A card is its picture and its name. Only the
// Munchopedia adds a tally, since it changes as the player finds zombies.
const maybeCardTally = (model: Model, card: HandCard): Option.Option<string> =>
  card === 'Munchopedia'
    ? Option.some(
        `${discoveredKinds(model.bests.killsByKind).length}/${ENTRY_COUNT}`,
      )
    : Option.none()

const CARD_MESSAGES: Readonly<Record<KeyedHandCard, Message>> = {
  Character: Message.ClickedCharacterButton(),
  Munchopedia: Message.ClickedMunchopediaButton(),
  WhatsNew: Message.ClickedWhatsNewButton(),
  HowToPlay: Message.ClickedHowToPlayButton(),
}

const hasNews = (model: Model, card: HandCard): boolean => {
  if (card === 'Character') {
    return hasUnseenLook(rankOf(totalPointsOf(model.rank)), model.seenUnlocks)
  } else if (card === 'WhatsNew') {
    return isNewsUnseen(model)
  } else if (card === 'Munchopedia') {
    return hasUnopenedEntry(model)
  } else {
    return false
  }
}

const cardAriaLabel = (model: Model, card: HandCard): string =>
  hasNews(model, card)
    ? `${CARD_LOOKS[card].ariaLabel}. Something new`
    : CARD_LOOKS[card].ariaLabel

const newsCards = (model: Model): ReadonlyArray<HandCard> =>
  Array.filter(HAND_CARDS, card => hasNews(model, card))

const NEWS_NAMES: Readonly<Record<HandCard, string>> = {
  Character: 'Character',
  Munchopedia: 'the Munchopedia',
  WhatsNew: "What's new",
  HowToPlay: 'How to play',
  Code: 'the code',
}

const manorAriaLabel = (model: Model): string =>
  Array.match(newsCards(model), {
    onEmpty: () => 'More: character, Munchopedia, what is new, and how to play',
    onNonEmpty: cards =>
      `More: character, Munchopedia, what is new, and how to play. Something new in ${Array.join(
        Array.map(cards, card => NEWS_NAMES[card]),
        ' and ',
      )}`,
  })

// NOTE: the badges of the cards inside bubble up to the closed MANOR button
// as little pips, each the card's own icon with a red dot, so What's New and
// the Munchopedia still show their news without opening the hand.
const manorPipsView = (model: Model, h: ApplicationViewBuilder): Html =>
  Array.match(newsCards(model), {
    onEmpty: () => h.empty,
    onNonEmpty: cards =>
      h.span(
        [h.Class('manor-pips'), h.AriaHidden(true)],
        Array.map(cards, card =>
          h.span(
            [h.Class('manor-pip'), h.DataAttribute('card', card)],
            [iconView('manor-pip-icon', CARD_LOOKS[card].icon, h)],
          ),
        ),
      ),
  })

const manorButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      ...homeButtonAttributes('Manor', h),
      h.Class('home-manor'),
      h.AriaLabel(manorAriaLabel(model)),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedManorButton(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-manor-icon', HAND_ICON, h),
      h.span([h.Class('home-manor-label')], ['MORE']),
      manorPipsView(model, h),
      ...keyBadgeView(model, 'Manor', h),
    ],
  )

const handKeyMessage = (
  card: HandCard,
  key: string,
): Option.Option<Message> => {
  const step =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0
  return step === 0
    ? Option.none()
    : Option.map(steppedHandCard(HAND_CARDS, card, step), next =>
        Message.SteppedHandFocus({ card: next }),
      )
}

// NOTE: the card button stays square to the screen so a tap anywhere in it
// lands, and only its face tilts into the fan. The face takes no taps.
const cardBodyView = (
  model: Model,
  card: HandCard,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.span(
    [h.Class('hand-card-face')],
    [
      h.span(
        [h.Class('hand-card-art')],
        [iconView('hand-card-icon', CARD_LOOKS[card].icon, h)],
      ),
      h.span([h.Class('hand-card-title')], [CARD_LOOKS[card].title]),
      ...Option.match(maybeCardTally(model, card), {
        onNone: () => [],
        onSome: tally => [
          h.span(
            [
              h.Class('hand-card-tally'),
              h.Style({
                '--found': `${discoveredKinds(model.bests.killsByKind).length / ENTRY_COUNT}`,
              }),
            ],
            [tally],
          ),
        ],
      }),
      ...(hasNews(model, card)
        ? [h.span([h.Class('hand-card-new'), h.AriaHidden(true)], ['NEW'])]
        : []),
      ...(isLinkHandCard(card)
        ? []
        : keyCapView(model, HAND_KEYS[card].cap, h)),
    ],
  ),
]

const LINK_CARD_URLS: Readonly<Record<LinkHandCard, string>> = {
  Code: SOURCE_URL,
}

const handCardView = (
  model: Model,
  card: HandCard,
  index: number,
  count: number,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): Html => {
  const shared = [
    ...(index === 0 ? renderInfo.initialFocus : []),
    h.Id(handCardId(card)),
    h.Class('hand-card'),
    h.DataAttribute('card', card),
    h.Style({ '--i': `${index}`, '--n': `${count}` }),
    h.AriaLabel(cardAriaLabel(model, card)),
    ...(isLinkHandCard(card) ? [] : [h.AriaKeyshortcuts(HAND_KEYS[card].name)]),
    h.OnKeyDownPreventDefault(key => handKeyMessage(card, key)),
  ]
  return h.li(
    [h.Class('hand-slot')],
    [
      isLinkHandCard(card)
        ? h.a(
            [
              ...shared,
              h.Href(LINK_CARD_URLS[card]),
              h.Target('_blank'),
              h.Rel('noopener noreferrer'),
            ],
            cardBodyView(model, card, h),
          )
        : h.button(
            [
              ...shared,
              h.Type('button'),
              h.AriaHasPopup('dialog'),
              h.OnClick(CARD_MESSAGES[card], { propagation: 'Stop' }),
            ],
            cardBodyView(model, card, h),
          ),
    ],
  )
}

const HAND_TITLE = 'The manor'

const handView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => {
  const cards = HAND_CARDS
  return [
    h.h2([...renderInfo.title, h.Class('sr-only')], [HAND_TITLE]),
    h.p(
      [...renderInfo.description, h.Class('sr-only')],
      ['Pick a card. Arrow keys move between them.'],
    ),
    h.ul(
      [h.Class('hand-cards')],
      Array.map(cards, (card, index) =>
        handCardView(model, card, index, cards.length, renderInfo, h),
      ),
    ),
    closeButtonView(
      {
        attributes: renderInfo.closeButton,
        className: 'hand-close',
        label: 'Close',
      },
      h,
    ),
  ]
}

export const manorHandView = (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.handDialog,
      dialogClass: 'hand-dialog',
      backdropClass: 'hand-backdrop',
      panelClass: 'hand',
      dialogAttributes: [h.DataAttribute('device', model.lastDevice)],
      panelView: renderInfo => handView(model, renderInfo, h),
      binding: HandDialogBinding,
    },
    h,
  )

// BESTS

type Best = Readonly<{ label: string; icon: string; value: string }>

const shownBests = (model: Model): ReadonlyArray<Best> => [
  ...Option.match(bestsFor(model).maybeBestEndlessWave, {
    onNone: () => [],
    onSome: wave => [
      { label: 'Best endless wave', icon: TROPHY_ICON, value: `${wave}` },
    ],
  }),
  ...Option.match(bestsFor(model).maybeFastestWinMs, {
    onNone: () => [],
    onSome: runMs => [
      { label: 'Fastest win', icon: CLOCK_ICON, value: durationLabel(runMs) },
    ],
  }),
  ...(model.bests.totalKills > 0
    ? [
        {
          label: 'Zombies splatted',
          icon: KILLS_ICON,
          value: `${model.bests.totalKills}`,
        },
      ]
    : []),
]

const bestView = (best: Best, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('home-best')],
    [
      h.dt(
        [h.Class('home-best-label')],
        [
          iconView('home-best-icon', best.icon, h),
          h.span([h.Class('sr-only')], [best.label]),
        ],
      ),
      h.dd([h.Class('home-best-value')], [best.value]),
    ],
  )

// NOTE: a badge of icons and big numbers, in the chosen level's color, and
// nothing at all until the player has a best.
const bestsView = (model: Model, h: ApplicationViewBuilder): Html =>
  Array.match(shownBests(model), {
    onEmpty: () => h.empty,
    onNonEmpty: bests =>
      h.section(
        [
          h.Class('home-bests'),
          h.DataAttribute('difficulty', model.difficulty.chosen),
          h.AriaLabel(
            `Your bests, ${DIFFICULTIES[model.difficulty.chosen].name}`,
          ),
        ],
        [
          iconView('home-bests-level', SKULL_ICONS[model.difficulty.chosen], h),
          h.dl(
            [h.Class('home-bests-list')],
            Array.map(bests, best => bestView(best, h)),
          ),
        ],
      ),
  })

// STAGE

// NOTE: the player walks on the spot in the middle of the stage, drawn on
// the canvas by screens.ts. This button sits over them, so a tap on your
// character opens the picker. The hand's Character card is the one a
// keyboard or a screen reader reaches.
const heroButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('home-hero'),
      h.Tabindex(-1),
      h.AriaLabel('Your character: change how you look'),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedCharacterButton(), { propagation: 'Stop' }),
    ],
    [rankChipView(model, h)],
  )

// CORNER

const fullscreenButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  model.screenFit === 'Fullscreen'
    ? h.button(
        [
          h.Type('button'),
          h.Class('home-corner-button home-fullscreen'),
          h.AriaLabel('Full screen'),
          h.AriaPressed(model.fullscreen === 'On' ? 'true' : 'false'),
          h.OnClick(Message.ClickedFullscreenButton(), { propagation: 'Stop' }),
        ],
        [iconView('home-corner-icon', FULLSCREEN_ICON, h)],
      )
    : h.empty

// NOTE: the gear sits in the corner itself, the coffee just inside it, and
// full screen, where the browser can do it, inside that.
const settingsButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.button(
    [
      ...homeButtonAttributes('Settings', h),
      h.Class('home-corner-button home-settings'),
      h.AriaLabel('Settings'),
      h.AriaHasPopup('dialog'),
      h.OnClick(Message.ClickedSettingsButton(), { propagation: 'Stop' }),
    ],
    [
      iconView('home-corner-icon', SETTINGS_ICON, h),
      ...keyBadgeView(model, 'Settings', h),
    ],
  )

// NOTE: Buy Rattles a coffee, just left of the gear: a pixel mug with
// steam rising from it. It is a real link, so the browser opens the tip
// jar from the tap itself and no popup blocker stops it. Its click still
// sends ClickedSupportButton for the tap sound, and never prevents the link.
const COFFEE_LABEL = 'Buy Rattles a coffee'

const STEAM_WISPS = 2

const supportButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(model.maybeSupportUrl, {
    onNone: () => h.empty,
    onSome: url =>
      h.a(
        [
          ...homeFocusAttributes('Support', h),
          h.Class('home-corner-button home-support'),
          h.Href(url),
          h.Target('_blank'),
          h.Rel('noopener noreferrer'),
          h.AriaLabel(`${COFFEE_LABEL}. Opens in a new tab`),
          h.Title(COFFEE_LABEL),
          h.OnClick(Message.ClickedSupportButton(), { propagation: 'Stop' }),
        ],
        [
          ...Array.makeBy(STEAM_WISPS, wisp =>
            h.span([
              h.Class('home-support-steam'),
              h.AriaHidden(true),
              h.Style({
                '--wisp': `${wisp}`,
                backgroundImage: COFFEE_STEAM_ICON,
              }),
            ]),
          ),
          iconView('home-corner-icon home-support-cup', COFFEE_CUP_ICON, h),
          ...keyBadgeView(model, 'Support', h),
        ],
      ),
  })

// NEW ENTRY

const newEntryText = (model: Model): Option.Option<string> =>
  Option.map(Array.head(model.home.newEntries), kind =>
    model.home.newEntries.length > 1
      ? `${entryName(kind)} and ${model.home.newEntries.length - 1} more`
      : entryName(kind),
  )

const newEntryButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(Array.head(model.home.newEntries), {
    onNone: () => h.empty,
    onSome: kind =>
      h.button(
        [
          h.Type('button'),
          h.Class('new-entry'),
          h.AriaLabel(
            `New Munchopedia entry: ${Option.getOrElse(newEntryText(model), () => '')}. Open it`,
          ),
          h.OnClick(Message.ClickedNewEntryButton({ kind }), {
            propagation: 'Stop',
          }),
        ],
        [
          h.span([h.Class('new-entry-flag')], ['NEW ENTRY!']),
          h.span(
            [h.Class('new-entry-name')],
            [Option.getOrElse(newEntryText(model), () => '')],
          ),
        ],
      ),
  })

// NOTE: the end screens only tell. The entry opens from the menu.
export const newEntryNoticeView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  isEndScreen(model.phase)
    ? Option.match(newEntryText(model), {
        onNone: () => h.empty,
        onSome: text =>
          h.div(
            [h.Class('new-entry new-entry-notice'), h.Role('status')],
            [
              h.span([h.Class('new-entry-flag')], ['NEW ENTRY!']),
              h.span([h.Class('new-entry-name')], [text]),
              h.span(
                [h.Class('new-entry-where')],
                ['In the Munchopedia on the menu'],
              ),
            ],
          ),
      })
    : h.empty

// TURN HINT

export const TURN_HINT_TEXT = 'Turn your phone sideways to see the whole room'

// NOTE: portrait zooms in on part of the room, so a phone held upright gets a
// small nudge to turn: only the tipping phone, no words, with its line for a
// screen reader. It sits above the controls, takes no taps, and is gone the
// moment the phone turns. isPortrait is false on a keyboard and mouse.
const turnHintView = (model: Model, h: ApplicationViewBuilder): Html =>
  isPortrait(model)
    ? h.div(
        [h.Class('home-turn-hint'), h.Role('img'), h.AriaLabel(TURN_HINT_TEXT)],
        [iconView('home-turn-icon', TURN_PHONE_ICON, h)],
      )
    : h.empty

// HOME MENU

export const homeMenuView = (model: Model, h: ApplicationViewBuilder): Html =>
  isOnHome(model.phase)
    ? h.div(
        [
          h.Class('home-frame'),
          h.DataAttribute('device', model.lastDevice),
          h.DataAttribute('fit', model.screenFit),
        ],
        [
          h.div(
            [h.Class('home-stage')],
            [
              playClusterView(model, h),
              manorButtonView(model, h),
              bestsView(model, h),
              heroButtonView(model, h),
              newEntryButtonView(model, h),
              turnHintView(model, h),
              h.div(
                [h.Class('home-corner')],
                [
                  h.div(
                    [h.Class('home-corner-row')],
                    [
                      fullscreenButtonView(model, h),
                      supportButtonView(model, h),
                      settingsButtonView(model, h),
                    ],
                  ),
                  h.div(
                    [h.Class('home-corner-row')],
                    [updateGiftView(model, h), installTileView(model, h)],
                  ),
                ],
              ),
            ],
          ),
        ],
      )
    : h.empty

// PAUSE MENU BUTTON

export const pauseMenuButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  Phase.isAnyOf(['Paused'])(model.phase)
    ? h.button(
        [
          h.Type('button'),
          h.Class('pause-menu-button'),
          h.AriaLabel('Menu: leave this run'),
          h.AriaKeyshortcuts('H'),
          h.AriaHasPopup('dialog'),
          h.OnClick(Message.ClickedMenuButton(), { propagation: 'Stop' }),
        ],
        [
          'MENU',
          ...(model.lastDevice === 'KeyboardMouse'
            ? [h.span([h.Class('home-button-key'), h.AriaHidden(true)], ['H'])]
            : []),
        ],
      )
    : h.empty

// PANELS

const MENU_KEYS_TITLE_ID = 'menu-keys-title'

const MENU_KEY_ACTIONS: Readonly<Record<HomeButton, string>> = {
  Play: 'play',
  Coop: 'co-op',
  Manor: 'manor',
  Support: 'coffee',
  Settings: 'settings',
}

const CARD_KEY_ACTIONS: Readonly<Record<KeyedHandCard, string>> = {
  Character: 'character',
  Munchopedia: 'Munchopedia',
  WhatsNew: "what's new",
  HowToPlay: 'how to play',
}

const menuKeysView = (h: ApplicationViewBuilder): Html =>
  h.section(
    [h.Class('menu-keys'), h.AriaLabelledBy(MENU_KEYS_TITLE_ID)],
    [
      h.h3(
        [h.Id(MENU_KEYS_TITLE_ID), h.Class('menu-keys-title')],
        ['On the menu'],
      ),
      h.ul(
        [h.Class('help-extra')],
        [
          ...Array.map(HOME_BUTTONS, button =>
            h.li(
              [h.Class('help-extra-item')],
              [
                h.kbd([h.Class('menu-key')], [HOME_KEYS[button].name]),
                ` ${MENU_KEY_ACTIONS[button]}`,
              ],
            ),
          ),
          ...Array.map(KEYED_HAND_CARDS, card =>
            h.li(
              [h.Class('help-extra-item')],
              [
                h.kbd([h.Class('menu-key')], [HAND_KEYS[card].name]),
                ` ${CARD_KEY_ACTIONS[card]}`,
              ],
            ),
          ),
        ],
      ),
    ],
  )

// DIFFICULTY

const freshBadgeView = (
  model: Model,
  difficulty: Difficulty,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  difficulty === 'Nightmare' && model.difficulty.nightmare === 'JustUnlocked'
    ? [h.span([h.Class('difficulty-new'), h.AriaHidden(true)], ['NEW!'])]
    : []

const difficultyLabel = (model: Model, difficulty: Difficulty): string =>
  isLocked(model.difficulty, difficulty)
    ? `${DIFFICULTIES[difficulty].name}, locked. ${NIGHTMARE_LOCK_NOTE}`
    : `${DIFFICULTIES[difficulty].name}: ${DIFFICULTIES[difficulty].blurb}`

const isAskingFirst = (model: Model): boolean =>
  DifficultyCard.isAnyOf(['Asking'])(model.difficultyCard)

const difficultyChoiceView = (
  model: Model,
  difficulty: Difficulty,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): Html => {
  const locked = isLocked(model.difficulty, difficulty)
  const isChosen = difficulty === model.difficulty.chosen
  return h.button(
    [
      ...(isChosen ? renderInfo.initialFocus : []),
      h.Type('button'),
      h.Class('difficulty-choice'),
      h.DataAttribute('difficulty', difficulty),
      ...(isChosen && !isAskingFirst(model)
        ? [h.DataAttribute('chosen', 'Chosen')]
        : []),
      h.AriaLabel(difficultyLabel(model, difficulty)),
      ...(locked ? [h.AriaDisabled(true)] : []),
      h.OnClick(Message.ClickedDifficultyCardButton({ difficulty }), {
        focusSelector: '.game-surface',
        propagation: 'Stop',
      }),
    ],
    [
      skullMeterView(model, difficulty, h),
      h.span(
        [h.Class('difficulty-name')],
        [
          DIFFICULTIES[difficulty].name,
          ...freshBadgeView(model, difficulty, h),
        ],
      ),
      ...(locked
        ? [
            h.span(
              [h.Class('difficulty-unlock'), h.AriaHidden(true)],
              [
                iconView('difficulty-unlock-icon', TROPHY_ICON, h),
                iconView('difficulty-unlock-icon', SKULL_ICONS.Hard, h),
              ],
            ),
          ]
        : []),
    ],
  )
}

type PanelText = Readonly<{ title: string; blurb: string }>

const panelText = (model: Model, panel: MenuPanel): PanelText => {
  if (panel === 'HowToPlay') {
    return {
      title: 'How to play',
      blurb: `Controls for ${helpLabel(model.lastDevice)}.`,
    }
  } else if (panel === 'Difficulty') {
    return isAskingFirst(model)
      ? {
          title: 'How tough are you?',
          blurb: 'Pick a difficulty. You can change it in the lobby.',
        }
      : {
          title: 'Difficulty',
          blurb: 'Pick how tough the zombies are.',
        }
  } else if (panel === 'Calling') {
    return callingPanelText(model)
  } else if (panel === 'WhatsNew') {
    return whatsNewText(model)
  } else if (panel === 'Munchopedia') {
    return munchopediaText(model)
  } else {
    return {
      title: 'Leave this run?',
      blurb:
        'Your guns, cash, and traps stay behind. The zombies keep the house.',
    }
  }
}

const doneButtonView = (
  { closeButton, initialFocus }: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
  focus: 'TakesInitialFocus' | 'LeavesInitialFocus' = 'TakesInitialFocus',
): Html =>
  closeButtonView(
    {
      attributes: [
        ...closeButton,
        ...(focus === 'TakesInitialFocus' ? initialFocus : []),
      ],
      className: 'panel-close',
      label: 'Close',
    },
    h,
  )

const panelBodyView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => {
  if (model.panel === 'HowToPlay') {
    return [
      h.div(
        [h.Class('panel-help'), h.DataAttribute('device', model.lastDevice)],
        howToPlayView(
          model,
          'Interactive',
          h,
          isKeyboard(model) ? Option.some(menuKeysView(h)) : Option.none(),
        ),
      ),
      h.div([h.Class('panel-actions')], [doneButtonView(renderInfo, h)]),
    ]
  } else if (model.panel === 'WhatsNew') {
    return whatsNewBodyView(model, doneButtonView(renderInfo, h), h)
  } else if (model.panel === 'Munchopedia') {
    return munchopediaBodyView(model, doneButtonView(renderInfo, h), h)
  } else if (model.panel === 'Calling') {
    return callingBodyView(
      model,
      renderInfo,
      doneButtonView(renderInfo, h, 'LeavesInitialFocus'),
      h,
    )
  } else if (model.panel === 'Difficulty') {
    return [
      h.div(
        [h.Class('difficulty-choices')],
        Array.map(DIFFICULTY_ORDER, difficulty =>
          difficultyChoiceView(model, difficulty, renderInfo, h),
        ),
      ),
      ...(isAskingFirst(model)
        ? []
        : [
            h.div(
              [h.Class('panel-actions')],
              [doneButtonView(renderInfo, h, 'LeavesInitialFocus')],
            ),
          ]),
    ]
  } else {
    return [
      h.div(
        [h.Class('panel-actions')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('panel-button panel-leave'),
              h.OnClick(Message.ClickedLeaveRunButton(), {
                focusSelector: '.game-surface',
                propagation: 'Stop',
              }),
            ],
            ['Leave'],
          ),
          h.button(
            [
              ...renderInfo.initialFocus,
              h.Type('button'),
              h.Class('panel-button panel-stay'),
              h.AriaKeyshortcuts('Escape'),
              h.OnClick(Message.ClickedStayButton(), { propagation: 'Stop' }),
            ],
            ['Stay'],
          ),
        ],
      ),
    ]
  }
}

// NOTE: show, don't explain. How to play and the difficulty
// picker by PLAY speak through their icons, so their blurb is only read
// aloud.
const isBlurbShown = (model: Model): boolean =>
  model.panel === 'WhatsNew' ||
  model.panel === 'Munchopedia' ||
  model.panel === 'LeaveRun' ||
  (model.panel === 'Difficulty' && isAskingFirst(model))

const panelView = (
  model: Model,
  renderInfo: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => {
  const text = panelText(model, model.panel)
  return [
    h.h2([...renderInfo.title, h.Class('panel-title')], [text.title]),
    h.p(
      [
        ...renderInfo.description,
        h.Class(isBlurbShown(model) ? 'panel-blurb' : 'panel-blurb sr-only'),
      ],
      [text.blurb],
    ),
    ...panelBodyView(model, renderInfo, h),
  ]
}

export const menuPanelView = (model: Model, h: ApplicationViewBuilder): Html =>
  dialogShell(
    {
      dialog: model.panelDialog,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel',
      dialogAttributes: [h.DataAttribute('panel', model.panel)],
      panelView: renderInfo => panelView(model, renderInfo, h),
      binding: PanelDialogBinding,
    },
    h,
  )
