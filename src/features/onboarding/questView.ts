import { Array, Function, Option, pipe } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import {
  TOUR_BOARDS_ICON,
  TOUR_FRIDGE_ICON,
  TOUR_PAUSED_ICON,
  TOUR_PRIZE_ICON,
} from '../../art/icons'
import {
  QUEST_CARD_ICON,
  QUEST_CASE_ICON,
  QUEST_KEY_ICON,
  QUEST_LOCK_ICON,
  QUEST_START_ICON,
} from '../../art/questIcons'
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
  { icon: QUEST_KEY_ICON, word: 'KEY', spoken: 'Grab the key' },
  { icon: QUEST_LOCK_ICON, word: 'LOCK', spoken: 'Find a padlock for keys' },
  { icon: QUEST_CASE_ICON, word: 'CASE', spoken: 'Open the case' },
  { icon: QUEST_CARD_ICON, word: 'DARE', spoken: 'Look at the dare card' },
  { icon: QUEST_START_ICON, word: 'START WAVE', spoken: 'Start the wave' },
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
): ApplicationHtml =>
  h.li
    .key(`${index}`)
    .class('quest-step')
    .attr('data-state', state)
    .attr('aria-label', `${look.spoken}${spokenState(state)}`)
    .attr('aria-current', state === 'Now' ? 'step' : undefined)
    .children(
      h.span
        .class('quest-step-icon')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(look.icon)),
      state === 'Now'
        ? h.span
            .class('quest-step-word')
            .attr('aria-hidden', 'true')
            .children(look.word)
        : null,
      state === 'Done'
        ? h.span
            .class('quest-step-tick')
            .attr('aria-hidden', 'true')
            .children('✓')
        : null,
    )

const CONFETTI = Array.makeBy(10, index => index)

const chapterView = (
  chapter: Chapter,
  side: Side,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div.class('quest-frame').children(
    h.section
      .class('quest-tracker')
      .attr('data-done', chapter.isDone ? 'true' : 'false')
      .attr('data-side', side)
      .attr('aria-label', chapter.label)
      .children(
        chapter.isClockHeld
          ? h.span
              .class('quest-held')
              .attr('role', 'img')
              .attr('aria-label', 'The break clock waits')
              .style(pixelArtStyle(TOUR_PAUSED_ICON))
          : null,
        h.ol
          .class('quest-steps')
          .children(
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
          ? h.span
              .class('quest-confetti')
              .attr('aria-hidden', 'true')
              .children(
                Array.map(CONFETTI, index =>
                  h.span
                    .class('quest-confetti-bit')
                    .style({ '--bit': `${index}` }),
                ),
              )
          : h.button
              .attr('type', 'button')
              .class('quest-skip')
              .attr('aria-label', chapter.skipLabel)
              .on('click', chapter.skip)
              .children('×'),
      ),
  )

export const questTrackerView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Option.match(
      Option.orElse(firstBreakChapter(model), () => kitchenChapter(model)),
      {
        onNone: () => null,
        onSome: chapter => chapterView(chapter, sideOf(model), h),
      },
    ),
)
