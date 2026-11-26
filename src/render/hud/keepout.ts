import { Array, Option } from 'effect'

export type Keepout = Readonly<{
  left: number
  top: number
  right: number
  bottom: number
}>

const KEEPOUT_GAP = 2

const isOverKeepout =
  (x: number, width: number, height: number, y: number) =>
  (keepout: Keepout): boolean =>
    x < keepout.right &&
    x + width > keepout.left &&
    y < keepout.bottom &&
    y + height > keepout.top

type Placing = Readonly<{
  keepouts: ReadonlyArray<Keepout>
  x: number
  y: number
  width: number
  height: number
  top: number
  bottom: number
}>

export const maybeClearOfKeepouts = ({
  keepouts,
  x,
  y,
  width,
  height,
  top,
  bottom,
}: Placing): Option.Option<number> => {
  const isClear = (placed: number): boolean =>
    !Array.some(keepouts, isOverKeepout(x, width, height, placed))
  if (isClear(y)) {
    return Option.some(y)
  }
  return Array.reduce(
    Array.flatMap(keepouts, keepout => [
      keepout.bottom + KEEPOUT_GAP,
      keepout.top - KEEPOUT_GAP - height,
    ]),
    Option.none<number>(),
    (best, candidate) =>
      candidate >= top &&
      candidate <= bottom &&
      isClear(candidate) &&
      Option.match(best, {
        onNone: () => true,
        onSome: kept => Math.abs(candidate - y) < Math.abs(kept - y),
      })
        ? Option.some(candidate)
        : best,
  )
}

export const clearOfKeepouts = (placing: Placing): number =>
  Option.getOrElse(maybeClearOfKeepouts(placing), () =>
    Array.reduce(placing.keepouts, placing.y, (placed, keepout) => {
      if (
        !isOverKeepout(
          placing.x,
          placing.width,
          placing.height,
          placed,
        )(keepout)
      ) {
        return placed
      }
      const under = keepout.bottom + KEEPOUT_GAP
      return under <= placing.bottom
        ? under
        : Math.max(placing.top, keepout.top - KEEPOUT_GAP - placing.height)
    }),
  )
