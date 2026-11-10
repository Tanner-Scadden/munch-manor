import { Array, Function, Option, pipe } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import {
  QUEST_GRAB_ICON,
  QUEST_PLACE_ICON,
  TOUR_BOARDS_ICON,
  TOUR_FRIDGE_ICON,
  TOUR_PAUSED_ICON,
  TOUR_PRIZE_ICON,
} from '../../art/icons'
import { Tour } from '../../domain/clientSchema'
import { cameraOf, viewBoxOf, worldToView } from '../../render/camera'
import { fridgeBoxOf } from '../../world/fridge/leftovers'
import { levelOf } from '../../world/level/arena'
import type { Vector } from '../../world/schema/worldSchema'
import {
  QUEST_STEPS,
  isQuestDone,
  maybeQuestMark,
  questStepOf,
} from './firstBreakQuest'
import {
  type KitchenStep,
  kitchenStepOf,
  maybeKitchenMark,
} from './kitchenTour'
import { OnboardingMessage } from './message'

// NOTE: the guided tutorial's tracker, in the corner under the hearts: a
// chapter's steps as icons, the current one lit with its one word, the done
// ones ticked, and a skip button. Done, every step ticks, a little confetti
// pops, and it fades. Chapter 1 is the first break (src/features/onboarding/firstBreakQuest.ts),
// chapter 2 the kitchen and the fridge (src/features/onboarding/kitchenTour.ts), which also
// shows the break clock held.

type StepLook = Readonly<{ icon: string; word: string; spoken: string }>

type Chapter = Readonly<{
  label: string
  skipLabel: string
  skip: OnboardingMessage
  steps: Array.NonEmptyReadonlyArray<StepLook>
  maybeCurrent: Option.Option<number>
  isDone: boolean
  isClockHeld: boolean
}>

const FIRST_BREAK_STEPS: Array.NonEmptyReadonlyArray<StepLook> = [
  { icon: QUEST_GRAB_ICON, word: 'GRAB', spoken: 'Grab the Plank Pile' },
  { icon: QUEST_PLACE_ICON, word: 'PLACE', spoken: 'Put it in a doorway' },
]

const KITCHEN_STEP_ORDER: Array.NonEmptyReadonlyArray<KitchenStep> = [
  'Boards',
  'Fridge',
  'Choose',
]

const KITCHEN_STEPS: Array.NonEmptyReadonlyArray<StepLook> = [
  { icon: TOUR_BOARDS_ICON, word: 'FREE', spoken: 'Open the kitchen, free' },
  { icon: TOUR_FRIDGE_ICON, word: 'FREE', spoken: 'Pull the fridge, free' },
  { icon: TOUR_PRIZE_ICON, word: 'PICK', spoken: 'Take it or leave it' },
]

const firstBreakChapter = (model: Model): Option.Option<Chapter> => {
  const maybeStep = questStepOf(model)
  const isDone = isQuestDone(model)
  return Option.isNone(maybeStep) && !isDone
    ? Option.none()
    : Option.some({
        label: 'First break',
        skipLabel: 'Skip the first break tour',
        skip: OnboardingMessage.ClickedSkipQuestButton(),
        steps: FIRST_BREAK_STEPS,
        maybeCurrent: Option.map(maybeStep, step => QUEST_STEPS.indexOf(step)),
        isDone,
        isClockHeld: false,
      })
}

const kitchenChapter = (model: Model): Option.Option<Chapter> => {
  const maybeStep = kitchenStepOf(model)
  const isDone = Tour.isAnyOf(['Done'])(model.kitchenTour)
  return Option.isNone(maybeStep) && !isDone
    ? Option.none()
    : Option.some({
        label: 'Kitchen tour',
        skipLabel: 'Skip the kitchen tour',
        skip: OnboardingMessage.ClickedSkipKitchenTourButton(),
        steps: KITCHEN_STEPS,
        maybeCurrent: Option.map(maybeStep, step =>
          KITCHEN_STEP_ORDER.indexOf(step),
        ),
        isDone,
        isClockHeld: !isDone,
      })
}

