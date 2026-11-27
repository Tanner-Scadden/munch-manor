import type { Model } from '#app/model.ts'
import type { MunchopediaProps } from '#features/munchopedia/model.ts'
import { home } from '#test/model.fixture.ts'

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
