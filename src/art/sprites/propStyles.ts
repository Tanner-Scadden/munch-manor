import { Array, Function, Option, Record, String, pipe } from 'effect'

import type { PropStyle } from '../../shared/playerData'

// A hero's prop in a mastery style (src/domain/mastery.ts): a palette swap
// of the prop the hero wears, its headgear and its body prop. Each pixel
// of the prop takes the style's light, middle, or dark shade by how light
// its stock color is, so a prop keeps its shading in any style. YOU, who
// wears no prop, wears a small medal on the chest once a style is on.
// Drafts pinned in Munch Studio (tools/studio/) for the owner's review.

type StyledProp = Exclude<PropStyle, 'Stock'>

export type PropRamp = Readonly<{ light: string; mid: string; dark: string }>

export const PROP_STYLE_RAMPS: Readonly<Record<StyledProp, PropRamp>> = {
  Silver: { light: '#f4f6fa', mid: '#b9c0cc', dark: '#6e7686' },
  Night: { light: '#a9b4ff', mid: '#4a4fa8', dark: '#23224e' },
  Ember: { light: '#ffd36b', mid: '#e0521f', dark: '#7a1e0c' },
  Gold: { light: '#fff1a8', mid: '#e8b830', dark: '#a8741a' },
}

// NOTE: the symbols a styled prop is drawn in, apart from every other
// symbol of the figure (the Rainbow print's are 0 to 5).
const LIGHT = '6'
const MID = '7'
const DARK = '8'

// NOTE: the style's three shades under their symbols, for the figure's
// palette. Stock adds none.
export const propStylePalette = (
  style: PropStyle,
): Readonly<Record<string, string>> =>
  style === 'Stock'
    ? {}
    : {
        [LIGHT]: PROP_STYLE_RAMPS[style].light,
        [MID]: PROP_STYLE_RAMPS[style].mid,
        [DARK]: PROP_STYLE_RAMPS[style].dark,
      }

// NOTE: one channel of a `#rrggbb` color, 0 to 255.
export const channelOf: {
  (index: number): (color: string) => number
  (color: string, index: number): number
} = Function.dual(2, (color: string, index: number): number =>
  Number.parseInt(String.slice(1 + index * 2, 3 + index * 2)(color), 16),
)

// NOTE: how light a color is, 0 to 1, by the usual weights of the eye.
const lightnessOf = (color: string): number =>
  (channelOf(color, 0) * 0.299 +
    channelOf(color, 1) * 0.587 +
    channelOf(color, 2) * 0.114) /
  255

const toneOf = (color: string): string => {
  const lightness = lightnessOf(color)
  return lightness > 0.7 ? LIGHT : lightness > 0.4 ? MID : DARK
}

// NOTE: a prop's rows in a style: each colored pixel takes the style's
// shade for its stock color (read from the figure's palette), and `.`
// stays clear. Stock leaves the rows as they are.
export const styledProp: {
  (
    style: PropStyle,
    palette: Readonly<Record<string, string>>,
  ): (rows: ReadonlyArray<string>) => ReadonlyArray<string>
  (
    rows: ReadonlyArray<string>,
    style: PropStyle,
    palette: Readonly<Record<string, string>>,
  ): ReadonlyArray<string>
} = Function.dual(
  3,
  (
    rows: ReadonlyArray<string>,
    style: PropStyle,
    palette: Readonly<Record<string, string>>,
  ): ReadonlyArray<string> =>
    style === 'Stock'
      ? rows
      : Array.map(rows, row =>
          pipe(
            String.split(row, ''),
            Array.map(symbol =>
              Option.match(Record.get(palette, symbol), {
                onNone: () => symbol,
                onSome: toneOf,
              }),
            ),
            Array.join(''),
          ),
        ),
)

// NOTE: YOU's medal, on the torso's rows like a body prop: a ribbon over
// a round medal on the chest's left, in the style's colors.
export const YOU_MEDAL: ReadonlyArray<string> = [
  '..r.....',
  '.yzy....',
  '..y.....',
]
