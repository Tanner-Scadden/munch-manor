import { UiSchema } from '@effect/ui'

import { ShopGuideSection } from '../../shared/nameKeys'
import { MilestoneId } from '../../world/dare/milestones'
import { ZombieKind } from '../../world/schema/entitySchema'
import { JournalTab } from './journalPages'
import { MunchopediaPage } from './model'

// NOTE: the Dare Journal's own facts: a zombie's tile, BACK from an entry
// to the list, the Shop tile, a tab, a story page's number (the Story tab
// sends the page it opens on, the first new one), and the shop guide's
// section buttons and its BACK.
export const Message = UiSchema.TaggedEnum({
  ClickedEntryButton: { kind: ZombieKind },
  ClickedListButton: {},
  ClickedShopButton: {},
  ClickedTabButton: { tab: JournalTab },
  ClickedStoryPageButton: { page: MilestoneId },
  ClickedGuideSectionButton: { section: ShopGuideSection },
  ClickedGuideBackButton: {},
})
export type Message = typeof Message.Type

// NOTE: what the root keeps: the page asked for (the root owns it), and an
// entry opened, by a tile or by the panel mounting on an entry (the root's
// NEW ENTRY pop). The root clears its NEW ENTRY and, for a zombie already
// found, saves it as opened.
export const MunchopediaEvents = UiSchema.TaggedEnum({
  ChangedPage: { page: MunchopediaPage },
  OpenedEntry: { kind: ZombieKind },
})
export type MunchopediaEvents = typeof MunchopediaEvents.Type
