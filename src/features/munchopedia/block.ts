import { Effect } from 'effect'

import { Command, Component } from '@effect/ui'
import { Html } from '@effect/ui/html'

import {
  GuideFocusTarget,
  GuideStatus,
  guideFocusId,
  isGuideOpen,
  openedGuide,
  withSection,
} from '../guide/model'
import type { JournalTab } from './journalPages'
import { Message, MunchopediaEvents } from './message'
import { Model, MunchopediaPage, MunchopediaProps, initialModel } from './model'
import { munchopediaView } from './view'

// The Dare Journal in the menu panel. The root owns the page (its blurb
// and NEW ENTRY read it) and hands it down with the facts the pages show;
// a tab, an entry, BACK, or a story page asks for a new page with
// `ChangedPage`, and an entry opened says so with `OpenedEntry`. The shop
// guide on its Shop page (src/features/guide/) is its own: it opens over
// the zombies and goes back. The panel's Done is the `done` slot. Opening
// afresh is the panel mounting it.

// FOCUS

// NOTE: opening the guide puts focus on its BACK; going back puts it on the
// Shop tile that opened it, so the keyboard never lands on nothing. It runs
// once the render the update caused is in, so the button is there.
export const FocusGuideControl = Command.make(
  'FocusGuideControl',
  { args: { target: GuideFocusTarget } },
  ({ target }) =>
    Effect.sync(() => {
      const element = globalThis.document.getElementById(guideFocusId(target))
      if (element instanceof HTMLElement) {
        element.focus()
      }
    }).pipe(Effect.as(Component.noop)),
)

// PAGES

// NOTE: a tab shows its page; the Story tab's button names the page it
// opens on (`ClickedStoryPageButton`).
const TAB_PAGES: Readonly<Record<JournalTab, MunchopediaPage>> = {
  Zombies: MunchopediaPage.List(),
  Things: MunchopediaPage.Things(),
  Rooms: MunchopediaPage.Rooms(),
  Story: MunchopediaPage.Story({ page: 'FirstFind' }),
  Heroes: MunchopediaPage.Heroes(),
}

const MunchopediaDef = Html.component({
  name: 'Munchopedia',
  props: MunchopediaProps,
  model: Model,
  message: Message,
  events: MunchopediaEvents,
  slots: ['done'],
})

// NOTE: a component is called as `Munchopedia(h, { props, onEmit, slots })`,
// a function Effect UI makes, with no data-last form to give it.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const Munchopedia = MunchopediaDef.make({
  // NOTE: mounted on an entry (the root's NEW ENTRY pop), it says the entry
  // is opened, as a tile does.
  init: $ =>
    MunchopediaPage.matchOrElse(
      $.props.page,
      {
        Entry: ({ kind }) =>
          $.set(initialModel).emit(MunchopediaEvents.OpenedEntry({ kind })),
      },
      () => $.set(initialModel),
    ),
  update: {
    ClickedEntryButton: ($, { kind }) =>
      $.emit(
        MunchopediaEvents.ChangedPage({
          page: MunchopediaPage.Entry({ kind }),
        }),
        MunchopediaEvents.OpenedEntry({ kind }),
      ),
    ClickedListButton: $ =>
      $.emit(MunchopediaEvents.ChangedPage({ page: MunchopediaPage.List() })),
    ClickedTabButton: ($, { tab }) =>
      $.emit(MunchopediaEvents.ChangedPage({ page: TAB_PAGES[tab] })),
    ClickedStoryPageButton: ($, { page }) =>
      $.emit(
        MunchopediaEvents.ChangedPage({
          page: MunchopediaPage.Story({ page }),
        }),
      ),
    ClickedShopButton: $ =>
      $.evolve({ guide: openedGuide }).run(
        FocusGuideControl.make({ target: 'Back' }),
      ),
    ClickedGuideSectionButton: ($, { section }) =>
      $.evolve({ guide: withSection(section) }),
    ClickedGuideBackButton: $ =>
      isGuideOpen($.model.guide)
        ? $.evolve({ guide: GuideStatus.Closed() }).run(
            FocusGuideControl.make({ target: 'Opener' }),
          )
        : $.model,
  },
  view: (h, model) =>
    munchopediaView({ h, model, props: h.props, done: h.slots.done }),
})
