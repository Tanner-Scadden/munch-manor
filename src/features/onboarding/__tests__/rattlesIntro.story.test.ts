import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  DareHintCall,
  Lesson,
  type Model,
  Party,
  QuestTour,
  RattlesIntro,
} from '../../../app/model'
import { forgetTutorial } from '../../../platform/save'
import { FIXED_STEP_MS, PLAYER_RADIUS } from '../../../shared/constants'
import {
  WAVE_2_BREAK,
  WAVE_2_FIGHT,
  newPlayerCardSeen,
} from '../../../test/model.fixture'
import { APPLICATION, startWave, tick, ticks } from '../../../test/testing'
import { asTutorialDone, asVeteran } from '../../../test/veteran'
import { RATTLES_BOX, START_LEVEL } from '../../../world/level/arena'
import { isPending } from '../../../world/run/lessons'
import { ZOMBIE_KIND_ORDER } from '../../../world/zombies/zombies'
import {
  RATTLES_INTRO_LINES,
  RATTLES_LINE_MS,
  maybeRattlesLine,
} from '../rattlesIntro'

// NOTE: meeting Rattles (src/features/onboarding/rattlesIntro.ts): the first
// break after the practice wave, he says hello from his trunk by the front
// door, once per save, and then the guided first break begins.

const LINE_FRAMES = Math.ceil(RATTLES_LINE_MS / FIXED_STEP_MS)

const firstLine = RATTLES_INTRO_LINES[0]

// NOTE: the break before wave 2, in a new save whose zombies are all met.
const meetingBreak = (base: Model): Model =>
  modifyFields(base, {
    phase: () => WAVE_2_BREAK,
    introducedKinds: () => ZOMBIE_KIND_ORDER,
  })

const newSave = meetingBreak(newPlayerCardSeen)

// NOTE: a player from before the escape: every lesson of the old game
// learned, the dare's and Rattles' still to come.
const returning = meetingBreak(
  modifyFields(asTutorialDone(asVeteran(newPlayerCardSeen)), {
    lessons: lessons =>
      modifyFields(lessons, { rattles: () => Lesson.Pending() }),
  }),
)

describe("Rattles' hello", () => {
  it.effect(
    'a new save meets him in the first break, line by line, then the tour starts',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newSave),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(current.rattlesIntro).toMatchObject({ _tag: 'Talking' })
          expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
          expect(isPending(current.lessons.rattles)).toBe(false)
          expect(current.firstBreakQuest).toEqual(QuestTour.Waiting())
          expect(DareHintCall.isAnyOf(['Quiet'])(current.dareHint.call)).toBe(
            true,
          )
        }),
        ...ticks(LINE_FRAMES, FIXED_STEP_MS),
        Story.model(current => {
          expect(maybeRattlesLine(current)).toEqual(
            Option.fromNullishOr(RATTLES_INTRO_LINES[1]),
          )
        }),
        ...ticks(LINE_FRAMES * RATTLES_INTRO_LINES.length, FIXED_STEP_MS),
        Story.model(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
          expect(maybeRattlesLine(current)).toEqual(Option.none())
          expect(current.firstBreakQuest).toEqual(
            QuestTour.Running({ isLockSeen: false }),
          )
        }),
        Story.Command.resolveAll(),
      ),
  )

  it.effect('a player from before the escape meets him too, once', () =>
    Story.story(
      APPLICATION,
      Story.given(returning),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
      }),
      ...ticks(LINE_FRAMES * RATTLES_INTRO_LINES.length, FIXED_STEP_MS),
      Story.model(current => {
        expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
        expect(isPending(current.lessons.rattles)).toBe(false)
      }),
      Story.Command.resolveAll(),
    ),
  )

  it.effect('a save that has met him never hears it again', () =>
    Story.story(
      APPLICATION,
      Story.given(meetingBreak(asTutorialDone(asVeteran(newPlayerCardSeen)))),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
        expect(maybeRattlesLine(current)).toEqual(Option.none())
      }),
    ),
  )

  it.effect('a tutorial reset brings it back', () =>
    Story.story(
      APPLICATION,
      Story.given(
        meetingBreak(
          forgetTutorial(asTutorialDone(asVeteran(newPlayerCardSeen))),
        ),
      ),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(maybeRattlesLine(current)).toEqual(Option.some(firstLine))
      }),
      Story.Command.resolveAll(),
    ),
  )

  it.effect('starting the wave cuts him off', () =>
    Story.story(
      APPLICATION,
      Story.given(returning),
      tick(FIXED_STEP_MS),
      startWave,
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(current.rattlesIntro).toEqual(RattlesIntro.Over())
      }),
      Story.Command.resolveAll(),
    ),
  )

  it.effect('never in a wave or in co-op, where he waits for a solo run', () =>
    Effect.gen(function* () {
      yield* Story.story(
        APPLICATION,
        Story.given(modifyFields(returning, { phase: () => WAVE_2_FIGHT })),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
        }),
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(modifyFields(returning, { party: () => Party.Crew() })),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(current.rattlesIntro).toEqual(RattlesIntro.Waiting())
          expect(isPending(current.lessons.rattles)).toBe(true)
        }),
      )
    }),
  )
})

// NOTE: he waits by the front door, close beside it but never in the way:
// a player passes between his trunk and the doorway, and the finale's sill
// and Uncle Chunk's way in stay clear.
describe("Rattles' spot", () => {
  it('sits beside the front door, clear of the doorway', () => {
    const door = START_LEVEL.thresholds.Front.box
    const gap = Math.max(
      RATTLES_BOX.left - door.right,
      door.left - RATTLES_BOX.right,
    )
    expect(gap).toBeGreaterThanOrEqual(PLAYER_RADIUS * 2)
    expect(gap).toBeLessThanOrEqual(20)
    expect(RATTLES_BOX.bottom).toBeGreaterThan(door.top - 20)
  })
})
