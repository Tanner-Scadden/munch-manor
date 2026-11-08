import { Layer } from 'effect'

import { RadioGroup } from '@foldkit/ui'

import { CharacterBlock } from './block'
import { characterImplementation } from './view'

// NOTE: the Look tab's implementation Layer, with its radio groups' own.
// The root's Layer (src/app/block.ts) provides it.
export const CharacterLayer = CharacterBlock.makeLayer(
  characterImplementation,
).pipe(Layer.provide(RadioGroup.layer))
