import { Array, Effect, Option, String } from 'effect'
import type { Canvas } from 'foldkit'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  DareHintCall,
  type Difficulty,
  KitchenCall,
  type Model,
  Phase,
  Tour,
  type Vector,
} from '../../../app/model'
import { cameraOf, viewBoxOf, worldToView } from '../../../render/camera'
import { dareHintShapes, rattlesSpot } from '../../../screens/game/stallBubble'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  freshRunModel,
  pastTimedBreaks,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  settleRunCommands,
  tick,
  ticks,
} from '../../../test/testing'
import { maybeThingRoom } from '../../../world/dare/dare'
import {
  type DareKind,
  type DareThing,
  DareThingState,
} from '../../../world/dare/dareSchema'
import { levelOf, tileCenter } from '../../../world/level/arena'
import { DINING_ROOM_ID, roomSpotsOf } from '../../../world/level/plan'
import { focusOf } from '../../../world/party/party'
import {
  EASY_REST_MS,
  HINT_LINES,
  HINT_MS,
  maybeHintCall,
  pickLine,
} from '../rattlesHint'

// Rattles' hints about the dare (src/features/dare/rattlesHint.ts), drawn
// in his bubble (src/screens/game/stallBubble.ts): how often each step of
// the difficulty dial hollers, a line never twice in a row, the hat and the
// door once the list is done, and the arrow toward a thing out of view.

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

// NOTE: a hiding spot in a room behind boards, out of the window.
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

// NOTE: a spot in view a few steps from the player, out of reach.
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
  state: DareThingState.Hidden(at),
})

const withList = (model: Model, things: ReadonlyArray<DareThing>): Model =>
  modifyFields(model, {
    dare: dare =>
      modifyFields(dare, { list: () => Array.map(things, ({ kind }) => kind) }),
    dareThings: () => things,
  })

// NOTE: the butler's bell in a room behind boards, out of the window.
const BELL = hidden(0, 'ButlersBell', FAR_SPOT)
const BELL_FAR = [BELL]

// NOTE: the room the bell lies in, in Rattles' words.
const BELL_ROOM_WORD = Option.getOrThrow(
  Option.map(maybeThingRoom(BELL, levelOf(base)), ({ id }) =>
    String.toUpperCase(id),
  ),
)

const onDifficulty = (model: Model, difficulty: Difficulty): Model =>
  modifyFields(model, {
    difficulty: setting => modifyFields(setting, { chosen: () => difficulty }),
  })

