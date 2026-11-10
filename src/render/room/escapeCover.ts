import { Array, Function, Order, Record, pipe } from 'effect'
import type { Canvas } from 'foldkit'

import type { Level } from '../../world/level/arena'
import { rect } from '../drawing'
import { barrelsShapes, wineRackShapes } from './cellarArt'
import { candelabraShapes, hutchShapes, partyTableShapes } from './diningArt'
import { deskShapes, globeShapes, stackShapes } from './libraryArt'
import { coverBlocks, coverShadow } from './roomCover'
import {
  type Box,
  GOLD_COLOR,
  GOLD_DARK_COLOR,
  GOLD_LIGHT_COLOR,
  INK_COLOR,
} from './roomPalette'

// NOTE: the cover the escape's rooms add (docs/ROOM_DRAFTS.md), drawn the
// way src/render/room/roomCover.ts draws the parlour's: one drawing for each
// block of a symbol on the map. They are keyed by name, not by map symbol:
// CoverKind and COVER_SYMBOLS in src/world/level/arena.ts are the level
// engine's, which the room layers change, so the layer that wires these
// rooms into levels maps its symbols to these names (and makes them solid).

export type EscapeCoverKind =
  | 'PartyTable'
  | 'Hutch'
  | 'Candelabra'
  | 'DisplayCase'
  | 'TrapCrate'
  | 'BookStack'
  | 'Desk'
  | 'Globe'
  | 'WineRack'
  | 'Barrels'

// SHARED COVER

const CASE_WOOD_COLOR = '#4a2a18'
const CASE_WOOD_LIGHT_COLOR = '#6b4423'
const CASE_GLASS_COLOR = 'rgba(170, 210, 230, 0.22)'
const CASE_GLARE_COLOR = 'rgba(240, 250, 255, 0.5)'
const VELVET_COLOR = '#7a2338'
const VELVET_LIGHT_COLOR = '#9a3048'
const CRATE_COLOR = '#8a5a2b'
const CRATE_LIGHT_COLOR = '#b8813f'
const CRATE_DARK_COLOR = '#5c3a1a'
const STENCIL_COLOR = '#3a2412'
const IRON_COLOR = '#4a4a56'

// NOTE: a display case: a glass box on a wooden stand, an empty velvet
// cushion inside waiting for the proof that goes in it, a brass plaque.
const displayCaseShapes = ({
  x,
  y,
  width,
}: Box): ReadonlyArray<Canvas.Shape> => {
  const middle = x + Math.floor(width / 2)
  return [
    rect(x, y + 2, width, 8, CASE_WOOD_COLOR),
    rect(x, y + 2, width, 1, CASE_WOOD_LIGHT_COLOR),
    rect(x + 2, y + 4, width - 4, 4, '#3a2214'),
    rect(middle - 2, y + 5, 4, 2, GOLD_COLOR),
    rect(x, y + 9, 2, 1, GOLD_DARK_COLOR),
    rect(x + width - 2, y + 9, 2, 1, GOLD_DARK_COLOR),
    rect(middle - 5, y - 1, 10, 3, VELVET_COLOR),
    rect(middle - 5, y - 1, 10, 1, VELVET_LIGHT_COLOR),
    rect(x + 1, y - 8, width - 2, 10, CASE_GLASS_COLOR),
    rect(x + 1, y - 9, width - 2, 1, GOLD_COLOR),
    rect(x + 1, y - 8, 1, 10, GOLD_DARK_COLOR),
    rect(x + width - 2, y - 8, 1, 10, GOLD_DARK_COLOR),
    rect(x + 3, y - 7, 1, 3, CASE_GLARE_COLOR),
    rect(x + 4, y - 7, 1, 1, CASE_GLARE_COLOR),
    rect(x + width - 5, y - 2, 1, 2, CASE_GLARE_COLOR),
    rect(middle, y - 10, 1, 1, GOLD_LIGHT_COLOR),
  ]
}

