import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { MilestoneId } from '../../world/dare/milestones'
import type { ZombieKind } from '../../world/schema/worldSchema'
import { GuideBinding } from './bindings'
import { makeStep } from './block'
import type { JournalTab } from './journalPages'
import { OutMessage } from './message'
import { type Model, MunchopediaPage } from './model'

// The Munchopedia's own transitions, shared by its update and its
// InMessage (FOLDKIT.md, "File organization").

const withPage = (model: Model, page: MunchopediaPage): Model =>
  modifyFields(model, { page: () => page })

export const showList = (model: Model): Model =>
  withPage(model, MunchopediaPage.List())

// NOTE: a tab shows its page; the Story tab's button names the page it
// opens on (`showStoryPage`).
const TAB_PAGES: Readonly<Record<JournalTab, MunchopediaPage>> = {
  Zombies: MunchopediaPage.List(),
  Things: MunchopediaPage.Things(),
  Rooms: MunchopediaPage.Rooms(),
  Story: MunchopediaPage.Story({ page: 'FirstFind' }),
  Heroes: MunchopediaPage.Heroes(),
}

export const showTab = (tab: JournalTab) => (model: Model) =>
  withPage(model, TAB_PAGES[tab])

export const showStoryPage = (page: MilestoneId) => (model: Model) =>
  withPage(model, MunchopediaPage.Story({ page }))

// NOTE: an entry opened says so, so the root clears its NEW ENTRY and saves
// it as opened.
export const openEntry = (kind: ZombieKind) => (model: Model) => ({
  model: withPage(model, MunchopediaPage.Entry({ kind })),
  outMessage: OutMessage.OpenedEntry({ kind }),
})

export const openShop = makeStep(() =>
  GuideBinding.requestOpen({ section: 'Guns' }),
)

export const openedEntryOf = (page: MunchopediaPage) =>
  MunchopediaPage.matchOrElse(
    page,
    { Entry: ({ kind }) => OutMessage.OpenedEntry({ kind }) },
    () => undefined,
  )

// NOTE: the Munchopedia opens afresh on the page asked for, with the shop
// guide put away. A Binding's operation in a combined Step cannot carry an
// OutMessage, so its InMessage attaches the entry opened
// (`openedEntryOf`).
export const open = (page: MunchopediaPage) =>
  makeStep(() =>
    Update.combineSteps([
      (current: Model) => ({ model: withPage(current, page) }),
      GuideBinding.requestClose(),
    ]),
  )
