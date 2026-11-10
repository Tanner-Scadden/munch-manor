import { Array, Function, Order } from 'effect'

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

type Keyed<A> = Readonly<{ key: number; item: A }>

const byKey = <A>(): Order.Order<Keyed<A>> =>
  Order.mapInput(Order.Number, ({ key }: Keyed<A>) => key)

// NOTE: the items in an order drawn from the generator, one draw each.
export const shuffle: {
  <A>(
    items: Array.NonEmptyReadonlyArray<A>,
  ): (state: number) => Seeded<Array.NonEmptyReadonlyArray<A>>
  <A>(
    state: number,
    items: Array.NonEmptyReadonlyArray<A>,
  ): Seeded<Array.NonEmptyReadonlyArray<A>>
} = Function.dual(
  2,
  <A>(
    state: number,
    items: Array.NonEmptyReadonlyArray<A>,
  ): Seeded<Array.NonEmptyReadonlyArray<A>> => {
    const [nextState, keyed] = Array.mapAccum(
      items,
      state,
      (drawState, item): Seeded<Keyed<A>> => {
        const draw = nextRandom(drawState)
        return [draw.nextState, { key: draw.value, item }]
      },
    )
    return [
      nextState,
      Array.map(Array.sort(keyed, byKey<A>()), ({ item }) => item),
    ]
  },
)
