import { Array, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { PROP_ICONS } from '../../art/callingArt'
import {
  DARE_ICON_URLS,
  DARE_SILHOUETTE_URLS,
  JOURNAL_ICON_URL,
} from '../../art/dareArt'
import { PADLOCK_ICON } from '../../art/icons'
import { maybeRoomIcon } from '../../art/roomIcons'
import { spriteImage } from '../../art/sprite'
import { isHeroStoryOpen } from '../../domain/mastery'
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
import {
  HERO_REASONS,
  HERO_STORIES,
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
import { type MunchopediaProps, tabOfPage } from './model'

type H = Html.H<Message>
type Content = View.Content<Message>

// The Dare Journal's tabs and its pages past the zombies
// (src/features/munchopedia/journalPages.ts): the things, the rooms, the
// story, and the heroes. Show, don't explain: a page not filled in yet is
// a dim outline and ???, and a locked one wears the padlock and the few
// words of the milestone that opens it.

const UNKNOWN = '???'

const newTagView = (h: H): Content =>
  h.span.class('journal-new').attr('aria-hidden', 'true').children('NEW')

const lockView = (milestone: MilestoneId, h: H): Content =>
  h.span
    .class('journal-lock')
    .children(
      iconView('journal-lock-icon', PADLOCK_ICON, h),
      MILESTONE_HINTS[milestone],
    )

// THE TABS

// NOTE: the Story tab opens on the first page new since the journal last
// opened, so a page just reached is the one read first.
const tabMessage = (tab: JournalTab, props: MunchopediaProps): Message =>
  tab === 'Story'
    ? Message.ClickedStoryPageButton({ page: firstStoryPage(props.fresh) })
    : Message.ClickedTabButton({ tab })

const tabsView = (props: MunchopediaProps, h: H): Content => {
  const shown = tabOfPage(props.page)
  return h.div
    .class('journal-tabs')
    .attr('role', 'group')
    .attr('aria-label', 'Pages')
    .children(
      Array.map(JournalTab.literals, tab =>
        h.button
          .attr('type', 'button')
          .id(journalTabId(tab))
          .class('journal-tab')
          .attr('aria-pressed', String(tab === shown ? 'true' : 'false'))
          .on('click', tabMessage(tab, props))
          .children(
            JOURNAL_TAB_NAMES[tab],
            ...(isTabFresh(props.fresh, tab) ? [newTagView(h)] : []),
          ),
      ),
    )
}

// THINGS

const thingTileView = (
  props: MunchopediaProps,
  kind: DareKind,
  h: H,
): Content => {
  const standing = thingStanding(props, kind)
  const isFound = ThingStanding.isAnyOf(['Found'])(standing)
  return h.li
    .key(kind)
    .class('journal-card')
    .attr('data-standing', standing._tag)
    .children(
      iconView(
        'journal-card-icon',
        isFound ? DARE_ICON_URLS[kind] : DARE_SILHOUETTE_URLS[kind],
        h,
      ),
      h.span
        .class('journal-card-name')
        .children(isFound ? DARE_NAMES[kind] : UNKNOWN),
      ...ThingStanding.match(standing, {
        Found: () => [
          h.span.class('journal-card-line').children(DARE_LINES[kind]),
        ],
        Open: () => [],
        Locked: ({ milestone }) => [lockView(milestone, h)],
      }),
      ...(Option.exists(maybeOpenerOf(kind), id => isFreshPage(props.fresh, id))
        ? [newTagView(h)]
        : []),
    )
}

const thingsView = (props: MunchopediaProps, h: H): Content =>
  h.ul
    .class('journal-grid')
    .attr('aria-label', 'Things')
    .children(Array.map(JOURNAL_THINGS, kind => thingTileView(props, kind, h)))

// ROOMS

const roomPictureView = (id: string, h: H): Content =>
  Option.match(Option.flatMap(maybeRoomIcon(id), spriteImage), {
    onNone: () => h.span.class('journal-card-icon'),
    onSome: image =>
      h.img
        .class('journal-card-icon journal-room-icon')
        .attr('src', image.src)
        .attr('alt', ''),
  })

const roomsView = (props: MunchopediaProps, h: H): Content =>
  h.ul
    .class('journal-grid')
    .attr('aria-label', 'Rooms')
    .children(
      Array.map(JOURNAL_ROOMS, room => {
        const isKnown = isRoomKnown(props.journal, room.id)
        return h.li
          .key(room.id)
          .class('journal-card')
          .attr('data-standing', isKnown ? 'Found' : 'Open')
          .children(
            roomPictureView(room.id, h),
            h.span
              .class('journal-card-name')
              .children(isKnown ? room.name : UNKNOWN),
            ...(isKnown
              ? [h.span.class('journal-card-line').children(room.line)]
              : []),
          )
      }),
    )

// STORY

const pageButtonView = (
  props: MunchopediaProps,
  shown: MilestoneId,
  id: MilestoneId,
  h: H,
): Content => {
  const isOpen = isPageOpen(props.journal, id)
  const number = storyPageNumber(id)
  return h.button
    .attr('type', 'button')
    .class('journal-page-button')
    .attr('data-open', isOpen ? 'true' : 'false')
    .attr('aria-pressed', String(id === shown ? 'true' : 'false'))
    .attr(
      'aria-label',
      isOpen ? `Page ${number}, ${STORY_TITLES[id]}` : `Page ${number}, locked`,
    )
    .on('click', Message.ClickedStoryPageButton({ page: id }))
    .children(
      isOpen ? `${number}` : iconView('journal-lock-icon', PADLOCK_ICON, h),
      ...(isFreshPage(props.fresh, id) ? [newTagView(h)] : []),
    )
}

const storyPageView = (
  props: MunchopediaProps,
  id: MilestoneId,
  h: H,
): Content => {
  const isOpen = isPageOpen(props.journal, id)
  const page = STORY_PAGES[id]
  return h.article
    .class('journal-page')
    .attr('data-open', isOpen ? 'true' : 'false')
    .children(
      isOpen
        ? [
            h.h3.class('journal-page-title').children(STORY_TITLES[id]),
            h.p.class('journal-page-source').children(page.source),
            ...Array.map(page.lines, line =>
              h.p.class('journal-page-line').children(line),
            ),
          ]
        : [
            iconView('journal-page-icon', JOURNAL_ICON_URL, h),
            h.h3
              .class('journal-page-title')
              .children(`Page ${storyPageNumber(id)}`),
            lockView(id, h),
          ],
    )
}

const storyView = (
  props: MunchopediaProps,
  shown: MilestoneId,
  h: H,
): Content =>
  h.div.class('journal-story').children(
    h.div
      .class('journal-page-buttons')
      .attr('role', 'group')
      .attr('aria-label', 'Story pages')
      .children(
        Array.map(STORY_ORDER, id => pageButtonView(props, shown, id, h)),
      ),
    storyPageView(props, shown, h),
  )

// HEROES

const heroesView = (props: MunchopediaProps, h: H): Content =>
  h.ul
    .class('journal-grid journal-heroes')
    .attr('aria-label', 'Heroes')
    .children(
      Array.map(Calling.literals, calling => {
        const isKnown = isHeroKnown(props.journal, calling)
        return h.li
          .key(calling)
          .class('journal-card')
          .attr('data-standing', isKnown ? 'Found' : 'Open')
          .children(
            iconView('journal-card-icon', PROP_ICONS[calling], h),
            h.span.class('journal-card-name').children(CALLING_NAMES[calling]),
            h.span
              .class('journal-card-line')
              .children(isKnown ? HERO_REASONS[calling] : UNKNOWN),
            ...(isHeroStoryOpen(props.mastery, calling)
              ? [
                  h.span
                    .class('journal-card-line journal-card-story')
                    .children(HERO_STORIES[calling]),
                ]
              : []),
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