// NOTE: the break before wave 2, long, before the kitchen goes on sale, so
// its holler never takes the bubble, with the guided first break over.
const breakOn = (
  difficulty: Difficulty,
  things: ReadonlyArray<DareThing> = BELL_FAR,
): Model =>
  withList(
    onDifficulty(
      modifyFields(pastTimedBreaks(base), {
        firstBreakQuest: () => Tour.Over(),
        phase: () =>
          Phase.Preparation({
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

const arrowsOf = (shapes: ReadonlyArray<Canvas.Shape>): number =>
  Array.filter(shapes, shape => shape._tag === 'Rect').length

const drawn = (model: Model): ReadonlyArray<Canvas.Shape> =>
  dareHintShapes(model, camera(model))

// NOTE: a break already called in, so the next call waits on Easy's rest.
const calledAlready = (model: Model, line: string, restMs: number): Model =>
  modifyFields(model, {
    dareHint: hint =>
      modifyFields(hint, {
        calledWave: () => 2,
        restMs: () => restMs,
        lastLine: () => line,
      }),
  })

describe("Rattles' hints, by the difficulty dial", () => {
  it.effect('Double Dare: one hint a break, at a thing on the list', () =>
    Effect.gen(function* () {
      const called = yield* Story.story(
        APPLICATION,
        Story.given(breakOn('Normal')),
        tick(FRAME_MS),
        settleRunCommands,
        Story.model(current => {
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
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(called),
        ...ticks(FRAMES_PAST_CALL, LONG_FRAME_MS),
        settleRunCommands,
        Story.model(later => {
          expect(isCalling(later)).toBe(false)
          expect(later.dareHint.calledWave).toBe(2)
          expect(later.dareHint.restMs).toBeLessThanOrEqual(EASY_REST_MS)
        }),
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
    return Story.story(
      APPLICATION,
      Story.given(calledAlready(breakOn('Easy'), seen, 200)),
      ...ticks(2, FRAME_MS),
      settleRunCommands,
      Story.model(early => {
        expect(isCalling(early)).toBe(false)
      }),
      ...ticks(12, FRAME_MS),
      settleRunCommands,
      Story.model(again => {
        expect(isCalling(again)).toBe(true)
        expect(lineOf(again)).not.toEqual(Option.some(seen))
        expect(Option.flatMap(lineOf(again), iconOf)).toEqual(
          Option.some('ButlersBell'),
        )
      }),
    )
  })

  it.effect('Double Dare never hollers twice in a break', () =>
    Story.story(
      APPLICATION,
      Story.given(calledAlready(breakOn('Normal'), '', 0)),
      ...ticks(20, FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(false)
      }),
    ),
  )

  it.effect('Triple Dare: nothing in a break', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Hard')),
      ...ticks(20, FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(false)
        expect(current.dareHint.calledWave).toBe(2)
      }),
    ),
  )

  it.effect('names the thing once its room is open', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)])),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(
          Option.exists(lineOf(current), line =>
            String.includes('TRY THE')(line),
          ),
        ).toBe(false)
        expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
          Option.some('SilverSpoon'),
        )
      }),
    ),
  )

  it.effect('Triple Dog Dare: a heckle, never a hint', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Nightmare')),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(true)
        expect(Option.flatMap(lineOf(current), iconOf)).toEqual(Option.none())
        expect(
          Option.flatMap(maybeHintCall(current), call => call.maybeTarget),
        ).toEqual(Option.none())
      }),
    ),
  )

  it.effect('waits while the kitchen holler has the bubble', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(breakOn('Normal'), {
          kitchenCall: () =>
            KitchenCall.Calling({ wave: 2, remainingMs: 600_000 }),
        }),
      ),
      ...ticks(3, FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(false)
      }),
    ),
  )
})

describe('the list done', () => {
  it.effect('the last find gets the hat and the door, mid-wave too', () => {
    const fight = modifyFields(
      breakOn('Hard', [hidden(0, 'SilverSpoon', focusOf(base).player)]),
      {
        phase: () =>
          Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      },
    )
    return Story.story(
      APPLICATION,
      Story.given(fight),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(true)
        expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
          Option.some('PartyHat'),
        )
      }),
    )
  })

  it.effect('in a break after, even Triple Dog Dare hears of the hat', () =>
    Story.story(
      APPLICATION,
      Story.given(
        breakOn('Nightmare', [
          {
            id: 0,
            kind: 'SilverSpoon',
            state: DareThingState.Found({ slot: 0 }),
          },
        ]),
      ),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(Option.flatMap(lineOf(current), iconOf)).toEqual(
          Option.some('PartyHat'),
        )
      }),
    ),
  )
})

describe('where the bubble points', () => {
  it.effect('a thing out of view: pinned to the edge with an arrow', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Normal')),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isInView(current, FAR_SPOT)).toBe(false)
        expect(arrowsOf(drawn(current))).toBeGreaterThan(0)
      }),
    ),
  )

  it.effect('a thing in view: over it, with no arrow', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Normal', [hidden(0, 'SilverSpoon', NEAR_SPOT)])),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isCalling(current)).toBe(true)
        expect(drawn(current).length).toBeGreaterThan(0)
        expect(arrowsOf(drawn(current))).toBe(0)
      }),
    ),
  )

  it.effect('a line about no thing hangs from his spot', () =>
    Story.story(
      APPLICATION,
      Story.given(breakOn('Nightmare')),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isInView(current, rattlesSpot())).toBe(true)
        expect(arrowsOf(drawn(current))).toBe(0)
      }),
    ),
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
