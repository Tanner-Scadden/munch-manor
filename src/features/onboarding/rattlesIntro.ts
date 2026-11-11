import { Array, Function, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import type { Model } from '../../app/model'
import { RattlesIntro } from '../../domain/clientSchema'
import { isCoop } from '../../world/party/party'
import { isPending, learn } from '../../world/run/lessons'
import { DARE_TOUR_WAVE } from '../../world/run/tutorialRules'
import { Phase } from '../../world/schema/worldSchema'

// Meeting Rattles (owner, 2026-11-10: "he seems to be randomly there"). He
// sits on his trunk by the front door, and the first break after the
// practice wave he says hello from there, in his bubble, a few lines, with
// the bubble's arrow leading to him when he is off screen: the first
// daredevil, who took the dare in 1924 and never got out. Then the guided
// first break begins (src/features/onboarding/firstBreakQuest.ts), and his
// hints after it (src/features/dare/rattlesHint.ts).
//
// It plays once per save: starting it learns the `rattles` lesson, saved,
// so a returning player from before the escape meets him once too, and a
// tutorial reset brings it back. Never in co-op, a run with bots too, where
// nothing is learned, so he waits for a solo run. Nothing holds the game:
// the break before wave 2 has no clock.

export const RATTLES_INTRO_LINES: Array.NonEmptyReadonlyArray<string> = [
  'PSST! OVER HERE, BY THE DOOR!',
  "NAME'S RATTLES. DARED IN 1924.",
  'NEVER GOT OUT. HEH. GOOD LUCK!',
]

export const RATTLES_LINE_MS = 2200

const RATTLES_INTRO_MS = RATTLES_LINE_MS * RATTLES_INTRO_LINES.length

const isMeetingBreak = (model: Model): boolean =>
  Phase.isAnyOf(['Preparation'])(model.phase) &&
  model.phase.wave >= DARE_TOUR_WAVE &&
  !isCoop(model) &&
  isPending(model.lessons.rattles)

const learnRattles = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        rattles: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const isRattlesTalking = (model: Model): boolean =>
  RattlesIntro.isAnyOf(['Talking'])(model.rattlesIntro)

// NOTE: one frame of his hello: it starts once its break comes, steps
// through its lines, and stops early if the wave starts.
export const advanceRattlesIntro: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  RattlesIntro.match(model.rattlesIntro, {
    Waiting: () =>
      isMeetingBreak(model)
        ? modifyFields(learnRattles(model), {
            rattlesIntro: () => RattlesIntro.Talking({ ageMs: 0 }),
          })
        : model,
    Talking: ({ ageMs }) =>
      modifyFields(model, {
        rattlesIntro: () =>
          !Phase.isAnyOf(['Preparation'])(model.phase) ||
          ageMs + deltaMs >= RATTLES_INTRO_MS
            ? RattlesIntro.Over()
            : RattlesIntro.Talking({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

// NOTE: the line he is saying now, if he is talking.
export const maybeRattlesLine = (model: Model): Option.Option<string> =>
  RattlesIntro.match(model.rattlesIntro, {
    Waiting: () => Option.none(),
    Talking: ({ ageMs }) =>
      Array.get(RATTLES_INTRO_LINES, Math.floor(ageMs / RATTLES_LINE_MS)),
    Over: () => Option.none(),
  })
