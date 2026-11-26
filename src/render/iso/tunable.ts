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
