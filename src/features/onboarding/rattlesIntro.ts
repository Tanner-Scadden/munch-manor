import { Array, Function, Option } from 'effect'

import { UiStruct } from '@effect/ui'

import type { Model } from '../../app/model'
import { RattlesIntro } from '../../domain/clientSchema'
import { isCoop } from '../../world/party/party'
import { isPending, learn } from '../../world/run/lessons'
import { DARE_TOUR_WAVE } from '../../world/run/tutorialRules'
import { Phase } from '../../world/schema/worldSchema'

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
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        rattles: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const isRattlesTalking = (model: Model): boolean =>
  RattlesIntro.isAnyOf(['Talking'])(model.rattlesIntro)

export const advanceRattlesIntro: {
  (deltaMs: number): (model: Model) => Model
  (model: Model, deltaMs: number): Model
} = Function.dual(2, (model: Model, deltaMs: number): Model =>
  RattlesIntro.match(model.rattlesIntro, {
    Waiting: () =>
      isMeetingBreak(model)
        ? UiStruct.evolve(learnRattles(model), {
            rattlesIntro: () => RattlesIntro.Talking({ ageMs: 0 }),
          })
        : model,
    Talking: ({ ageMs }) =>
      UiStruct.evolve(model, {
        rattlesIntro: () =>
          !Phase.isAnyOf(['Preparation'])(model.phase) ||
          ageMs + deltaMs >= RATTLES_INTRO_MS
            ? RattlesIntro.Over()
            : RattlesIntro.Talking({ ageMs: ageMs + deltaMs }),
      }),
    Over: () => model,
  }),
)

export const maybeRattlesLine = (model: Model): Option.Option<string> =>
  RattlesIntro.match(model.rattlesIntro, {
    Waiting: () => Option.none(),
    Talking: ({ ageMs }) =>
      Array.get(RATTLES_INTRO_LINES, Math.floor(ageMs / RATTLES_LINE_MS)),
    Over: () => Option.none(),
  })
