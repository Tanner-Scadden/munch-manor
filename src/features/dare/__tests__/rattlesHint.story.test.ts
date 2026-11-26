import { Array, Effect, Match, Option, String } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import {
  BreakClock,
  DareHintCall,
  type Difficulty,
  KitchenCall,
  type Model,
  Phase,
  Tour,
  type Vector,
} from '#app/model.ts'
import {
  EASY_REST_MS,
  HINT_LINES,
  HINT_MS,
  maybeHintCall,
} from '#features/dare/rattlesHint.ts'
import {
  darePointerShapes,
  maybeDarePointer,
} from '#features/dare/views/darePointer.ts'
import { dareDrawables } from '#features/dare/views/dareView.ts'
import {
  cameraOf,
  screenCameraOf,
  viewBoxOf,
  worldToView,
} from '#render/camera/camera.ts'
import { screenOf } from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'
import { clearWindowOf } from '#render/hud/hudLayout.ts'
import { dareHintShapes, rattlesSpot } from '#screens/game/stallBubble.ts'
import { FIXED_STEP_MS } from '#shared/constants.ts'
import { pickLine } from '#shared/prng.ts'
import {
  DISTANT_SPAWN,
  freshRunModel,
  onDifficulty,
  pastTimedBreaks,
} from '#test/model.fixture.ts'
import {
  checkModel,
  modelAfter,
  settleRunCommands,
  steps,
  storyOf,
  tick,
  ticks,
} from '#test/testing.ts'
import { maybeThingRoom } from '#world/dare/dare.ts'
import {
  type DareKind,
  type DareThing,
  DareThingState,
} from '#world/dare/dareSchema.ts'
import { levelOf } from '#world/level/arena.ts'
import { DINING_ROOM_ID, roomSpotsOf } from '#world/level/plan.ts'
import { tileCenter } from '#world/level/tileGrid.ts'
import { focusOf } from '#world/party/party.ts'
import type { ExitId } from '#world/schema/entitySchema.ts'

const FRAME_MS = FIXED_STEP_MS
const LONG_FRAME_MS = 50
const FRAMES_PAST_CALL = Math.ceil(HINT_MS / LONG_FRAME_MS) + 4

const camera = (model: Model) => cameraOf(model)

const isInView = (model: Model, point: { x: number; y: number }): boolean => {
  const view = viewBoxOf(camera(model))
  const at = worldToView(camera(model), point)
  return (
    at.x >= view.x &&
    at.x <= view.x + view.width &&
    at.y >= view.y &&
    at.y <= view.y + view.height
  )
}

const base = freshRunModel()

const BOARDED_SPOTS: ReadonlyArray<Vector> = Array.flatMap(
  roomSpotsOf(levelOf(base).spec),
  ({ room, hiding }): ReadonlyArray<Vector> =>
    room === DINING_ROOM_ID
      ? []
      : Array.map(hiding, ({ tile }) => tileCenter(tile)),
)

const FAR_SPOT: Vector = Option.getOrThrow(
  Array.findFirst(BOARDED_SPOTS, point => !isInView(base, point)),
)

const NEAR_SPOT = {
  x: focusOf(base).player.x + 30,
  y: focusOf(base).player.y,
}

const hidden = (
  id: number,
  kind: DareKind,
  at: { x: number; y: number },
): DareThing => ({
  id,
  kind,
  state: DareThingState.Hidden({ ...at, workedMs: 0 }),
})

const withList = (model: Model, things: ReadonlyArray<DareThing>): Model =>
  UiStruct.evolve(model, {
    dare: dare =>
      UiStruct.evolve(dare, {
        list: () => Array.map(things, ({ kind }) => kind),
      }),
    dareThings: () => things,
  })

const BELL = hidden(0, 'ButlersBell', FAR_SPOT)
const BELL_FAR = [BELL]

const BELL_ROOM_WORD = Option.getOrThrow(
  Option.map(maybeThingRoom(BELL, levelOf(base)), ({ id }) =>
    String.toUpperCase(id),
  ),
)

const breakOn = (
  difficulty: Difficulty,
  things: ReadonlyArray<DareThing> = BELL_FAR,
): Model =>
  withList(
    onDifficulty(
      UiStruct.evolve(pastTimedBreaks(base), {
        firstBreakQuest: () => Tour.Over(),
        phase: () =>
          Phase.Preparation({
            clock: BreakClock.Counting(),
            wave: 2,
            remainingMs: 600_000,
            durationMs: 600_000,
            spawns: [DISTANT_SPAWN],
          }),
      }),
      difficulty,
    ),
    things,
  )

const lineOf = (model: Model): Option.Option<string> =>
  Option.map(maybeHintCall(model), ({ line }) => line)

