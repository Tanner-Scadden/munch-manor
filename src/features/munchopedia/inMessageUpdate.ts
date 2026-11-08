import { pipe } from 'effect'
import { Update } from 'foldkit'

import { MunchopediaComposition } from './composition'
import { open, openedEntryOf } from './steps'

// NOTE: the root's request: open afresh on a page, and say so when it is an
// entry.
export const inMessageUpdate = MunchopediaComposition.makeInMessageUpdate({
  RequestedOpen: (model, { page }) =>
    pipe(open(page)(model), Update.withOutMessage(openedEntryOf(page))),
})
