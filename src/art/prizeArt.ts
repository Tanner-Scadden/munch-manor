import type { FridgePrize } from '../world/schema/entitySchema'
import { type Palette, type Sprite, spriteShapes } from './sprite'
import { gunIcon } from './sprites/guns'

// The prizes as pixel art: what the fridge's pull shows and offers
// (src/features/fridge/), and the open hand that marks a prize to take, on
// its canvas tag and on the touch hold button
// (src/features/shop/purchaseView.ts and purchaseHud.ts).

// THE FRIDGE'S PRIZES

const SANDWICH: Sprite = spriteShapes(
  ['.kkkkkk.', 'kyyyyyyk', 'kgGrgGgk', 'kyyyyyyk', '.kkkkkk.'],
  { k: '#140c10', y: '#e0c070', g: '#7aa04a', G: '#4e6a2a', r: '#c8343c' },
)

const FISH_BONES_PIXELS: ReadonlyArray<string> = [
  'k.......kk.',
  'kk.w.w.kwwk',
  '.wwwwwwwwkw',
  'kk.w.w.kwwk',
  'k.......kk.',
]

const FISH_BONES: Sprite = spriteShapes(FISH_BONES_PIXELS, {
  k: '#140c10',
  w: '#e8e2cc',
})

// NOTE: the same bones inked dark for the fridge's odds note, whose cream
// paper would swallow the pale ones whole.
const FISH_BONES_ON_PAPER: Sprite = spriteShapes(FISH_BONES_PIXELS, {
  k: '#140c10',
  w: '#7a6a52',
})

export const prizeSprite = (prize: FridgePrize): Sprite =>
  prize === 'Sandwich'
    ? SANDWICH
    : prize === 'Dud'
      ? FISH_BONES
      : gunIcon(prize, 0)

// NOTE: a prize drawn on paper (the odds note): the dud's bones inked dark,
// the rest as they are.
export const prizeOnPaperSprite = (prize: FridgePrize): Sprite =>
  prize === 'Dud' ? FISH_BONES_ON_PAPER : prizeSprite(prize)

// THE GRAB

// NOTE: an open hand reaching up, three fingers and a thumb: "take it",
// with no word, the size of a key cap.
export const GRAB_PIXELS: ReadonlyArray<string> = [
  '..k.k.k.',
  '.kWkWkWk',
  '.kWkWkWk',
  'kkWWWWWk',
  'kWkWWWWk',
  '.kWWWWWk',
  '..kWWWk.',
]

export const GRAB_PALETTE: Palette = { k: '#140c10', W: '#f4f1de' }

export const GRAB_HAND: Sprite = spriteShapes(GRAB_PIXELS, GRAB_PALETTE)
