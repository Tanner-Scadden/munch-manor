import type { FridgePrize } from '../world/schema/entitySchema'
import { type Palette, type Sprite, spriteShapes } from './sprite'
import { gunIcon } from './sprites/guns'

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

export const prizeOnPaperSprite = (prize: FridgePrize): Sprite =>
  prize === 'Dud' ? FISH_BONES_ON_PAPER : prizeSprite(prize)

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
