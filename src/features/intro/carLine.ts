import { Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import type { RunEnding } from '../../shared/playerData'
import { pickLine } from '../../shared/prng'
import { FRIEND_LINES } from '../../world/names'
import { isArriving } from '../../world/run/arrival'
import { Phase } from '../../world/schema/worldSchema'

// Your friends in the car (docs/PROGRESSION_PLAN.md, pillar F): the intro's
// car beat carries one short line from them, by how your last run ended.
// The ending is saved and synced (`lastRunEnding`), so they remember across
// reloads and devices. The line is picked from the cosmetic stream as the
// intro starts, never the one said last, and drawn by the intro
// (src/features/intro/introView.ts). Client only: in co-op each player's
// own friends speak, and nothing rides the wire.

// NOTE: a death on these waves or sooner is a quick one: "Brave or dumb?".
export const QUICK_DEATH_WAVE = 2

// NOTE: how a run that just ended ended, read off the phase it ends on.
// Leaving early by the back door (pillar A, a later layer) ends on a phase
// of its own and joins here as `LeftEarly`; its lines are already in
// FRIEND_LINES. A run left from the pause MENU is not an ending: the
// friends remember the run before it.
const maybeEndingOf = (phase: Phase): Option.Option<RunEnding> =>
  Phase.matchOrElse(
    phase,
    {
      GameOver: ({ wave }): Option.Option<RunEnding> =>
        Option.some(wave <= QUICK_DEATH_WAVE ? 'MunchedEarly' : 'Munched'),
      Escaped: (): Option.Option<RunEnding> => Option.some('Escaped'),
    },
    () => Option.none(),
  )

// NOTE: on the frame a run ends, how it ended, for the next intro.
export const noteRunEnding: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  Option.isNone(maybeEndingOf(before.phase))
    ? Option.match(maybeEndingOf(after.phase), {
        onNone: () => after,
        onSome: ending =>
          ending === after.lastRunEnding
            ? after
            : modifyFields(after, { lastRunEnding: () => ending }),
      })
    : after,
)

const lastLineOf = (model: Model): string =>
  Option.getOrElse(model.maybeCarLine, () => '')

// NOTE: on the frame the intro starts, the line the friends say in it.
export const pickCarLine: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model => {
  if (isArriving(before.phase) || !isArriving(after.phase)) {
    return after
  }
  const [state, line] = pickLine(
    after.cosmeticRngState,
    FRIEND_LINES[after.lastRunEnding],
    lastLineOf(after),
  )
  return modifyFields(after, {
    cosmeticRngState: () => state,
    maybeCarLine: () => Option.some(line),
  })
})
