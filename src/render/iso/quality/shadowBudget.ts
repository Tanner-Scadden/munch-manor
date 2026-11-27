export const SHADOW_MAPS_A_FRAME = 2

export type ShadowPick = Readonly<{
  casting: ReadonlyArray<boolean>
  isChanged: (index: number) => boolean
  first: number
  isEvery: boolean
}>

export class ShadowBudget {
  private due = new Uint8Array(0)
  private waited = new Int32Array(0)
  private picked: Array<boolean> = []

  private readonly perFrame: number

  constructor(perFrame: number = SHADOW_MAPS_A_FRAME) {
    this.perFrame = perFrame
  }

  pick(input: ShadowPick): ReadonlyArray<boolean> {
    const { casting, isChanged, first, isEvery } = input
    const count = casting.length
    if (this.due.length !== count) {
      this.due = new Uint8Array(count).fill(1)
      this.waited = new Int32Array(count)
      this.picked = []
      for (let index = 0; index < count; index += 1) {
        this.picked.push(false)
      }
    }
    for (let index = 0; index < count; index += 1) {
      const isCasting = casting[index] === true
      this.due[index] =
        isCasting && (this.due[index] === 1 || isChanged(index)) ? 1 : 0
      this.picked[index] = isEvery ? isCasting : false
    }
    if (!isEvery) {
      let left = this.perFrame
      if (this.due[first] === 1) {
        this.picked[first] = true
        left -= 1
      }
      for (; left > 0; left -= 1) {
        let longest = -1
        for (let index = 0; index < count; index += 1) {
          if (
            this.due[index] === 1 &&
            this.picked[index] !== true &&
            (longest < 0 ||
              (this.waited[index] ?? 0) > (this.waited[longest] ?? 0))
          ) {
            longest = index
          }
        }
        if (longest < 0) {
          break
        }
        this.picked[longest] = true
      }
    }
    for (let index = 0; index < count; index += 1) {
      if (this.picked[index] === true) {
        this.due[index] = 0
        this.waited[index] = 0
      } else if (this.due[index] === 1) {
        this.waited[index] = (this.waited[index] ?? 0) + 1
      }
    }
    return this.picked
  }
}
