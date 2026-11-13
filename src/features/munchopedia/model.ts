import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { MilestoneId } from '../../world/dare/milestones'
import { ZombieKind } from '../../world/schema/worldSchema'
import { GuideBlock } from '../guide/block'
import type { JournalTab } from './journalPages'

// NOTE: the Dare Journal's page shown: every zombie as tiles, or one
// zombie's entry (the Zombies tab), the things, the rooms, one story page,
// or the heroes. The Shop page is the shop guide, its child, open over the
// zombies.
export const MunchopediaPage = defineTaggedUnion({
  List: {},
  Entry: { kind: ZombieKind },
  Things: {},
  Rooms: {},
  Story: { page: MilestoneId },
  Heroes: {},
})
export type MunchopediaPage = typeof MunchopediaPage.Type

// NOTE: the tab a page stands under.
export const tabOfPage = (page: MunchopediaPage): JournalTab =>
  MunchopediaPage.match(page, {
    List: (): JournalTab => 'Zombies',
    Entry: (): JournalTab => 'Zombies',
    Things: (): JournalTab => 'Things',
    Rooms: (): JournalTab => 'Rooms',
    Story: (): JournalTab => 'Story',
    Heroes: (): JournalTab => 'Heroes',
  })

// NOTE: the Munchopedia's own state, for the page session: the page, and
// the shop guide on `guide`. What it shows (the kills, the entries opened,
// the unlocks seen) is the root's, read as view inputs; an entry opened
// goes up as `OpenedEntry` for the root to save.
export const Model = Schema.Struct({
  page: MunchopediaPage,
  guide: GuideBlock.Model,
})
export type Model = typeof Model.Type

// NOTE: the Munchopedia's own fields as it starts, on the list.
export const initialModel: Omit<Model, 'guide'> = {
  page: MunchopediaPage.List(),
}
