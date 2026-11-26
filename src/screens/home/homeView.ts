import { Array, Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import { COOP_ICON } from '../../art/coopIcons'
import {
  AIM_ICON,
  CHARACTER_ICON,
  COFFEE_CUP_ICON,
  COFFEE_STEAM_ICON,
  FULLSCREEN_ICON,
  GITHUB_MARK_ICON,
  HAND_ICON,
  HELP_ICON,
  MUNCHOPEDIA_ICON,
  NEWS_ICON,
  PLAY_ICON,
  SETTINGS_ICON,
  SKIP_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
  TROPHY_ICON,
  TURN_PHONE_ICON,
} from '../../art/icons'
import { DifficultyCard } from '../../domain/clientSchema'
import { hasNewJournalPage } from '../../domain/journal'
import { isEndScreen, isOnHome } from '../../domain/run'
import { hasUnseenLook } from '../../domain/unlocks'
import { IS_COOP_RELEASED } from '../../features/coop/release'
import type {
  HandCard,
  HomeButton,
  MenuPanel,
} from '../../features/home/homeSchema'
import { HomeMessage } from '../../features/home/message'
import { padDiagramView } from '../../features/menus/padDiagram'
import { helpLabel, howToPlayView } from '../../features/menus/pauseHelp'
import {
  missionsPanelView,
  missionsText,
} from '../../features/missions/missionCard'
import { tabOfPage } from '../../features/munchopedia/model'
import {
  ENTRY_COUNT,
  discoveredKinds,
  entryName,
  hasUnopenedEntry,
  munchopediaText,
} from '../../features/munchopedia/munchopedia'
import { hasNewProof } from '../../features/proof/proof'
import {
  whatsNewBodyView,
  whatsNewText,
} from '../../features/whatsNew/whatsNewView'
import { DeviceMessage } from '../../platform/message'
import type { TutorialChoice } from '../../shared/nameKeys'
import type { Difficulty } from '../../shared/playerData'
import { closeButtonView } from '../../ui/cornerButtons'
import type { DialogParts } from '../../ui/dialog'
import {
  iconView,
  isKeyboard,
  keyCapView,
  skullFaceViews,
} from '../../ui/menuParts'
import { rankChipView } from '../../ui/rankBadgeView'
import { rankOf, totalPointsOf } from '../../world/heroes/rank'
import {
  JOURNAL_NAME,
  MULTIPLAYER_NAME,
  PROOF_NAME,
  TUTORIAL_CHOICE_NAMES,
} from '../../world/names'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
  isLocked,
} from '../../world/run/difficulty'
import { beatCardView } from './beatCard'
import { topLeftView } from './bestsView'
import {
  HAND_CARDS,
  HAND_KEYS,
  HOME_BUTTONS,
  HOME_KEYS,
  KEYED_HAND_CARDS,
  type KeyedHandCard,
  type LinkHandCard,
  SOURCE_URL,
  handCardId,
  isLinkHandCard,
  isNewsUnseen,
  isTurnHintShown,
  steppedHandCard,
} from './home'
import { homeButton, homeFocusAttrs, keyBadgeView } from './homeAttributes'
import { installTileView } from './installView'
import { updateGiftView } from './updateGift'

// PLAY

// NOTE: show, don't explain. PLAY is the dare your friends hand you, a
// folded napkin card with I DARE YOU scrawled over the play mark, and the
// lobby it opens (src/features/lobby/view.ts) is the card you fill in.
const playButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  homeButton(h.button, 'Play')
    .class('home-play')
    .attr('data-mode', model.home.mode)
    .attr('aria-label', 'Play')
    .on('click', HomeMessage.ClickedPlayButton())
    .children(
      h.span
        .class('home-play-face')
        .children(
          h.span
            .class('home-play-dare')
            .attr('aria-hidden', 'true')
            .children('I DARE YOU'),
          iconView('home-play-icon', PLAY_ICON, h),
        ),
      ...keyBadgeView(model, 'Play', h),
    )

