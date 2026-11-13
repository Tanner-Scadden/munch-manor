import type { Block } from 'foldkit'

import { makeComposition } from './block'

export const ProofShelfComposition = makeComposition()
export type ProofShelfViewBuilder = Block.ViewBuilderFor<
  typeof ProofShelfComposition
>
