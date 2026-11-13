import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { PROP_ICONS } from '../../art/callingArt'
import {
  DARE_ICON_URLS,
  DARE_SILHOUETTE_URLS,
  JOURNAL_ICON_URL,
} from '../../art/dareArt'
import { PADLOCK_ICON } from '../../art/icons'
import { maybeRoomIcon } from '../../art/roomIcons'
import { spriteImage } from '../../art/sprite'
import { Calling } from '../../shared/playerData'
import { iconView } from '../../ui/menuParts'
import type { DareKind } from '../../world/dare/dareSchema'
import { type MilestoneId, maybeOpenerOf } from '../../world/dare/milestones'
import {
  CALLING_NAMES,
  DARE_LINES,
  DARE_NAMES,
  MILESTONE_HINTS,
  STORY_TITLES,
} from '../../world/names'
import type { ViewInputs } from './block'
import type { MunchopediaViewBuilder } from './composition'
import {
  HERO_REASONS,
  JOURNAL_ROOMS,
  JOURNAL_TAB_NAMES,
  JOURNAL_THINGS,
  JournalTab,
  STORY_ORDER,
  STORY_PAGES,
  ThingStanding,
  firstStoryPage,
  isFreshPage,
  isHeroKnown,
  isPageOpen,
  isRoomKnown,
  isTabFresh,
  journalTabId,
  storyPageNumber,
  thingStanding,
} from './journalPages'
import { Message } from './message'
import { type MunchopediaPage, tabOfPage } from './model'

// The Dare Journal's tabs and its pages past the zombies
// (src/features/munchopedia/journalPages.ts): the things, the rooms, the
// story, and the heroes. Show, don't explain: a page not filled in yet is
// a dim outline and ???, and a locked one wears the padlock and the few
// words of the milestone that opens it.

const UNKNOWN = '???'

const newTagView = (h: MunchopediaViewBuilder): Html =>
  h.span([h.Class('journal-new'), h.AriaHidden(true)], ['NEW'])

const lockView = (milestone: MilestoneId, h: MunchopediaViewBuilder): Html =>
  h.span(
    [h.Class('journal-lock')],
    [
      iconView('journal-lock-icon', PADLOCK_ICON, h),
      MILESTONE_HINTS[milestone],
    ],
  )

// THE TABS

// NOTE: the Story tab opens on the first page new since the journal last
// opened, so a page just reached is the one read first.
const tabMessage = (tab: JournalTab, inputs: ViewInputs): Message =>
  tab === 'Story'
    ? Message.ClickedStoryPageButton({ page: firstStoryPage(inputs.fresh) })
    : Message.ClickedTabButton({ tab })

const tabsView = (
  page: MunchopediaPage,
  inputs: ViewInputs,
  h: MunchopediaViewBuilder,
): Html => {
  const shown = tabOfPage(page)
  return h.div(
    [h.Class('journal-tabs'), h.Role('group'), h.AriaLabel('Pages')],
    Array.map(JournalTab.literals, tab =>
      h.button(
        [
          h.Type('button'),
          h.Id(journalTabId(tab)),
          h.Class('journal-tab'),
          h.AriaPressed(tab === shown ? 'true' : 'false'),
          h.OnClick(tabMessage(tab, inputs), { propagation: 'Stop' }),
        ],
        [
          JOURNAL_TAB_NAMES[tab],
          ...(isTabFresh(inputs.fresh, tab) ? [newTagView(h)] : []),
        ],
      ),
    ),
  )
}

// THINGS

const thingTileView = (
  inputs: ViewInputs,
  kind: DareKind,
  h: MunchopediaViewBuilder,
): Html => {
  const standing = thingStanding(inputs, kind)
  const isFound = ThingStanding.isAnyOf(['Found'])(standing)
  return h.keyed('li')(
    kind,
    [h.Class('journal-card'), h.DataAttribute('standing', standing._tag)],
    [
      iconView(
        'journal-card-icon',
        isFound ? DARE_ICON_URLS[kind] : DARE_SILHOUETTE_URLS[kind],
        h,
      ),
      h.span(
        [h.Class('journal-card-name')],
        [isFound ? DARE_NAMES[kind] : UNKNOWN],
      ),
      ...ThingStanding.match(standing, {
        Found: () => [
          h.span([h.Class('journal-card-line')], [DARE_LINES[kind]]),
        ],
        Open: () => [],
        Locked: ({ milestone }) => [lockView(milestone, h)],
      }),
      ...(Option.exists(maybeOpenerOf(kind), id =>
        isFreshPage(inputs.fresh, id),
      )
        ? [newTagView(h)]
        : []),
    ],
  )
}

const thingsView = (inputs: ViewInputs, h: MunchopediaViewBuilder): Html =>
  h.ul(
    [h.Class('journal-grid'), h.AriaLabel('Things')],
    Array.map(JOURNAL_THINGS, kind => thingTileView(inputs, kind, h)),
  )

