import { Array, Option, Record, pipe } from 'effect'

import {
  COVER_SYMBOLS,
  type CoverKind,
  type Level,
  type Tile,
  tilesWithSymbol,
} from './arena'
import { TILE_SIZE } from './constants'
import { nextRandom } from './prng'

// NOTE: a level's room is drawn once, as one sprite image, on the cached
// floor canvas. Only the hearth's flames move, and they are one small image
// drawn on the scene canvas each frame. The furniture, the walls, the doors,
// and the exits come from the map. The rug, the pictures on the wall, and
// the stains are placed by hand for the parlour.

// PALETTE

export const FLOOR_COLOR = '#3b2b23'
export const PLANK_SEAM_COLOR = '#2d2019'
export const PLANK_JOINT_COLOR = '#271b15'
export const PLANK_SHADES: Array.NonEmptyReadonlyArray<string> = [
  FLOOR_COLOR,
  '#3f2e25',
  '#36271f',
  FLOOR_COLOR,
  '#41302a',
]
export const KNOT_COLOR = '#2a1e17'
export const SCUFF_COLOR = '#47362b'

export const WALL_COLOR = '#1f1826'
export const WALL_CAP_EDGE_COLOR = '#2a2033'
export const WALL_TRIM_COLOR = '#5a4668'
export const WALL_EDGE_COLOR = '#2f2439'
export const WALLPAPER_COLOR = '#3a2442'
export const WALLPAPER_STRIPE_COLOR = '#432a4c'
export const WALLPAPER_FLEUR_COLOR = '#523560'
export const MOLDING_SHADOW_COLOR = '#241a2c'
export const CHAIR_RAIL_COLOR = '#6b4a2e'
export const WAINSCOT_COLOR = '#2e201a'
export const WAINSCOT_PANEL_COLOR = '#38271f'
export const WAINSCOT_LIGHT_COLOR = '#45322a'
export const BASEBOARD_COLOR = '#1a120e'
export const WALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.22)'
export const SIDE_SHADOW_COLOR = 'rgba(0, 0, 0, 0.14)'

export const DOOR_DARK_COLOR = '#0c090d'
export const DOOR_DIM_COLOR = '#1c1411'
export const CASING_COLOR = '#6b4a2e'
export const CASING_LIGHT_COLOR = '#8a6440'
export const CASING_DARK_COLOR = '#3a2616'
export const BROKEN_LEAF_COLOR = '#4a3020'
export const BROKEN_LEAF_DARK_COLOR = '#33201a'
export const SPLINTER_COLOR = '#9a7048'
export const PLANK_COLOR = '#8a6a44'
export const PLANK_LIGHT_COLOR = '#a8865a'
export const PLANK_DARK_COLOR = '#5c4428'
export const NAIL_COLOR = '#c9c3b0'
export const EXIT_GAP_COLOR = '#140e0b'
export const EXIT_BOARD_COLOR = '#8a5a2b'
export const EXIT_BOARD_EDGE_COLOR = '#5c3a1a'

export const GOLD_COLOR = '#b88a3a'
export const GOLD_LIGHT_COLOR = '#e0c070'
export const GOLD_DARK_COLOR = '#8a6a2a'
export const CANDLE_COLOR = '#efe6d2'
export const FLAME_COLOR = '#ffd23f'
export const FLAME_TIP_COLOR = '#ff8a2a'
export const BONE_COLOR = '#e8e2cc'
export const INK_COLOR = '#141018'
export const ZOMBIE_SKIN_COLOR = '#8fc060'

export const BLOOD_COLOR = 'rgba(120, 18, 28, 0.5)'
export const SLIME_PRINT_COLOR = 'rgba(130, 190, 80, 0.22)'
export const COBWEB_FAINT_COLOR = 'rgba(220, 220, 235, 0.3)'
export const COBWEB_COLOR = 'rgba(220, 220, 235, 0.55)'
export const COVER_SHADOW_COLOR = 'rgba(0, 0, 0, 0.35)'

export const PLANK_HEIGHT = 5
export const PLANK_JOINTS = 3
const DECOR_SEED = 0x2c1b3a57
const ROW_MIXER = 0x85ebca6b
const COLUMN_MIXER = 0xc2b2ae35
export const WALL_EDGE_PX = 2
export const FACE_TOP = 3
export const CHAIR_RAIL_Y = 13
export const BASEBOARD_Y = 19

// NOTE: a fixed roll for each decoration, from its two indices, so the room
// looks the same on every load.
export const roll = (first: number, second: number): number =>
  nextRandom(
    DECOR_SEED ^ Math.imul(first, ROW_MIXER) ^ Math.imul(second, COLUMN_MIXER),
  ).value

export const pick = <A>(
  options: Array.NonEmptyReadonlyArray<A>,
  value: number,
): A =>
  Option.getOrElse(
    Array.get(options, Math.floor(value * options.length)),
    () => options[0],
  )

export type Box = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>

export const boundingBox = (tiles: ReadonlyArray<Tile>): Box => {
  const columns = Array.map(tiles, ({ column }) => column)
  const rows = Array.map(tiles, ({ row }) => row)
  const left = Math.min(...columns)
  const top = Math.min(...rows)
  return {
    x: left * TILE_SIZE,
    y: top * TILE_SIZE,
    width: (Math.max(...columns) - left + 1) * TILE_SIZE,
    height: (Math.max(...rows) - top + 1) * TILE_SIZE,
  }
}

const symbolOfKind = (kind: CoverKind): Option.Option<string> =>
  pipe(
    Record.toEntries(COVER_SYMBOLS),
    Array.findFirst(([, coverKind]) => coverKind === kind),
    Option.map(([symbol]) => symbol),
  )

export const boxOfKind = (level: Level, kind: CoverKind): Option.Option<Box> =>
  pipe(
    symbolOfKind(kind),
    Option.map(symbol => tilesWithSymbol(level, symbol)),
    Option.filter(Array.isReadonlyArrayNonEmpty),
    Option.map(boundingBox),
  )