const isCalling = (model: Model): boolean =>
  DareHintCall.isAnyOf(['Calling'])(model.dareHint.call)

const iconOf = (line: string): Option.Option<DareKind> =>
  Option.flatMap(
    Array.findFirst(HINT_LINES, entry => entry.line === line),
    ({ maybeIcon }) => maybeIcon,
  )

const FINALE_LINES = ["CHUNK'S GOT THE BIG KEY.", 'BEAT HIM. THEN RUN!']

const isFinaleLine = (line: string): boolean =>
  Array.contains(FINALE_LINES, line)

const arrowsOf = (shapes: ReadonlyArray<Draw.Shape>): number =>
  Array.filter(shapes, shape => shape._tag === 'Rect').length

const drawn = (model: Model): ReadonlyArray<Draw.Shape> =>
  dareHintShapes(model, camera(model))

const calledAlready = (model: Model, line: string, restMs: number): Model =>
  UiStruct.evolve(model, {
    dareHint: hint =>
      UiStruct.evolve(hint, {
        calledWave: () => 2,
        restMs: () => restMs,
        lastLine: () => line,
      }),
  })

describe("Rattles' hints, by the difficulty dial", () => {
  it.effect('Double Dare: one hint a break, at a thing on the list', () =>
    Effect.gen(function* () {
      const called = yield* modelAfter(
        breakOn('Normal'),
        steps(
          tick(FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            expect(isCalling(current)).toBe(true)
            expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
              Option.some('ButlersBell'),
            )
            expect(
              Option.exists(lineOf(current), line =>
                String.includes(BELL_ROOM_WORD)(line),
              ),
            ).toBe(true)
            expect(
              Option.flatMap(maybeHintCall(current), call => call.maybeTarget),
            ).toEqual(Option.some(FAR_SPOT))
          }),
        ),
      )
      return yield* modelAfter(
        called,
        steps(
          ticks(FRAMES_PAST_CALL, LONG_FRAME_MS),
          settleRunCommands,
          checkModel(later => {
            expect(isCalling(later)).toBe(false)
            expect(later.dareHint.calledWave).toBe(2)
            expect(later.dareHint.restMs).toBeLessThanOrEqual(EASY_REST_MS)
          }),
        ),
      )
    }),
  )

  it.effect('Dare: hollers again after a rest, with a new line', () => {
    const seen = Option.getOrThrow(
      Option.flatMap(
        Array.findFirst(
          HINT_LINES,
          ({ line, maybeIcon }) =>
            Option.contains(maybeIcon, 'ButlersBell') &&
            String.includes(BELL_ROOM_WORD)(line),
        ),
        ({ line }) => Option.some(line),
      ),
    )
    return Effect.gen(function* () {
      const s = yield* storyOf(calledAlready(breakOn('Easy'), seen, 200))
      s.pipe(
        ticks(2, FRAME_MS),
        settleRunCommands,
        checkModel(early => {
          expect(isCalling(early)).toBe(false)
        }),
        ticks(12, FRAME_MS),
        settleRunCommands,
        checkModel(again => {
          expect(isCalling(again)).toBe(true)
          expect(lineOf(again)).not.toEqual(Option.some(seen))
          expect(Option.flatMap(lineOf(again), iconOf)).toEqual(
            Option.some('ButlersBell'),
          )
        }),
      )
    })
  })

  it.effect('Double Dare never hollers twice in a break', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(calledAlready(breakOn('Normal'), '', 0))
      s.pipe(
        ticks(20, FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(false)
        }),
      )
    }),
  )

  it.effect('Triple Dare: nothing in a break', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(breakOn('Hard'))
      s.pipe(
        ticks(20, FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(false)
          expect(current.dareHint.calledWave).toBe(2)
        }),
      )
    }),
  )

  it.effect('names the thing once its room is open', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        breakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)]),
      )
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(
            Option.exists(lineOf(current), line =>
              String.includes('TRY THE')(line),
            ),
          ).toBe(false)
          expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
            Option.some('SilverSpoon'),
          )
        }),
      )
    }),
  )

  it.effect('Triple Dog Dare: a heckle, never a hint', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(breakOn('Nightmare'))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(true)
          expect(Option.flatMap(lineOf(current), iconOf)).toEqual(Option.none())
          expect(
            Option.flatMap(maybeHintCall(current), call => call.maybeTarget),
          ).toEqual(Option.none())
        }),
      )
    }),
  )

  it.effect('waits while the kitchen holler has the bubble', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(breakOn('Normal'), {
          kitchenCall: () =>
            KitchenCall.Calling({ wave: 2, remainingMs: 600_000 }),
        }),
      )
      s.pipe(
        ticks(3, FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(false)
        }),
      )
    }),
  )
})

