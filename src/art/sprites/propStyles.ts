import { Array, Function, Option, Record, String, pipe } from 'effect'

import type { PropStyle } from '#shared/playerData.ts'

type StyledProp = Exclude<PropStyle, 'Stock'>

export type PropRamp = Readonly<{ light: string; mid: string; dark: string }>

export const PROP_STYLE_RAMPS: Readonly<Record<StyledProp, PropRamp>> = {
  Silver: { light: '#f4f6fa', mid: '#b9c0cc', dark: '#6e7686' },
  Night: { light: '#a9b4ff', mid: '#4a4fa8', dark: '#23224e' },
  Ember: { light: '#ffd36b', mid: '#e0521f', dark: '#7a1e0c' },
  Gold: { light: '#fff1a8', mid: '#e8b830', dark: '#a8741a' },
}

const LIGHT = '6'
const MID = '7'
const DARK = '8'

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

export const channelOf: {
  (index: number): (color: string) => number
  (color: string, index: number): number
} = Function.dual(2, (color: string, index: number): number =>
  Number.parseInt(String.slice(1 + index * 2, 3 + index * 2)(color), 16),
)

const lightnessOf = (color: string): number =>
  (channelOf(color, 0) * 0.299 +
    channelOf(color, 1) * 0.587 +
    channelOf(color, 2) * 0.114) /
  255

const toneOf = (color: string): string => {
  const lightness = lightnessOf(color)
  return lightness > 0.7 ? LIGHT : lightness > 0.4 ? MID : DARK
}

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

export const YOU_MEDAL: ReadonlyArray<string> = [
  '..r.....',
  '.yzy....',
  '..y.....',
]
