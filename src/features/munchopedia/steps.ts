import { Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { ZombieKind } from '../../world/schema/worldSchema'
import { GuideBinding } from './bindings'
import { makeStep } from './block'
import { OutMessage } from './message'
import { type Model, MunchopediaPage } from './model'

// The Munchopedia's own transitions, shared by its update and its
// InMessage (FOLDKIT.md, "File organization").

const withPage = (model: Model, page: MunchopediaPage): Model =>
  modifyFields(model, { page: () => page })

export const showList = (model: Model): Model =>
  withPage(model, MunchopediaPage.List())

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
  MunchopediaPage.match(page, {
    List: () => undefined,
    Entry: ({ kind }) => OutMessage.OpenedEntry({ kind }),
  })

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
