import {
  type Anchor,
  type Facing,
  type Palette,
  type Sprite,
  mirrorRows,
  spriteShapes,
  spriteWidth,
} from './sprite'

// The little things a player's hands hold and throw while they work
// (src/render/actionPose.ts): the hammer for mending, the spoon at the
// stove and the soup pot, the crowbar for crates and cases, the dumbwaiter's
// rope, a spent magazine, sweat, the find's sparkle, and the junk a trunk
// coughs up. Each is drawn facing right with its grip at the anchor, and
// mirrored to face left, built once as the module loads.

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

// NOTE: the hammer raised, its head over the hand, and come down, its head
// out in front on the board.
export const HAMMER_RAISED: ToolSprite = toolSprite(
  ['.kkk', 'ikkk', '..w.', '..w.', '..d.'],
  { x: 2, y: 4 },
)

export const HAMMER_STRUCK: ToolSprite = toolSprite(
  ['....ki', 'dwwwkk', '....kk'],
  { x: 0, y: 1 },
)

// NOTE: a wooden spoon, the hand at the top of its handle and its bowl
// down in the pot.
export const SPOON: ToolSprite = toolSprite(['d', 'w', 'w', 'w', 'ww'], {
  x: 0,
  y: 0,
})

// NOTE: a crowbar, its painted grip in the hand and its hook bit forward
// and down, worked under a lid.
export const CROWBAR: ToolSprite = toolSprite(
  ['rr....', '.ri...', '..ii..', '...ii.', '....ik', '....k.'],
  { x: 0, y: 0 },
)

// NOTE: the dumbwaiter's rope in front of the hauler, two frames a twist
// apart so it seems to run through the hands.
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

// NOTE: a magazine, out of the gun and falling, or on its way in.
export const MAGAZINE: ToolSprite = toolSprite(['kk', 'ki', 'kk'], {
  x: 1,
  y: 0,
})

// NOTE: a drop of sweat flicked off a hard worker's head.
export const SWEAT_DROP: ToolSprite = toolSprite(['s', 'b', 'b'], {
  x: 0,
  y: 2,
})

// NOTE: the sparkle over a find held up, in two sizes that twinkle.
export const SPARKLE_FRAMES: Readonly<[ToolSprite, ToolSprite]> = [
  toolSprite(['..v..', '..y..', 'vyvyv', '..y..', '..v..'], { x: 2, y: 2 }),
  toolSprite(['.v.', 'vvv', '.v.'], { x: 1, y: 1 }),
]

// NOTE: what a rummaged trunk coughs up: a striped sock, an old bone, and a
// moth-eaten scrap of cloth.
export const JUNK: ReadonlyArray<ToolSprite> = [
  toolSprite(['nn.', '.n.', '.nn'], { x: 1, y: 1 }),
  toolSprite(['g.g', '.g.', 'g.g'], { x: 1, y: 1 }),
  toolSprite(['mm', 'm.'], { x: 0, y: 0 }),
]
