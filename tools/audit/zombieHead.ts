import { Array, String } from 'effect'
// The app icon's art: the palette and the big Groaner head, mid-chomp.
// icons.ts draws the icons and the loading splash from it, og.ts the link
// card, and the video tool's end card (harness/cards.ts) chomps with it.

// PALETTE

// The greens, the drip red, and the MANOR purple come from the title logo.
export const PALETTE: Readonly<Record<string, string>> = {
  o: '#140c10',
  g: '#8fdc5a',
  l: '#d8f7b0',
  d: '#3f7f2a',
  k: '#f28fb0',
  j: '#c0587a',
  e: '#f4f1de',
  r: '#e8333a',
  w: '#f4f1de',
  m: '#2a1418',
  t: '#c0587a',
  x: '#c4232b',
  X: '#8c1f24',
  b: '#3b2160',
  h: '#6d4a9a',
  H: '#8a62c0',
  s: '#c39be8',
}

// PIXEL MAPS

// Groaner mid-chomp, drawn as the left half and mirrored. The right side is
// shaded by the mirror pass, then the patches below add his brain, the
// sleepy eye, and the drip.
const BIG_HEAD_LEFT: ReadonlyArray<string> = [
  '.......oooo',
  '.....oollll',
  '....olllggg',
  '...ollggggg',
  '..olggggggg',
  '..olggggggg',
  '.olgddddggg',
  '.olgeeeeggg',
  '.olgeerrggg',
  '.olgeerrggg',
  '.olgggggggd',
  'olggggggggg',
  'olgmmmmmmmm',
  'olgwwwmwwwm',
  'olgmwmmmwmm',
  'olgmmmmmmtt',
  'olgmmmwmmmw',
  'olgmmwwwmww',
  '.olgggggggg',
  '..odggggggg',
  '...oddggggg',
  '....ooddddd',
  '......ooooo',
  '...........',
  '...........',
]

type Patch = Readonly<{ x: number; y: number; row: string }>

const BIG_HEAD_PATCHES: ReadonlyArray<Patch> = [
  { x: 13, y: 1, row: 'kkkk' },
  { x: 12, y: 2, row: 'kjkkk' },
  { x: 12, y: 3, row: 'kkjjk' },
  { x: 13, y: 4, row: 'jkk' },
  { x: 14, y: 6, row: 'dddd' },
  { x: 14, y: 7, row: 'mmmm' },
  { x: 14, y: 8, row: 'mrrm' },
  { x: 14, y: 9, row: 'mrrm' },
  { x: 4, y: 18, row: 'x' },
  { x: 4, y: 19, row: 'x' },
  { x: 4, y: 20, row: 'x' },
  { x: 3, y: 21, row: 'xx' },
  { x: 3, y: 22, row: 'xX' },
  { x: 3, y: 23, row: 'x' },
]

const mirrorRow = (row: string): string =>
  row +
  Array.join(
    Array.map(globalThis.Array.from(row).reverse(), cell =>
      cell === 'l' ? 'd' : cell,
    ),
    '',
  )

const applyPatches = (
  rows: ReadonlyArray<string>,
  patches: ReadonlyArray<Patch>,
): ReadonlyArray<string> =>
  Array.map(rows, (row, y) =>
    Array.reduce(
      Array.filter(patches, patch => patch.y === y),
      row,
      (line, patch) =>
        String.slice(0, patch.x)(line) +
        patch.row +
        String.slice(patch.x + patch.row.length)(line),
    ),
  )

export const BIG_HEAD: ReadonlyArray<string> = applyPatches(
  Array.map(BIG_HEAD_LEFT, mirrorRow),
  BIG_HEAD_PATCHES,
)
