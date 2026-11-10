import { Function } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { OPEN_BREAK_WAVE } from '../../shared/constants'
import type { World } from '../schema/world'
import { BreakClock, Lesson, type Lessons, Phase } from '../schema/worldSchema'

// The lessons the step itself reads and writes: the practice gate that
// holds the first break, and the breaks a player has seen. The rest of the
// teaching, with its hints and their places on screen, is the client's
// (src/features/onboarding/onboarding.ts).

export const learn: {
  (atMs: number): (lesson: Lesson) => Lesson
  (lesson: Lesson, atMs: number): Lesson
} = Function.dual(2, (lesson: Lesson, atMs: number): Lesson =>
  Lesson.match(lesson, {
    Pending: () => Lesson.Learned({ atMs }),
    Learned: () => lesson,
  }),
)

const learned = Lesson.Learned({ atMs: 0 })

// NOTE: every lesson learned, as a co-op room plays them.
export const settledLessons: Lessons = {
  move: learned,
  fire: learned,
  startWave: learned,
  shop: learned,
  swap: learned,
  pickup: learned,
  timedBreaks: learned,
  openBreak: learned,
}

export const isPending = (lesson: Lesson): boolean =>
  Lesson.isAnyOf(['Pending'])(lesson)

// PRACTICE GATE

const isFirstPreparation = (phase: Phase): boolean =>
  Phase.match(phase, {
    Ready: () => false,
    Arriving: () => false,
    Preparation: ({ wave }) => wave === 1,
    Wave: () => false,
    Paused: () => false,
    Escaped: () => false,
    GameOver: () => false,
  })

export const isPracticeGateHeld = (model: World): boolean =>
  isFirstPreparation(model.phase) &&
  (isPending(model.lessons.move) || isPending(model.lessons.fire))

// BREAKS

export const learnTimedBreaks = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        timedBreaks: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const learnOpenBreak = (model: World): World =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        openBreak: lesson => learn(lesson, model.elapsedMs),
      }),
  })

export const isTimedBreak: {
  (clock: BreakClock): (wave: number) => boolean
  (wave: number, clock: BreakClock): boolean
} = Function.dual(
  2,
  (wave: number, clock: BreakClock): boolean =>
    wave > OPEN_BREAK_WAVE && BreakClock.isAnyOf(['Counting'])(clock),
)