// NOTE: in landscape the tracker docks in the top corner away from what it
// teaches, so it never covers the stall, the boards, or the fridge. In
// portrait it sits in the band above the world (CSS), off the world itself.
type Side = 'Left' | 'Right'

const maybeTargetOf = (model: Model): Option.Option<Vector> =>
  pipe(
    maybeQuestMark(model),
    Option.orElse(() => maybeKitchenMark(model)),
    Option.orElse(() =>
      Option.contains(kitchenStepOf(model), 'Choose')
        ? fridgeBoxOf(levelOf(model)).pipe(
            Option.map(box => ({ x: box.left, y: box.top })),
          )
        : Option.none(),
    ),
  )

const sideOf = (model: Model): Side =>
  Option.match(maybeTargetOf(model), {
    onNone: () => 'Left',
    onSome: target => {
      const camera = cameraOf(model)
      const view = viewBoxOf(camera)
      return worldToView(camera, target).x < view.x + view.width / 2
        ? 'Right'
        : 'Left'
    },
  })

type StepState = 'Done' | 'Now' | 'Later'

const stateOf = (
  index: number,
  maybeCurrent: Option.Option<number>,
  isAllDone: boolean,
): StepState =>
  Option.match(maybeCurrent, {
    onNone: () => (isAllDone ? 'Done' : 'Later'),
    onSome: current => {
      if (index < current) {
        return 'Done'
      } else if (index === current) {
        return 'Now'
      } else {
        return 'Later'
      }
    },
  })

const spokenState = (state: StepState): string => {
  if (state === 'Done') {
    return ', done'
  } else if (state === 'Now') {
    return ', now'
  } else {
    return ''
  }
}

const stepView = (
  look: StepLook,
  index: number,
  state: StepState,
  h: ApplicationViewBuilder,
): Html =>
  h.keyed('li')(
    `${index}`,
    [
      h.Class('quest-step'),
      h.DataAttribute('state', state),
      h.AriaLabel(`${look.spoken}${spokenState(state)}`),
      ...(state === 'Now' ? [h.AriaCurrent('step')] : []),
    ],
    [
      h.span([
        h.Class('quest-step-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: look.icon }),
      ]),
      state === 'Now'
        ? h.span([h.Class('quest-step-word'), h.AriaHidden(true)], [look.word])
        : h.empty,
      state === 'Done'
        ? h.span([h.Class('quest-step-tick'), h.AriaHidden(true)], ['✓'])
        : h.empty,
    ],
  )

const CONFETTI = Array.makeBy(10, index => index)

const chapterView = (
  chapter: Chapter,
  side: Side,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('quest-frame')],
    [
      h.section(
        [
          h.Class('quest-tracker'),
          h.DataAttribute('done', chapter.isDone ? 'true' : 'false'),
          h.DataAttribute('side', side),
          h.AriaLabel(chapter.label),
        ],
        [
          chapter.isClockHeld
            ? h.span([
                h.Class('quest-held'),
                h.Role('img'),
                h.AriaLabel('The break clock waits'),
                h.Style({ backgroundImage: TOUR_PAUSED_ICON }),
              ])
            : h.empty,
          h.ol(
            [h.Class('quest-steps')],
            Array.map(chapter.steps, (look, index) =>
              stepView(
                look,
                index,
                stateOf(index, chapter.maybeCurrent, chapter.isDone),
                h,
              ),
            ),
          ),
          chapter.isDone
            ? h.span(
                [h.Class('quest-confetti'), h.AriaHidden(true)],
                Array.map(CONFETTI, index =>
                  h.span([
                    h.Class('quest-confetti-bit'),
                    h.Style({ '--bit': `${index}` }),
                  ]),
                ),
              )
            : h.button(
                [
                  h.Type('button'),
                  h.Class('quest-skip'),
                  h.AriaLabel(chapter.skipLabel),
                  h.OnClick(chapter.skip, { focusSelector: '.game-surface' }),
                ],
                ['×'],
              ),
        ],
      ),
    ],
  )

export const questTrackerView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  Option.match(
    Option.orElse(firstBreakChapter(model), () => kitchenChapter(model)),
    {
      onNone: () => h.empty,
      onSome: chapter => chapterView(chapter, sideOf(model), h),
    },
  ),
)
