import {
  type Anchor,
  type Facing,
  type Palette,
  type Sprite,
  mirrorRows,
  spriteShapes,
  spriteWidth,
} from './sprite'

export type ToolSprite = Readonly<Record<Facing, Sprite>>

const WOOD = '#b07a44'
const WOOD_DARK = '#6b4423'
const IRON = '#3a3d48'
const IRON_SHINE = '#8a8f9a'
const CROWBAR_RED = '#c23a2a'
const ROPE = '#d8c08a'
const ROPE_DARK = '#9a7e48'
const SWEAT = '#9be3ff'
const SWEAT_SHINE = '#ffffff'
const GOLD = '#ffe066'
const SPARK_WHITE = '#fffbe6'

const TOOL_PALETTE: Palette = {
  w: WOOD,
  d: WOOD_DARK,
  k: IRON,
  i: IRON_SHINE,
  r: CROWBAR_RED,
  p: ROPE,
  q: ROPE_DARK,
  b: SWEAT,
  s: SWEAT_SHINE,
  y: GOLD,
  v: SPARK_WHITE,
  g: '#e8dcc8',
  n: '#e46aa6',
  m: '#5e3a8c',
}

const toolSprite = (
  pixels: ReadonlyArray<string>,
  grip: Anchor,
): ToolSprite => ({
  Right: spriteShapes(pixels, TOOL_PALETTE, grip),
  Left: spriteShapes(mirrorRows(pixels), TOOL_PALETTE, {
    x: spriteWidth(pixels) - 1 - grip.x,
    y: grip.y,
  }),
})

export const HAMMER_RAISED: ToolSprite = toolSprite(
  ['.kkk', 'ikkk', '..w.', '..w.', '..d.'],
  { x: 2, y: 4 },
)

export const HAMMER_STRUCK: ToolSprite = toolSprite(
  ['....ki', 'dwwwkk', '....kk'],
  { x: 0, y: 1 },
)

export const SPOON: ToolSprite = toolSprite(['d', 'w', 'w', 'w', 'ww'], {
  x: 0,
  y: 0,
})

export const CROWBAR: ToolSprite = toolSprite(
  ['rr....', '.ri...', '..ii..', '...ii.', '....ik', '....k.'],
  { x: 0, y: 0 },
)

export const ROPE_FRAMES: Readonly<[ToolSprite, ToolSprite]> = [
  toolSprite(['p', 'q', 'p', 'p', 'q', 'p', 'p', 'q', 'p', 'p', 'q', 'p'], {
    x: 0,
    y: 0,
  }),
  toolSprite(['p', 'p', 'q', 'p', 'p', 'q', 'p', 'p', 'q', 'p', 'p', 'q'], {
    x: 0,
    y: 0,
  }),
]

export const MAGAZINE: ToolSprite = toolSprite(['kk', 'ki', 'kk'], {
  x: 1,
  y: 0,
})

export const SWEAT_DROP: ToolSprite = toolSprite(['s', 'b', 'b'], {
  x: 0,
  y: 2,
})

export const SPARKLE_FRAMES: Readonly<[ToolSprite, ToolSprite]> = [
  toolSprite(['..v..', '..y..', 'vyvyv', '..y..', '..v..'], { x: 2, y: 2 }),
  toolSprite(['.v.', 'vvv', '.v.'], { x: 1, y: 1 }),
]

export const JUNK: ReadonlyArray<ToolSprite> = [
  toolSprite(['nn.', '.n.', '.nn'], { x: 1, y: 1 }),
  toolSprite(['g.g', '.g.', 'g.g'], { x: 1, y: 1 }),
  toolSprite(['mm', 'm.'], { x: 0, y: 0 }),
]
