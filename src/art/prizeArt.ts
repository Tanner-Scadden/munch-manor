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

const FISH_BONES: Sprite = spriteShapes(
  ['k.......kk.', 'kk.w.w.kwwk', '.wwwwwwwwkw', 'kk.w.w.kwwk', 'k.......kk.'],
  { k: '#140c10', w: '#e8e2cc' },
)

export const prizeSprite = (prize: FridgePrize): Sprite =>
  prize === 'Sandwich'
    ? SANDWICH
    : prize === 'Dud'
      ? FISH_BONES
      : gunIcon(prize, 0)

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