describe('the list done', () => {
  it.effect('the last find gets the big key and the door, mid-wave too', () => {
    const fight = UiStruct.evolve(
      breakOn('Hard', [hidden(0, 'SilverSpoon', focusOf(base).player)]),
      {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      },
    )
    return Effect.gen(function* () {
      const s = yield* storyOf(fight)
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(true)
          expect(Option.exists(lineOf(current), isFinaleLine)).toBe(true)
        }),
      )
    })
  })

  it.effect('in a break after, even Triple Dog Dare hears of the big key', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        breakOn('Nightmare', [
          {
            id: 0,
            kind: 'SilverSpoon',
            state: DareThingState.Found({ slot: 0 }),
          },
        ]),
      )
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(Option.exists(lineOf(current), isFinaleLine)).toBe(true)
        }),
      )
    }),
  )
})

describe('where the bubble points', () => {
  it.effect('a thing out of view: a gold arrow at the edge, not its own', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(breakOn('Normal'))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isInView(current, FAR_SPOT)).toBe(false)
          expect(drawn(current).length).toBeGreaterThan(0)
          expect(arrowsOf(drawn(current))).toBe(0)
          expect(pointerShapesOf(current).length).toBe(1)
        }),
      )
    }),
  )

  it.effect('a thing in view: over it, with no arrow', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        breakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)]),
      )
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(true)
          expect(drawn(current).length).toBeGreaterThan(0)
          expect(arrowsOf(drawn(current))).toBe(0)
        }),
      )
    }),
  )

  it.effect('a line about no thing hangs from his spot', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(breakOn('Nightmare'))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isInView(current, rattlesSpot())).toBe(true)
          expect(arrowsOf(drawn(current))).toBe(0)
        }),
      )
    }),
  )
})

describe('a line never twice in a row', () => {
  test('pickLine skips the line just seen, for every draw', () => {
    const lines = ['ONE', 'TWO', 'THREE'] as const
    Array.forEach(Array.range(0, 200), state => {
      const [, line] = pickLine(state * 7919, lines, 'TWO')
      expect(line).not.toBe('TWO')
    })
  })

  test('no two lines alike, so the one just seen is told apart', () => {
    const lines = Array.map(HINT_LINES, ({ line }) => line)
    expect(Array.dedupe(lines)).toEqual(lines)
  })
})

const pointerShapesOf = (model: Model): ReadonlyArray<Draw.Shape> =>
  darePointerShapes(model, screenOf(model), screenCameraOf(model))

const originOf = (shape: Draw.Shape): Vector =>
  Match.value(shape).pipe(
    Match.tag('Image', ({ x, y }) => ({ x, y })),
    Match.tag('Group', ({ translate }) => translate ?? { x: 0, y: 0 }),
    Match.orElse(() => ({ x: Number.NaN, y: Number.NaN })),
  )

const arrowAt = (model: Model): Vector =>
  originOf(Option.getOrThrow(Array.head(pointerShapesOf(model))))

const isInClearWindow = (model: Model, at: Vector): boolean => {
  const clear = clearWindowOf(screenOf(model), 3)
  return (
    at.x >= clear.left &&
    at.x <= clear.right &&
    at.y >= clear.top &&
    at.y <= clear.bottom
  )
}

const FAR_EXIT: ExitId = Option.getOrThrow(
  Option.flatMap(maybeThingRoom(BELL, levelOf(base)), ({ id }) =>
    Option.flatMap(
      Array.findFirst(levelOf(base).spec.rooms, room => room.id === id),
      room => room.maybeExit,
    ),
  ),
)

const withFarRoomOpen = (model: Model): Model =>
  UiStruct.evolve(model, {
    level: level =>
      UiStruct.evolve(level, {
        openExits: (exits): ReadonlyArray<ExitId> =>
          Array.append(exits, FAR_EXIT),
      }),
  })

const quietBreakOn = (
  difficulty: Difficulty,
  things: ReadonlyArray<DareThing>,
): Model => calledAlready(breakOn(difficulty, things), '', 600_000)

describe('a thing in an open room', () => {
  it.effect(
    'lies in plain sight on Dare and Double Dare, hidden on Triple Dare',
    () =>
      Effect.forEach(
        [
          ['Easy', 1],
          ['Normal', 1],
          ['Hard', 0],
          ['Nightmare', 0],
        ] as const,
        ([difficulty, shown]) =>
          Effect.gen(function* () {
            const s = yield* storyOf(
              quietBreakOn(difficulty, [hidden(0, 'SilverSpoon', NEAR_SPOT)]),
            )
            s.pipe(
              tick(FRAME_MS),
              settleRunCommands,
              checkModel(current => {
                expect(dareDrawables(current).length).toBe(shown)
              }),
            )
          }),
      ),
  )

  it.effect('a thing behind boards stays out of sight on Dare', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(quietBreakOn('Easy', BELL_FAR))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(dareDrawables(current).length).toBe(0)
        }),
      )
    }),
  )
})

