import { Layer } from 'effect'

import { RadioGroup } from '@foldkit/ui'

import { CharacterBlock } from './character'
import { characterImplementation } from './characterView'

// NOTE: the Look tab's implementation Layer, with its radio groups' own.
// The root's Layer (src/block.ts) provides it.
export const CharacterLayer = CharacterBlock.makeLayer(
  characterImplementation,
).pipe(Layer.provide(RadioGroup.layer))