// NOTE: the trap crate: a slatted crate with a bear trap stenciled on it,
// a red gnome hat poking out under the lid, and a spring.
const trapCrateShapes = ({ x, y, width }: Box): ReadonlyArray<Canvas.Shape> => {
  const middle = x + Math.floor(width / 2)
  return [
    rect(x, y - 3, width, 13, CRATE_COLOR),
    rect(x, y - 4, width, 3, CRATE_LIGHT_COLOR),
    rect(x, y - 2, width, 1, CRATE_DARK_COLOR),
    rect(x, y + 3, width, 1, CRATE_DARK_COLOR),
    rect(x + width - 1, y - 3, 1, 13, CRATE_DARK_COLOR),
    rect(x, y - 4, 2, 2, IRON_COLOR),
    rect(x + width - 2, y - 4, 2, 2, IRON_COLOR),
    rect(x, y + 8, 2, 2, IRON_COLOR),
    rect(x + width - 2, y + 8, 2, 2, IRON_COLOR),
    rect(middle - 5, y + 5, 10, 1, STENCIL_COLOR),
    rect(middle - 5, y + 2, 1, 3, STENCIL_COLOR),
    rect(middle + 4, y + 2, 1, 3, STENCIL_COLOR),
    ...Array.makeBy(4, index =>
      rect(middle - 4 + index * 2, y + 3, 1, 1, STENCIL_COLOR),
    ),
    rect(middle - 1, y + 6, 2, 2, STENCIL_COLOR),
    rect(x + 4, y - 7, 3, 3, '#c8343c'),
    rect(x + 5, y - 9, 1, 2, '#c8343c'),
    rect(x + 5, y - 10, 1, 1, '#f4f1de'),
    rect(x + 13, y - 6, 1, 2, '#9a9aaa'),
    rect(x + 14, y - 7, 1, 1, '#9a9aaa'),
    rect(x + 12, y - 8, 1, 1, '#9a9aaa'),
    rect(x + 15, y - 5, 2, 1, INK_COLOR),
  ]
}

const ESCAPE_COVER_DRAWINGS: Readonly<
  Record<
    EscapeCoverKind,
    (box: Box, level: Level) => ReadonlyArray<Canvas.Shape>
  >
> = {
  PartyTable: partyTableShapes,
  Hutch: hutchShapes,
  Candelabra: candelabraShapes,
  DisplayCase: displayCaseShapes,
  TrapCrate: trapCrateShapes,
  BookStack: stackShapes,
  Desk: deskShapes,
  Globe: globeShapes,
  WineRack: wineRackShapes,
  Barrels: barrelsShapes,
}

const byFoot = Order.mapInput(
  Order.Number,
  ({ box }: Readonly<{ box: Box }>) => box.y + box.height,
)

// NOTE: every block of each symbol a map gives one of these kinds, with its
// shadow, the nearer blocks (lower on the map) over the farther ones.
export const escapeCoverShapes: {
  (
    symbols: Readonly<Record<string, EscapeCoverKind>>,
  ): (level: Level) => ReadonlyArray<Canvas.Shape>
  (
    level: Level,
    symbols: Readonly<Record<string, EscapeCoverKind>>,
  ): ReadonlyArray<Canvas.Shape>
} = Function.dual(
  2,
  (
    level: Level,
    symbols: Readonly<Record<string, EscapeCoverKind>>,
  ): ReadonlyArray<Canvas.Shape> =>
    pipe(
      Record.toEntries(symbols),
      Array.flatMap(([symbol, kind]) =>
        Array.map(coverBlocks(level, symbol), box => ({ box, kind })),
      ),
      Array.sort(byFoot),
      Array.flatMap(({ box, kind }) =>
        Array.prepend(
          ESCAPE_COVER_DRAWINGS[kind](box, level),
          coverShadow(box),
        ),
      ),
    ),
)
