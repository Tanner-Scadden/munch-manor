import { Block } from 'foldkit'

import { prepareCharacterBlock } from './characterView'
import type { CharacterPicker } from './model'

export const CharacterBlock: Block.FromAssemblyWithViewAndOutMessage<
  typeof CharacterPicker,
  typeof prepareCharacterBlock
> = Block.assemble(prepareCharacterBlock)
