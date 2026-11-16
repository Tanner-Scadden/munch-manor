// How many room fills draw their shadow maps again in a frame. In a wave
// bodies move under every lit fill, so the watch (shadowWatch.ts) finds
// three or four of them changed each frame, and each is a 2048 pixel map:
// about 15 million depth pixels a frame, five times the screen's own.
// As a game engine spreads its shadow updates, at most `perFrame` maps are
// drawn a frame: the fill nearest the player draws on every frame its
// casters change, and the others take turns, the one waiting longest first,
// so a light away from the player shows its casters a frame or two late.
// A fill whose casters changed stays due until it draws, so no change is
// ever lost, only late.

// NOTE: the maps a frame in a wave: the player's own room and one other.
export const SHADOW_MAPS_A_FRAME = 2

export type ShadowPick = Readonly<{
  // NOTE: which fills cast this frame, in the level's room order.
  casting: ReadonlyArray<boolean>
  // NOTE: whether a fill's casters changed in this frame (the watch's).
  isChanged: (index: number) => boolean
  // NOTE: the fill nearest the player, which never waits; -1 for none.
  first: number
  // NOTE: every casting fill must draw this frame: the casting set
  // changed, and the shadow pass hands out its map's layers by order among
  // the casting lights, so each draws again into the layer it now has.
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

  // NOTE: which fills draw their maps again this frame, in the level's room
  // order. The array is the budget's own, kept and overwritten next frame.
  pick(input: ShadowPick): ReadonlyArray<boolean> {
    const { casting, isChanged, first, isEvery } = input
    const count = casting.length
    if (this.due.length !== count) {
      // NOTE: a new level's fills are all due, to draw their first maps.
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
      // NOTE: a level has a fill per room, at most about eight.
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
