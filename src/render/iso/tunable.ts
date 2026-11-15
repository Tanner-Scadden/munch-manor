// A table of numbers the 3D renderer reads (the look's, the flames', the
// mood's ambient), which Munch Studio's light and color lab swaps while
// someone slides its values (tools/studio/lab.ts). The game itself never
// swaps one, so it always reads the table as shipped; a read is one field,
// and whatever is built from a table (the look's ramps) is built again only
// when the table read is a different one.

// NOTE: mutable on purpose: the one place a dev tool may hand the renderer
// other numbers, without a flag or a second path in the game.
export class Tunable<A> {
  readonly shipped: A
  private current: A

  constructor(shipped: A) {
    this.shipped = shipped
    this.current = shipped
  }

  get now(): A {
    return this.current
  }

  tune(value: A): void {
    this.current = value
  }
}
