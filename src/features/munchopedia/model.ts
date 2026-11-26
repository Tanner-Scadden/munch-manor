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

export const MunchopediaPage = UiSchema.TaggedEnum({
  List: {},
  Entry: { kind: ZombieKind },
  Things: {},
  Rooms: {},
  Story: { page: MilestoneId },
  Heroes: {},
})
export type MunchopediaPage = typeof MunchopediaPage.Type

export const tabOfPage = (page: MunchopediaPage): JournalTab =>
  MunchopediaPage.match(page, {
    List: (): JournalTab => 'Zombies',
    Entry: (): JournalTab => 'Zombies',
    Things: (): JournalTab => 'Things',
    Rooms: (): JournalTab => 'Rooms',
    Story: (): JournalTab => 'Story',
    Heroes: (): JournalTab => 'Heroes',
  })

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

export const Model = Schema.Struct({
  guide: GuideStatus,
})
export type Model = typeof Model.Type

export const initialModel: Model = {
  guide: GuideStatus.Closed(),
}
