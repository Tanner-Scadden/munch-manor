import { Function, Schema } from 'effect'

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
