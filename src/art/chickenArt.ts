import { type Palette, type Sprite, spriteShapes } from './sprite'

// The chicken of a run left early by the kitchen's back door
// (src/world/kitchen/backDoor.ts): big and goofy beside the end card's
// CHICKEN! stamp, flapping, and small on the back door's tag. Original art
// in the house's pixel style.

const CHICKEN_PALETTE: Palette = {
  k: '#140c10',
  W: '#f4f1de',
  w: '#c9c3b0',
  R: '#ff4a4f',
  r: '#a8302a',
  O: '#ffa23f',
  o: '#c96a1a',
}

// NOTE: wings down and wings up, so the stamp's chicken flaps in place.
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

// NOTE: the frames' width, for placing the chicken beside the stamp.
export const CHICKEN_WIDTH_PX = 18

export const CHICKEN_FRAMES: readonly [Sprite, Sprite] = [
  spriteShapes(CHICKEN_DOWN, CHICKEN_PALETTE),
  spriteShapes(CHICKEN_UP, CHICKEN_PALETTE),
]

// NOTE: 7 by 7, for the back door's tag beside OUT.
export const CHICKEN_ICON_SIZE = 7

export const CHICKEN_ICON: Sprite = spriteShapes(
  ['..RR...', '.WWW...', 'OWkW..W', '.rWWWWW', '..WwwW.', '...WW..', '..O.O..'],
  CHICKEN_PALETTE,
  { x: 0, y: 0 },
)

// NOTE: a feather that drifts off the stamp, for the end card's flutter.
export const FEATHER: Sprite = spriteShapes(
  ['..W', '.Ww', 'Ww.', 'w..'],
  CHICKEN_PALETTE,
)
