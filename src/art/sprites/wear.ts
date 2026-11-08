import { Array, Function, Option, String, pipe } from 'effect'

// WEAR PATCHES

export type Patch = Readonly<{
  x: number
  y: number
  width: number
  height: number
  symbol: string
}>

// NOTE: a call is data-first when its third argument is the symbol; in the
// data-last form it is the width, a number or missing.
const isPatchDataFirst = (args: IArguments): boolean =>
  typeof args[2] === 'string'

export const patch: {
  (
    y: number,
    symbol: string,
    width?: number,
    height?: number,
  ): (x: number) => Patch
  (x: number, y: number, symbol: string, width?: number, height?: number): Patch
} = Function.dual(
  isPatchDataFirst,
  (
    x: number,
    y: number,
    symbol: string,
    width: number = 1,
    height: number = 1,
  ): Patch => ({
    x,
    y,
    width,
    height,
    symbol,
  }),
)

const isInsidePatch =
  (x: number, y: number) =>
  (candidate: Patch): boolean =>
    x >= candidate.x &&
    x < candidate.x + candidate.width &&
    y >= candidate.y &&
    y < candidate.y + candidate.height

export const applyPatches: {
  (
    patches: ReadonlyArray<Patch>,
  ): (rows: ReadonlyArray<string>) => ReadonlyArray<string>
  (
    rows: ReadonlyArray<string>,
    patches: ReadonlyArray<Patch>,
  ): ReadonlyArray<string>
} = Function.dual(
  2,
  (
    rows: ReadonlyArray<string>,
    patches: ReadonlyArray<Patch>,
  ): ReadonlyArray<string> =>
    Array.isReadonlyArrayEmpty(patches)
      ? rows
      : Array.map(rows, (row, y) =>
          pipe(
            String.split(row, ''),
            Array.map((symbol, x) =>
              Option.match(Array.findLast(patches, isInsidePatch(x, y)), {
                onNone: () => symbol,
                onSome: found => found.symbol,
              }),
            ),
            Array.join(''),
          ),
        ),
)

export const wornThrough: {
  (
    stage: number,
  ): (stagePatches: ReadonlyArray<ReadonlyArray<Patch>>) => ReadonlyArray<Patch>
  (
    stagePatches: ReadonlyArray<ReadonlyArray<Patch>>,
    stage: number,
  ): ReadonlyArray<Patch>
} = Function.dual(
  2,
  (
    stagePatches: ReadonlyArray<ReadonlyArray<Patch>>,
    stage: number,
  ): ReadonlyArray<Patch> => Array.flatten(Array.take(stagePatches, stage)),
)

export type FramePixels = Array.NonEmptyReadonlyArray<ReadonlyArray<string>>

export const firstFrame: {
  (
    pixelsAt: (stage: number) => FramePixels,
  ): (stage: number) => ReadonlyArray<string>
  (
    stage: number,
    pixelsAt: (stage: number) => FramePixels,
  ): ReadonlyArray<string>
} = Function.dual(
  2,
  (
    stage: number,
    pixelsAt: (stage: number) => FramePixels,
  ): ReadonlyArray<string> => Array.headNonEmpty(pixelsAt(stage)),
)