// ROOMS

const roomPictureView = (id: string, h: MunchopediaViewBuilder): Html =>
  Option.match(Option.flatMap(maybeRoomIcon(id), spriteImage), {
    onNone: () => h.span([h.Class('journal-card-icon')]),
    onSome: image =>
      h.img([
        h.Class('journal-card-icon journal-room-icon'),
        h.Src(image.src),
        h.Alt(''),
      ]),
  })

const roomsView = (inputs: ViewInputs, h: MunchopediaViewBuilder): Html =>
  h.ul(
    [h.Class('journal-grid'), h.AriaLabel('Rooms')],
    Array.map(JOURNAL_ROOMS, room => {
      const isKnown = isRoomKnown(inputs.journal, room.id)
      return h.keyed('li')(
        room.id,
        [
          h.Class('journal-card'),
          h.DataAttribute('standing', isKnown ? 'Found' : 'Open'),
        ],
        [
          roomPictureView(room.id, h),
          h.span(
            [h.Class('journal-card-name')],
            [isKnown ? room.name : UNKNOWN],
          ),
          ...(isKnown
            ? [h.span([h.Class('journal-card-line')], [room.line])]
            : []),
        ],
      )
    }),
  )

// STORY

const pageButtonView = (
  inputs: ViewInputs,
  shown: MilestoneId,
  id: MilestoneId,
  h: MunchopediaViewBuilder,
): Html => {
  const isOpen = isPageOpen(inputs.journal, id)
  const number = storyPageNumber(id)
  return h.button(
    [
      h.Type('button'),
      h.Class('journal-page-button'),
      h.DataAttribute('open', isOpen ? 'true' : 'false'),
      h.AriaPressed(id === shown ? 'true' : 'false'),
      h.AriaLabel(
        isOpen
          ? `Page ${number}, ${STORY_TITLES[id]}`
          : `Page ${number}, locked`,
      ),
      h.OnClick(Message.ClickedStoryPageButton({ page: id }), {
        propagation: 'Stop',
      }),
    ],
    [
      isOpen ? `${number}` : iconView('journal-lock-icon', PADLOCK_ICON, h),
      ...(isFreshPage(inputs.fresh, id) ? [newTagView(h)] : []),
    ],
  )
}

const storyPageView = (
  inputs: ViewInputs,
  id: MilestoneId,
  h: MunchopediaViewBuilder,
): Html => {
  const isOpen = isPageOpen(inputs.journal, id)
  const page = STORY_PAGES[id]
  return h.article(
    [
      h.Class('journal-page'),
      h.DataAttribute('open', isOpen ? 'true' : 'false'),
    ],
    isOpen
      ? [
          h.h3([h.Class('journal-page-title')], [STORY_TITLES[id]]),
          h.p([h.Class('journal-page-source')], [page.source]),
          ...Array.map(page.lines, line =>
            h.p([h.Class('journal-page-line')], [line]),
          ),
        ]
      : [
          iconView('journal-page-icon', JOURNAL_ICON_URL, h),
          h.h3(
            [h.Class('journal-page-title')],
            [`Page ${storyPageNumber(id)}`],
          ),
          lockView(id, h),
        ],
  )
}

const storyView = (
  inputs: ViewInputs,
  shown: MilestoneId,
  h: MunchopediaViewBuilder,
): Html =>
  h.div(
    [h.Class('journal-story')],
    [
      h.div(
        [
          h.Class('journal-page-buttons'),
          h.Role('group'),
          h.AriaLabel('Story pages'),
        ],
        Array.map(STORY_ORDER, id => pageButtonView(inputs, shown, id, h)),
      ),
      storyPageView(inputs, shown, h),
    ],
  )

// HEROES

const heroesView = (inputs: ViewInputs, h: MunchopediaViewBuilder): Html =>
  h.ul(
    [h.Class('journal-grid journal-heroes'), h.AriaLabel('Heroes')],
    Array.map(Calling.literals, calling => {
      const isKnown = isHeroKnown(inputs.journal, calling)
      return h.keyed('li')(
        calling,
        [
          h.Class('journal-card'),
          h.DataAttribute('standing', isKnown ? 'Found' : 'Open'),
        ],
        [
          iconView('journal-card-icon', PROP_ICONS[calling], h),
          h.span([h.Class('journal-card-name')], [CALLING_NAMES[calling]]),
          h.span(
            [h.Class('journal-card-line')],
            [isKnown ? HERO_REASONS[calling] : UNKNOWN],
          ),
        ],
      )
    }),
  )

// NOTE: the tab strip over every page, and the pages past the zombies.
export const journalPageViews = {
  tabs: tabsView,
  things: thingsView,
  rooms: roomsView,
  story: storyView,
  heroes: heroesView,
}
