import { Schema } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { ZombieKind } from '../../world/schema/worldSchema'
import { GuideBlock } from '../guide/block'

// NOTE: the zombies' page shown: every zombie as tiles, or one zombie's
// entry. The Shop page is the shop guide, its child, open over them.
export const MunchopediaPage = defineTaggedUnion({
  List: {},
  Entry: { kind: ZombieKind },
})
export type MunchopediaPage = typeof MunchopediaPage.Type

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
