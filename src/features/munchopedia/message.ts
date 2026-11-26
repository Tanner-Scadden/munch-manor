import { UiSchema } from '@effect/ui'

import { ShopGuideSection } from '#shared/nameKeys.ts'
import { MilestoneId } from '#world/dare/milestones.ts'
import { ZombieKind } from '#world/schema/entitySchema.ts'

import { JournalTab } from './journalPages.ts'
import { MunchopediaPage } from './model.ts'

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
