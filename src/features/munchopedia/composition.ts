import type { Block } from 'foldkit'

import { GuideBinding } from './bindings'
import { makeComposition } from './block'

// NOTE: the guide tells its parent nothing: it turns, goes back, and moves
// focus on its own.
export const MunchopediaComposition = makeComposition({
  bindings: [GuideBinding],
})
export type MunchopediaViewBuilder = Block.ViewBuilderFor<
  typeof MunchopediaComposition
>