// NOTE: a difficulty reads as a row of four skulls: as many lit as the
// level, each in that level's color and face, and the fourth dim with a
// padlock badge while Nightmare is locked.
const skullMeterView = (
  model: Model,
  difficulty: Difficulty,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const lit = Array.findFirstIndex(
    DIFFICULTY_ORDER,
    level => level === difficulty,
  )
  const litCount = Option.getOrElse(lit, () => 0) + 1
  return h.span
    .class('skull-meter')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(DIFFICULTY_ORDER, (level, index) =>
        level === 'Nightmare' && isLocked(model.difficulty, 'Nightmare')
          ? h.span
              .class('skull-slot')
              .children(
                skullFaceViews(
                  { className: 'skull', icon: SKULL_OFF_ICON, isLocked: true },
                  h,
                ),
              )
          : iconView(
              index < litCount ? 'skull skull-lit' : 'skull',
              index < litCount ? SKULL_ICONS[difficulty] : SKULL_OFF_ICON,
              h,
            ),
      ),
    )
}

// NOTE: CO-OP is two heads, pink and teal, by PLAY, open from the first
// visit (MULTIPLAYER.md, decision 14).
const coopButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  homeButton(h.button, 'Coop')
    .class('home-coop')
    .attr('aria-label', 'Co-op: play with friends')
    .on('click', HomeMessage.ClickedCoopButton())
    .children(
      iconView('home-coop-icon', COOP_ICON, h),
      h.span.class('home-coop-label').children(MULTIPLAYER_NAME),
      ...keyBadgeView(model, 'Coop', h),
    )

