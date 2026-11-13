import { Function, Schema } from 'effect'

// The dare ladder's saved data (docs/PROGRESSION_PLAN.md, pillar E): the
// best mark opened on each difficulty, 0 before its first escape. An escape
// at mark N opens N + 1 (src/domain/dareMarks.ts), up to the ladder's top
// (MAX_MARK in src/world/run/dareLadder.ts, repeated here so the sync
// Worker never pulls in the World). Each count only climbs, so two devices
// merge to the larger. Shared with the sync Worker, like the player scope
// (src/platform/playerScope.ts), so it imports only `effect`.

export const TOP_MARK = 8

export const Mark = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: TOP_MARK }),
)

export const SavedDareMarks = Schema.Struct({
  Easy: Mark,
  Normal: Mark,
  Hard: Mark,
  Nightmare: Mark,
})
export type SavedDareMarks = typeof SavedDareMarks.Type

export const noDareMarks: SavedDareMarks = {
  Easy: 0,
  Normal: 0,
  Hard: 0,
  Nightmare: 0,
}

// NOTE: two players' ladders merged: the higher mark on each difficulty.
export const mergeDareMarks: {
  (reached: SavedDareMarks): (kept: SavedDareMarks) => SavedDareMarks
  (kept: SavedDareMarks, reached: SavedDareMarks): SavedDareMarks
} = Function.dual(
  2,
  (kept: SavedDareMarks, reached: SavedDareMarks): SavedDareMarks => ({
    Easy: Math.max(kept.Easy, reached.Easy),
    Normal: Math.max(kept.Normal, reached.Normal),
    Hard: Math.max(kept.Hard, reached.Hard),
    Nightmare: Math.max(kept.Nightmare, reached.Nightmare),
  }),
)
