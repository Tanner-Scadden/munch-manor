import type { Model } from '../../../app/model'
import { home } from '../../../test/model.fixture'
import type { MunchopediaProps } from '../model'

export const munchopediaPropsOf = (model: Model): MunchopediaProps => ({
  page: model.munchopediaPage,
  journal: model.journal,
  mastery: model.mastery,
  proof: model.proof,
  fresh: model.freshUnlocks,
  killsByKind: model.bests.killsByKind,
  openedEntries: model.home.openedEntries,
  seenUnlocks: model.seenUnlocks,
  screenMs: model.screenMs,
})

export const HOME_PROPS: MunchopediaProps = munchopediaPropsOf(home)