const playClusterView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .class('home-play-cluster')
    .attr('role', 'group')
    .attr('aria-label', 'Play')
    .children(
      playButtonView(model, h),
      IS_COOP_RELEASED ? coopButtonView(model, h) : null,
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
    title: 'JOURNAL',
    ariaLabel: `${JOURNAL_NAME}: the zombies, things, rooms, story, and heroes`,
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
  Proof: {
    title: 'PROOF',
    ariaLabel: `${PROOF_NAME}: everything you brought out of the manor`,
    icon: TROPHY_ICON,
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

const CARD_MESSAGES: Readonly<Record<KeyedHandCard, HomeMessage>> = {
  Character: HomeMessage.ClickedCharacterButton(),
  Munchopedia: HomeMessage.ClickedMunchopediaButton(),
  WhatsNew: HomeMessage.ClickedWhatsNewButton(),
  HowToPlay: HomeMessage.ClickedHowToPlayButton(),
  Proof: HomeMessage.ClickedProofButton(),
}

const hasNews = (model: Model, card: HandCard): boolean => {
  if (card === 'Character') {
    return hasUnseenLook(rankOf(totalPointsOf(model.rank)), model.seenUnlocks)
  } else if (card === 'WhatsNew') {
    return isNewsUnseen(model)
  } else if (card === 'Munchopedia') {
    return hasUnopenedEntry(model) || hasNewJournalPage(model)
  } else if (card === 'Proof') {
    return hasNewProof(model)
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
  Munchopedia: `the ${JOURNAL_NAME}`,
  WhatsNew: "What's new",
  HowToPlay: 'How to play',
  Proof: 'Proof',
  Code: 'the code',
}

const manorAriaLabel = (model: Model): string =>
  Array.match(newsCards(model), {
    onEmpty: () =>
      'More: character, journal, what is new, how to play, and proof',
    onNonEmpty: cards =>
      `More: character, journal, what is new, how to play, and proof. Something new in ${Array.join(
        Array.map(cards, card => NEWS_NAMES[card]),
        ' and ',
      )}`,
  })

// NOTE: the badges of the cards inside bubble up to the closed MANOR button
// as little pips, each the card's own icon with a red dot, so What's New and
// the Munchopedia still show their news without opening the hand.
const manorPipsView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Array.match(newsCards(model), {
    onEmpty: () => null,
    onNonEmpty: cards =>
      h.span
        .class('manor-pips')
        .attr('aria-hidden', 'true')
        .children(
          Array.map(cards, card =>
            h.span
              .class('manor-pip')
              .attr('data-card', card)
              .children(iconView('manor-pip-icon', CARD_LOOKS[card].icon, h)),
          ),
        ),
  })

const manorButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  homeButton(h.button, 'Manor')
    .class('home-manor')
    .attr('aria-label', manorAriaLabel(model))
    .attr('aria-haspopup', 'dialog')
    .on('click', HomeMessage.ClickedManorButton())
    .children(
      iconView('home-manor-icon', HAND_ICON, h),
      h.span.class('home-manor-label').children('MORE'),
      manorPipsView(model, h),
      ...keyBadgeView(model, 'Manor', h),
    )

const handKeyMessage = (
  card: HandCard,
  key: string,
): Option.Option<HomeMessage> => {
  const step =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0
  return step === 0
    ? Option.none()
    : Option.map(steppedHandCard(HAND_CARDS, card, step), next =>
        HomeMessage.SteppedHandFocus({ card: next }),
      )
}

// NOTE: the card button stays square to the screen so a tap anywhere in it
// lands, and only its face tilts into the fan. The face takes no taps.
const cardBodyView = (
  model: Model,
  card: HandCard,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => [
  h.span.class('hand-card-face').children(
    h.span
      .class('hand-card-art')
      .children(iconView('hand-card-icon', CARD_LOOKS[card].icon, h)),
    h.span.class('hand-card-title').children(CARD_LOOKS[card].title),
    ...Option.match(maybeCardTally(model, card), {
      onNone: () => [],
      onSome: tally => [
        h.span
          .class('hand-card-tally')
          .style({
            '--found': `${discoveredKinds(model.bests.killsByKind).length / ENTRY_COUNT}`,
          })
          .children(tally),
      ],
    }),
    ...(hasNews(model, card)
      ? [
          h.span
            .class('hand-card-new')
            .attr('aria-hidden', 'true')
            .children('NEW'),
        ]
      : []),
    ...(isLinkHandCard(card) ? [] : keyCapView(model, HAND_KEYS[card].cap, h)),
  ),
]

const LINK_CARD_URLS: Readonly<Record<LinkHandCard, string>> = {
  Code: SOURCE_URL,
}

// NOTE: what a hand card wears, a button or the CODE link: its id, its
// place in the fan, its label and key as attributes, and the arrow keys
// stepping focus between the cards (the browser's own scroll held back only
// for those). Each card chains them on its own concrete builder.
const handCardAttrs = (
  model: Model,
  card: HandCard,
): Readonly<Record<string, string | undefined>> => ({
  id: handCardId(card),
  class: 'hand-card',
  'data-card': card,
  'aria-label': cardAriaLabel(model, card),
  'aria-keyshortcuts': isLinkHandCard(card) ? undefined : HAND_KEYS[card].name,
})

const handKeyOf =
  (card: HandCard) =>
  ({ key }: { readonly key: string }) =>
    Option.getOrUndefined(handKeyMessage(card, key))

const handCardView = (
  model: Model,
  card: HandCard,
  index: number,
  count: number,
  parts: DialogParts,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const fan = { '--i': `${index}`, '--n': `${count}` }
  const body = cardBodyView(model, card, h)
  if (isLinkHandCard(card)) {
    const link = h.a
      .attrs(handCardAttrs(model, card))
      .style(fan)
      .on('keydown', handKeyOf(card), { preventDefault: true })
      .attr('href', LINK_CARD_URLS[card])
      .attr('target', '_blank')
      .attr('rel', 'noopener noreferrer')
    return h.li
      .class('hand-slot')
      .children((index === 0 ? parts.initialFocus(link) : link).children(body))
  }
  const button = h.button
    .attrs(handCardAttrs(model, card))
    .style(fan)
    .on('keydown', handKeyOf(card), { preventDefault: true })
    .attr('type', 'button')
    .attr('aria-haspopup', 'dialog')
    .on('click', CARD_MESSAGES[card])
  return h.li
    .class('hand-slot')
    .children(
      (index === 0 ? parts.initialFocus(button) : button).children(body),
    )
}

const HAND_TITLE = 'The manor'

const handView = (
  model: Model,
  parts: DialogParts,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => {
  const cards = HAND_CARDS
  return [
    parts.title(h.h2).class('sr-only').children(HAND_TITLE),
    parts
      .description(h.p)
      .class('sr-only')
      .children('Pick a card. Arrow keys move between them.'),
    h.ul
      .class('hand-cards')
      .children(
        Array.map(cards, (card, index) =>
          handCardView(model, card, index, cards.length, parts, h),
        ),
      ),
    closeButtonView(
      {
        button: parts.close(h.button),
        className: 'hand-close',
        label: 'Close',
      },
      h,
    ),
  ]
}

// STAGE

// NOTE: the player walks on the spot in the middle of the stage, drawn on
// the canvas by screens.ts. This button sits over them, so a tap on your
// character opens the picker. The hand's Character card is the one a
// keyboard or a screen reader reaches.
const heroButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.button
    .attr('type', 'button')
    .class('home-hero')
    .attr('tabindex', String(-1))
    .attr('aria-label', 'Your character: change how you look')
    .attr('aria-haspopup', 'dialog')
    .on('click', HomeMessage.ClickedCharacterButton())
    .children(rankChipView(model, h))

// CORNER

const fullscreenButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  model.settings.screenFit === 'Fullscreen'
    ? h.button
        .attr('type', 'button')
        .class('home-corner-button home-fullscreen')
        .attr('aria-label', 'Full screen')
        .attr(
          'aria-pressed',
          String(model.settings.fullscreen === 'On' ? 'true' : 'false'),
        )
        .on('click', DeviceMessage.ClickedFullscreenButton())
        .children(iconView('home-corner-icon', FULLSCREEN_ICON, h))
    : null

// NOTE: the gear sits in the corner itself, the coffee just inside it, and
// full screen, where the browser can do it, inside that.
const settingsButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  homeButton(h.button, 'Settings')
    .class('home-corner-button home-settings')
    .attr('aria-label', 'Settings')
    .attr('aria-haspopup', 'dialog')
    .on('click', HomeMessage.ClickedSettingsButton())
    .children(
      iconView('home-corner-icon', SETTINGS_ICON, h),
      ...keyBadgeView(model, 'Settings', h),
    )

// NOTE: Buy Rattles a coffee, just left of the gear: a pixel mug with
// steam rising from it. It is a real link, so the browser opens the tip
// jar from the tap itself and no popup blocker stops it. Its click still
// sends ClickedSupportButton for the tap sound, and never prevents the link.
const COFFEE_LABEL = 'Buy Rattles a coffee'

const STEAM_WISPS = 2

const supportButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(model.release.maybeSupportUrl, {
    onNone: () => null,
    onSome: url =>
      h.a
        .attrs(homeFocusAttrs('Support'))
        .on('focus', HomeMessage.FocusedHomeButton({ button: 'Support' }))
        .on('blur', HomeMessage.BlurredHomeButton())
        .class('home-corner-button home-support')
        .attr('href', url)
        .attr('target', '_blank')
        .attr('rel', 'noopener noreferrer')
        .attr('aria-label', `${COFFEE_LABEL}. Opens in a new tab`)
        .attr('title', COFFEE_LABEL)
        .on('click', HomeMessage.ClickedSupportButton())
        .children(
          ...Array.makeBy(STEAM_WISPS, wisp =>
            h.span
              .class('home-support-steam')
              .attr('aria-hidden', 'true')
              .style({
                '--wisp': `${wisp}`,
                ...pixelArtStyle(COFFEE_STEAM_ICON),
              }),
          ),
          iconView('home-corner-icon home-support-cup', COFFEE_CUP_ICON, h),
          ...keyBadgeView(model, 'Support', h),
        ),
  })

// NEW ENTRY

const newEntryText = (model: Model): Option.Option<string> =>
  Option.map(Array.head(model.home.newEntries), kind =>
    model.home.newEntries.length > 1
      ? `${entryName(kind)} and ${model.home.newEntries.length - 1} more`
      : entryName(kind),
  )

const newEntryButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(Array.head(model.home.newEntries), {
    onNone: () => null,
    onSome: kind =>
      h.button
        .attr('type', 'button')
        .class('new-entry')
        .attr(
          'aria-label',
          `New Munchopedia entry: ${Option.getOrElse(newEntryText(model), () => '')}. Open it`,
        )
        .on('click', HomeMessage.ClickedNewEntryButton({ kind }))
        .children(
          h.span.class('new-entry-flag').children('NEW ENTRY!'),
          h.span
            .class('new-entry-name')
            .children(Option.getOrElse(newEntryText(model), () => '')),
        ),
  })

// NOTE: the end screens only tell. The entry opens from the menu.
export const newEntryNoticeView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isEndScreen(model.phase)
      ? Option.match(newEntryText(model), {
          onNone: () => null,
          onSome: text =>
            h.div
              .class('new-entry new-entry-notice')
              .attr('role', 'status')
              .children(
                h.span.class('new-entry-flag').children('NEW ENTRY!'),
                h.span.class('new-entry-name').children(text),
                h.span
                  .class('new-entry-where')
                  .children('In the Munchopedia on the menu'),
              ),
        })
      : null,
)

// TURN HINT

export const TURN_HINT_TEXT = 'Turn sideways to see more'

// NOTE: portrait zooms in on part of the room, so the first time a phone
// held upright is on the home menu it gets a nudge to turn: the tipping
// phone and a short line. A tap on it, or turning the phone, dismisses it
// for good (the save keeps that). Only the pill takes taps, so it never
// blocks a button. isPortrait is false on a keyboard and mouse.
const turnHintView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  isTurnHintShown(model)
    ? h.button
        .attr('type', 'button')
        .class('home-turn-hint')
        .attr('tabindex', String(-1))
        .attr('aria-label', TURN_HINT_TEXT)
        .on('click', HomeMessage.ClickedTurnHint())
        .children(
          iconView('home-turn-icon', TURN_PHONE_ICON, h),
          h.span.class('home-turn-text').children(TURN_HINT_TEXT),
        )
    : null

// HOME MENU

export const homeMenuView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isOnHome(model.phase)
      ? h.div
          .class('home-frame')
          .attr('data-device', model.lastDevice)
          .attr('data-fit', model.settings.screenFit)
          .children(
            h.div
              .class('home-stage')
              .children(
                playClusterView(model, h),
                manorButtonView(model, h),
                topLeftView(model, h),
                heroButtonView(model, h),
                newEntryButtonView(model, h),
                beatCardView(model, h),
                turnHintView(model, h),
                h.div
                  .class('home-corner')
                  .children(
                    h.div
                      .class('home-corner-row')
                      .children(
                        fullscreenButtonView(model, h),
                        supportButtonView(model, h),
                        settingsButtonView(model, h),
                      ),
                    h.div
                      .class('home-corner-row')
                      .children(
                        updateGiftView(model, h),
                        installTileView(model, h),
                      ),
                  ),
              ),
          )
      : null,
)

// PANELS

const MENU_KEYS_TITLE_ID = 'menu-keys-title'

const MENU_KEY_ACTIONS: Readonly<Record<HomeButton, string>> = {
  Play: 'play',
  Coop: 'co-op',
  Manor: 'manor',
  Bests: 'journal',
  Missions: 'missions',
  Support: 'coffee',
  Settings: 'settings',
}

const CARD_KEY_ACTIONS: Readonly<Record<KeyedHandCard, string>> = {
  Character: 'character',
  Munchopedia: 'journal',
  WhatsNew: "what's new",
  HowToPlay: 'how to play',
  Proof: 'proof',
}

const menuKeysView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.section
    .class('menu-keys')
    .attr('aria-labelledby', MENU_KEYS_TITLE_ID)
    .children(
      h.h3
        .id(MENU_KEYS_TITLE_ID)
        .class('menu-keys-title')
        .children('On the menu'),
      h.ul.class('help-extra').children(
        ...Array.map(
          Array.filter(HOME_BUTTONS, button => button !== 'Bests'),
          button =>
            h.li
              .class('help-extra-item')
              .children(
                h.kbd.class('menu-key').children(HOME_KEYS[button].name),
                ` ${MENU_KEY_ACTIONS[button]}`,
              ),
        ),
        ...Array.map(KEYED_HAND_CARDS, card =>
          h.li
            .class('help-extra-item')
            .children(
              h.kbd.class('menu-key').children(HAND_KEYS[card].name),
              ` ${CARD_KEY_ACTIONS[card]}`,
            ),
        ),
      ),
    )

// DIFFICULTY

const freshBadgeView = (
  model: Model,
  difficulty: Difficulty,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> =>
  difficulty === 'Nightmare' && model.difficulty.nightmare === 'JustUnlocked'
    ? [
        h.span
          .class('difficulty-new')
          .attr('aria-hidden', 'true')
          .children('NEW!'),
      ]
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
  parts: DialogParts,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const locked = isLocked(model.difficulty, difficulty)
  const isChosen = difficulty === model.difficulty.chosen
  return (isChosen ? parts.initialFocus(h.button) : h.button)
    .attr('type', 'button')
    .class('difficulty-choice')
    .attr('data-difficulty', difficulty)
    .attr(
      'data-chosen',
      isChosen && !isAskingFirst(model) ? 'Chosen' : undefined,
    )
    .attr('aria-label', difficultyLabel(model, difficulty))
    .attr('aria-disabled', locked ? 'true' : undefined)
    .on('click', HomeMessage.ClickedDifficultyCardButton({ difficulty }))
    .children(
      skullMeterView(model, difficulty, h),
      h.span
        .class('difficulty-name')
        .children(
          DIFFICULTIES[difficulty].name,
          ...freshBadgeView(model, difficulty, h),
        ),
      ...(locked
        ? [
            h.span
              .class('difficulty-unlock')
              .attr('aria-hidden', 'true')
              .children(
                iconView('difficulty-unlock-icon', TROPHY_ICON, h),
                iconView('difficulty-unlock-icon', SKULL_ICONS.Hard, h),
              ),
          ]
        : []),
    )
}

// NOTE: the first-run card's TUTORIAL or SKIP IT (owner, 2026-11-07): the
// tutorial's aim icon or a skip arrow, each one or two words. TUTORIAL is
// lit until SKIP IT is tapped, and the pick holds until a difficulty starts
// the run.
const TUTORIAL_CHOICES: ReadonlyArray<TutorialChoice> = ['Tutorial', 'Skip']

const TUTORIAL_CHOICE_ICONS: Readonly<Record<TutorialChoice, string>> = {
  Tutorial: AIM_ICON,
  Skip: SKIP_ICON,
}

const TUTORIAL_CHOICE_LABELS: Readonly<Record<TutorialChoice, string>> = {
  Tutorial: 'Play the tutorial',
  Skip: 'Skip the tutorial',
}

// NOTE: a tap on TUTORIAL or SKIP IT hands focus back to the difficulty
// tile the card opened on, so Enter still picks it.
const tutorialChoiceView = (
  chosen: TutorialChoice,
  choice: TutorialChoice,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.button
    .attr('type', 'button')
    .class('tutorial-choice')
    .attr('data-choice', choice)
    .attr('data-state', chosen === choice ? 'Chosen' : 'Other')
    .attr('aria-pressed', chosen === choice ? 'true' : 'false')
    .attr('aria-label', TUTORIAL_CHOICE_LABELS[choice])
    .on('click', HomeMessage.ClickedTutorialChoiceButton({ choice }))
    .children(
      iconView('tutorial-choice-icon', TUTORIAL_CHOICE_ICONS[choice], h),
      h.span
        .class('tutorial-choice-name')
        .children(TUTORIAL_CHOICE_NAMES[choice]),
    )

const tutorialChoicesView = (
  model: Model,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> =>
  DifficultyCard.matchOrElse(
    model.difficultyCard,
    {
      Asking: ({ tutorial }) => [
        h.div
          .class('tutorial-choices')
          .attr('role', 'group')
          .attr('aria-label', 'Tutorial')
          .children(
            Array.map(TUTORIAL_CHOICES, choice =>
              tutorialChoiceView(tutorial, choice, h),
            ),
          ),
      ],
    },
    () => [],
  )

type PanelText = Readonly<{ title: string; blurb: string }>

// NOTE: the shelf speaks through its pictures, so its blurb is only read
// aloud.
const PROOF_TEXT: PanelText = {
  title: PROOF_NAME,
  blurb:
    'Everything you brought out of the manor, a row per difficulty. Tap one for its stamp.',
}

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
  } else if (panel === 'WhatsNew') {
    return whatsNewText(model)
  } else if (panel === 'Munchopedia') {
    return munchopediaText(model)
  } else if (panel === 'Missions') {
    return missionsText(model)
  } else if (panel === 'Proof') {
    return PROOF_TEXT
  } else {
    return {
      title: 'Leave this run?',
      blurb:
        'Your guns, cash, and traps stay behind. The zombies keep the house.',
    }
  }
}

const doneButtonView = (
  parts: DialogParts,
  h: ApplicationViewBuilder,
  focus: 'TakesInitialFocus' | 'LeavesInitialFocus' = 'TakesInitialFocus',
): ApplicationHtml =>
  closeButtonView(
    {
      button:
        focus === 'TakesInitialFocus'
          ? parts.initialFocus(parts.close(h.button))
          : parts.close(h.button),
      className: 'panel-close',
      label: 'Close',
    },
    h,
  )

// NOTE: PLAY TUTORIAL, for a player who wants the lessons again: it starts
// the tutorial's practice run at once, so it asks nothing first. Only at
// home, never over a paused run.
const playTutorialButtonView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.button
    .attr('type', 'button')
    .class('panel-button panel-tutorial')
    .on('click', HomeMessage.ClickedPlayTutorialButton())
    .children(
      iconView('panel-tutorial-icon', AIM_ICON, h),
      h.span.children('Play tutorial'),
    )

// NOTE: under How to play's cards: the menu's keys on a keyboard, the pad
// and its buttons with a controller in hand.
const howToPlayUnder = (
  model: Model,
  h: ApplicationViewBuilder,
): Option.Option<ApplicationHtml> => {
  if (isKeyboard(model)) {
    return Option.some(menuKeysView(h))
  }
  return model.lastDevice === 'Gamepad'
    ? Option.some(padDiagramView(h))
    : Option.none()
}

const panelBodyView = (
  model: Model,
  parts: DialogParts,
  childViews: PanelChildViews,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => {
  if (model.panel === 'HowToPlay') {
    return [
      h.div
        .class('panel-help')
        .attr('data-device', model.lastDevice)
        .children(
          howToPlayView(model, 'Interactive', h, howToPlayUnder(model, h)),
        ),
      h.div
        .class('panel-actions')
        .children(
          ...(isOnHome(model.phase) ? [playTutorialButtonView(h)] : []),
          doneButtonView(parts, h),
        ),
    ]
  } else if (model.panel === 'WhatsNew') {
    return whatsNewBodyView(model, doneButtonView(parts, h), h)
  } else if (model.panel === 'Munchopedia') {
    return [childViews.munchopedia(model, doneButtonView(parts, h), h)]
  } else if (model.panel === 'Proof') {
    return [childViews.proof(model, doneButtonView(parts, h), h)]
  } else if (model.panel === 'Missions') {
    return [missionsPanelView(model, doneButtonView(parts, h), h)]
  } else if (model.panel === 'Difficulty') {
    return [
      ...tutorialChoicesView(model, h),
      h.div
        .class('difficulty-choices')
        .children(
          Array.map(DIFFICULTY_ORDER, difficulty =>
            difficultyChoiceView(model, difficulty, parts, h),
          ),
        ),
      ...(isAskingFirst(model)
        ? []
        : [
            h.div
              .class('panel-actions')
              .children(doneButtonView(parts, h, 'LeavesInitialFocus')),
          ]),
    ]
  } else {
    return [
      h.div
        .class('panel-actions')
        .children(
          h.button
            .attr('type', 'button')
            .class('panel-button panel-leave')
            .on('click', HomeMessage.ClickedLeaveRunButton())
            .children('Leave'),
          parts
            .initialFocus(h.button)
            .attr('type', 'button')
            .class('panel-button panel-stay')
            .attr('aria-keyshortcuts', 'Escape')
            .on('click', HomeMessage.ClickedStayButton())
            .children('Stay'),
        ),
    ]
  }
}

// NOTE: show, don't explain. How to play and the difficulty
// picker by PLAY speak through their icons, so their blurb is only read
// aloud, as is the journal's tally past its Zombies tab. What's New shows its day's title between its page arrows instead.
// NOTE: the Dare Journal's zombie tally shows over its Zombies tab only.
const isBlurbShown = (model: Model): boolean =>
  (model.panel === 'Munchopedia' &&
    tabOfPage(model.munchopediaPage) === 'Zombies') ||
  model.panel === 'LeaveRun' ||
  (model.panel === 'Difficulty' && isAskingFirst(model))

const panelView = (
  model: Model,
  parts: DialogParts,
  childViews: PanelChildViews,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => {
  const text = panelText(model, model.panel)
  return [
    parts.title(h.h2).class('panel-title').children(text.title),
    parts
      .description(h.p)
      .class(isBlurbShown(model) ? 'panel-blurb' : 'panel-blurb sr-only')
      .children(text.blurb),
    ...panelBodyView(model, parts, childViews, h),
  ]
}

// NOTE: the components inside the menu panel, the Munchopedia and the
// Proof Shelf. The root draws them with its props, so it hands their views
// in (src/app/dialogs.ts), each given the panel's Done button for its
// `done` slot.
type PanelChildView = (
  model: Model,
  done: ApplicationHtml,
  h: ApplicationViewBuilder,
) => ApplicationHtml

export type PanelChildViews = Readonly<{
  munchopedia: PanelChildView
  proof: PanelChildView
}>

// NOTE: the menu panel's insides, for the root's panel Dialog
// (src/app/dialogs.ts).
export const menuPanelInsidesView: {
  (
    parts: DialogParts,
    childViews: PanelChildViews,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<ApplicationHtml>
  (
    model: Model,
    parts: DialogParts,
    childViews: PanelChildViews,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(4, panelView)

// NOTE: the MANOR hand's insides, for the root's hand Dialog
// (src/app/dialogs.ts).
export const manorHandInsidesView: {
  (
    parts: DialogParts,
    h: ApplicationViewBuilder,
  ): (model: Model) => ReadonlyArray<ApplicationHtml>
  (
    model: Model,
    parts: DialogParts,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(3, handView)
