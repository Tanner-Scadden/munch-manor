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

export const Munchopedia = MunchopediaDef.make({
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
