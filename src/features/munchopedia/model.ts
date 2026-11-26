import { Schema } from 'effect'

import { UiSchema } from '@effect/ui'

import { SavedJournal } from '../../shared/journalData'
import { SavedMastery } from '../../shared/masteryData'
import { SavedProof } from '../../shared/proofData'
import { MilestoneId } from '../../world/dare/milestones'
import { ZombieKind } from '../../world/schema/entitySchema'
import { KillCounts } from '../../world/schema/worldSchema'
import { GuideStatus } from '../guide/model'
import type { JournalTab } from './journalPages'

// NOTE: the Dare Journal's page shown: every zombie as tiles, or one
// zombie's entry (the Zombies tab), the things, the rooms, one story page,
// or the heroes. The Shop page is the shop guide, open over the zombies.
export const MunchopediaPage = UiSchema.TaggedEnum({
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

// NOTE: what the root hands the Dare Journal: the page (the root's, since
// the panel's blurb and NEW ENTRY read it), the saved journal (rooms opened,
// heroes played, milestones reached), hero mastery (a hero's story), the
// Proof Shelf (the things brought out), the unlocks new since it last
// opened (their NEW tags), the kills by kind (what is found, its count and
// badges), the entries opened (a NEW tag on the rest), the unlocks seen
// (the shop guide's fridge prizes), and the screen clock (an entry's walk).
export const MunchopediaProps = Schema.Struct({
  page: MunchopediaPage,
  journal: SavedJournal,
  mastery: SavedMastery,
  proof: SavedProof,
  fresh: Schema.Array(Schema.String),
  killsByKind: KillCounts,
  openedEntries: Schema.Array(ZombieKind),
  seenUnlocks: Schema.Array(Schema.String),
  screenMs: Schema.Finite,
})
export type MunchopediaProps = typeof MunchopediaProps.Type

// NOTE: the Munchopedia's own state: the shop guide, shut or open on a
// section. Nothing outside reads it, and the Munchopedia draws the guide in
// place of its pages while it is open. It starts shut each time the panel
// mounts the Munchopedia.
export const Model = Schema.Struct({
  guide: GuideStatus,
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  guide: GuideStatus.Closed(),
}
