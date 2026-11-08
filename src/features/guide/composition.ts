import type { Block } from 'foldkit'

import { makeComposition } from './block'

export const GuideComposition = makeComposition()
export type GuideViewBuilder = Block.ViewBuilderFor<typeof GuideComposition>
