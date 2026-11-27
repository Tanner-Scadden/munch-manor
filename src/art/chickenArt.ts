import { type Palette, type Sprite, spriteShapes } from './sprite.ts'

const CHICKEN_PALETTE: Palette = {
  k: '#140c10',
  W: '#f4f1de',
  w: '#c9c3b0',
  R: '#ff4a4f',
  r: '#a8302a',
  O: '#ffa23f',
  o: '#c96a1a',
}

const CHICKEN_DOWN: ReadonlyArray<string> = [
  '......RR..........',
  '.....RRRR.........',
  '....kWWWWk........',
  '...kWWWWWWk.......',
  '...kWWkWWWk.......',
  '.OOkWWWWWWk.......',
  'OOOOkWWWWWWk....kk',
  '.OOkrWWWWWWWk..kWk',
  '...krWWWwwwWWkkWWk',
  '....kWWwwwwwWWWWWk',
  '....kWWWwwwWWWWWk.',
  '.....kWWWWWWWWWk..',
  '......kkWWWWWkk...',
  '........kkkkk.....',
  '........O...O.....',
  '.......OO..OO.....',
]

const CHICKEN_UP: ReadonlyArray<string> = [
  '......RR..........',
  '.....RRRR....kk...',
  '....kWWWWk..kwwk..',
  '...kWWWWWWk.kwwk..',
  '...kWWkWWWkkwwk...',
  '.OOkWWWWWWkwwk....',
  'OOOOkWWWWWWwk...kk',
  '.OOkrWWWWWWWk..kWk',
  '...krWWWWWWWWkkWWk',
  '....kWWWWWWWWWWWWk',
  '....kWWWWWWWWWWWk.',
  '.....kWWWWWWWWWk..',
  '......kkWWWWWkk...',
  '........kkkkk.....',
  '........O...O.....',
  '.......OO..OO.....',
]

export const CHICKEN_WIDTH_PX = 18

export const CHICKEN_FRAMES: readonly [Sprite, Sprite] = [
  spriteShapes(CHICKEN_DOWN, CHICKEN_PALETTE),
  spriteShapes(CHICKEN_UP, CHICKEN_PALETTE),
]

export const CHICKEN_ICON_SIZE = 7

export const CHICKEN_ICON: Sprite = spriteShapes(
  ['..RR...', '.WWW...', 'OWkW..W', '.rWWWWW', '..WwwW.', '...WW..', '..O.O..'],
  CHICKEN_PALETTE,
  { x: 0, y: 0 },
)

export const FEATHER: Sprite = spriteShapes(
  ['..W', '.Ww', 'Ww.', 'w..'],
  CHICKEN_PALETTE,
)
