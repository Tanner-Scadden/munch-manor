import { Array, Function } from 'effect'

const MULBERRY_INCREMENT = 0x6d2b79f5
const UINT32_RANGE = 4294967296

type RandomDraw = Readonly<{ value: number; nextState: number }>

export const nextRandom = (state: number): RandomDraw => {
  const advanced = (state + MULBERRY_INCREMENT) | 0
  const mixed = Math.imul(advanced ^ (advanced >>> 15), advanced | 1)
  const remixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)) ^ mixed
  return {
    value: ((remixed ^ (remixed >>> 14)) >>> 0) / UINT32_RANGE,
    nextState: advanced >>> 0,
  }
}

export type Seeded<A> = readonly [nextState: number, value: A]

export const generateMany: {
  <A>(
    count: number,
    generate: (drawState: number) => Seeded<A>,
  ): (state: number) => Seeded<ReadonlyArray<A>>
  <A>(
    state: number,
    count: number,
    generate: (drawState: number) => Seeded<A>,
  ): Seeded<ReadonlyArray<A>>
} = Function.dual(
  3,
  <A>(
    state: number,
    count: number,
    generate: (drawState: number) => Seeded<A>,
  ): Seeded<ReadonlyArray<A>> =>
    count > 0
      ? Array.mapAccum(
          Array.makeBy(count, () => count),
          state,
          drawState => generate(drawState),
        )
      : [state, []],
)

export const between: {
  (min: number, max: number): (roll: number) => number
  (roll: number, min: number, max: number): number
} = Function.dual(
  3,
  (roll: number, min: number, max: number): number => min + (max - min) * roll,
)
