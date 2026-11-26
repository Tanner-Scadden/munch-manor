import { UiSchema } from '@effect/ui'

import { ShopGuideSection } from '../../shared/nameKeys'
import { MilestoneId } from '../../world/dare/milestones'
import { ZombieKind } from '../../world/schema/entitySchema'
import { JournalTab } from './journalPages'
import { MunchopediaPage } from './model'

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

export const MunchopediaEvents = UiSchema.TaggedEnum({
  ChangedPage: { page: MunchopediaPage },
  OpenedEntry: { kind: ZombieKind },
})
export type MunchopediaEvents = typeof MunchopediaEvents.Type