describe('the gold arrow', () => {
  it.effect('bobs right over a hinted thing in view', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        breakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)]),
      )
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(true)
          const mark = Option.getOrThrow(maybeDarePointer(current))
          expect(mark).toEqual(NEAR_SPOT)
          const at = arrowAt(current)
          const thing = worldToView(screenCameraOf(current), NEAR_SPOT)
          expect(Math.abs(at.x + 4 - thing.x)).toBeLessThanOrEqual(1)
          expect(at.y).toBeLessThan(thing.y)
          expect(isInClearWindow(current, at)).toBe(true)
        }),
      )
    }),
  )

  it.effect('waits at the window edge toward a hinted thing out of view', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(breakOn('Normal'))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          const far = worldToView(screenCameraOf(current), FAR_SPOT)
          expect(isInClearWindow(current, far)).toBe(false)
          expect(isInClearWindow(current, arrowAt(current))).toBe(true)
        }),
      )
    }),
  )

  it.effect('shows nothing on Double Dare once the hint is over', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        quietBreakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)]),
      )
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(false)
          expect(maybeDarePointer(current)).toEqual(Option.none())
          expect(pointerShapesOf(current).length).toBe(0)
        }),
      )
    }),
  )

  it.effect(
    'on Dare, points through the break at the nearest thing left',
    () => {
      const farThing = hidden(1, 'ButlersBell', FAR_SPOT)
      const nearThing = hidden(0, 'SilverSpoon', NEAR_SPOT)
      return Effect.gen(function* () {
        const s = yield* storyOf(
          withFarRoomOpen(quietBreakOn('Easy', [farThing, nearThing])),
        )
        s.pipe(
          tick(FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            expect(isCalling(current)).toBe(false)
            expect(Option.map(maybeDarePointer(current), ({ x }) => x)).toEqual(
              Option.some(NEAR_SPOT.x),
            )
          }),
          checkModel(current => {
            const found = UiStruct.evolve(current, {
              dareThings: () => [
                farThing,
                { ...nearThing, state: DareThingState.Found({ slot: 0 }) },
              ],
            })
            expect(Option.map(maybeDarePointer(found), ({ x }) => x)).toEqual(
              Option.some(FAR_SPOT.x),
            )
            expect(isInClearWindow(found, arrowAt(found))).toBe(true)
            expect(
              isInClearWindow(
                found,
                worldToView(screenCameraOf(found), FAR_SPOT),
              ),
            ).toBe(false)
          }),
        )
      })
    },
  )
})

describe('a room opening', () => {
  it.effect('shows its thing on Dare, named, with the arrow over it', () => {
    const bell = hidden(0, 'ButlersBell', FAR_SPOT)
    return Effect.gen(function* () {
      const seen = yield* modelAfter(
        quietBreakOn('Easy', [bell]),
        steps(tick(FRAME_MS), settleRunCommands),
      )
      return yield* modelAfter(
        withFarRoomOpen(seen),
        steps(
          tick(FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            expect(isCalling(current)).toBe(true)
            expect(lineOf(current)).toEqual(Option.some('BELL! IN HERE!'))
            expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
              Option.some('ButlersBell'),
            )
            expect(Option.map(maybeDarePointer(current), ({ x }) => x)).toEqual(
              Option.some(FAR_SPOT.x),
            )
          }),
        ),
      )
    })
  })

  it.effect('says nothing on Triple Dare', () => {
    const bell = hidden(0, 'ButlersBell', FAR_SPOT)
    return Effect.gen(function* () {
      const seen = yield* modelAfter(
        quietBreakOn('Hard', [bell]),
        steps(tick(FRAME_MS), settleRunCommands),
      )
      return yield* modelAfter(
        withFarRoomOpen(seen),
        steps(
          tick(FRAME_MS),
          settleRunCommands,
          checkModel(current => {
            expect(isCalling(current)).toBe(false)
          }),
        ),
      )
    })
  })

  it.effect('a run joined with rooms open says nothing of them', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withFarRoomOpen(quietBreakOn('Easy', BELL_FAR)))
      s.pipe(
        tick(FRAME_MS),
        settleRunCommands,
        checkModel(current => {
          expect(isCalling(current)).toBe(false)
        }),
      )
    }),
  )
})
