import { UiStruct } from '@effect/ui'

import {
  DifficultyCard,
  Lesson,
  type Model,
  QuestTour,
  Tour,
  TrapHint,
} from '#app/model.ts'
import { ZOMBIE_KIND_ORDER } from '#world/zombies/zombies.ts'

const learned = (): Lesson => Lesson.Learned({ atMs: 0 })

export const asTutorialDone = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: () => ({
      move: learned(),
      fire: learned(),
      startWave: learned(),
      swap: learned(),
      pickup: learned(),
      timedBreaks: learned(),
      openBreak: learned(),
      dareTour: learned(),
      dareKey: learned(),
      rattles: learned(),
      displayCase: learned(),
      dareCard: learned(),
      gunLevel: learned(),
    }),
    trapHint: () => TrapHint.Seen(),
    introSeen: () => 'Seen',
    firstBreakQuest: () => QuestTour.Over(),
    kitchenTour: () => Tour.Over(),
  })

export const asVeteran = (model: Model): Model =>
  UiStruct.evolve(model, {
    lessons: lessons =>
      UiStruct.evolve(lessons, {
        move: () => Lesson.Learned({ atMs: 0 }),
        fire: () => Lesson.Learned({ atMs: 0 }),
        dareTour: () => Lesson.Learned({ atMs: 0 }),
        dareKey: () => Lesson.Learned({ atMs: 0 }),
        rattles: () => Lesson.Learned({ atMs: 0 }),
        displayCase: () => Lesson.Learned({ atMs: 0 }),
        dareCard: () => Lesson.Learned({ atMs: 0 }),
        gunLevel: () => Lesson.Learned({ atMs: 0 }),
      }),
    introducedKinds: () => ZOMBIE_KIND_ORDER,
    difficultyCard: () => DifficultyCard.Seen,
    introSeen: () => 'Seen',
  })
