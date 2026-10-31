import { Array, Option, String, pipe } from 'effect'

// WEAR PATCHES

export type Patch = Readonly<{
  x: number
  y: number
  width: number
  height: number
  symbol: string
}>

export const patch = (
  x: number,
  y: number,
  symbol: string,
  width = 1,
  height = 1,
): Patch => ({ x, y, width, height, symbol })

const isInsidePatch =
  (x: number, y: number) =>
  (candidate: Patch): boolean =>
    x >= candidate.x &&
    x < candidate.x + candidate.width &&
    y >= candidate.y &&
    y < candidate.y + candidate.height

export const applyPatches = (
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
      )

export const wornThrough = (
  stagePatches: ReadonlyArray<ReadonlyArray<Patch>>,
  stage: number,
): ReadonlyArray<Patch> => Array.flatten(Array.take(stagePatches, stage))

export type FramePixels = Array.NonEmptyReadonlyArray<ReadonlyArray<string>>

export const firstFrame = (
  stage: number,
  pixelsAt: (stage: number) => FramePixels,
) => Array.headNonEmpty(pixelsAt(stage))
