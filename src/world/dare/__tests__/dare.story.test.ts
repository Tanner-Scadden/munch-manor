import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  AudioState,
  type Difficulty,
  type Model,
  Phase,
  RunMode,
} from '../../../app/model'
import { PlayTune } from '../../../app/update/sound'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  hidingSpotIn,
  quietWave,
  readyModel,
  withDareThings,
  withPlayerAt,
  withSeat,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  checkPendingArgs,
  settleRunCommands,
  startRunFromHome,
  tagsOf,
  tick,
} from '../../../test/testing'
import { levelOf, openExitIn } from '../../level/arena'
import { KITCHEN_EXIT } from '../../level/exits'
import { DINING_ROOM_ID, KITCHEN_ROOM_ID } from '../../level/plan'
import { focusOf, modifyFocus, seatCrew } from '../../party/party'
import { withWorld } from '../../schema/world'
import {
  LAST_THING,
  LIST_LENGTHS,
  dareCardOf,
  isDareListDone,
  maybeLyingAt,
  maybeThingRoom,
} from '../dare'
import { type DareKind, type DareThing, DareThingState } from '../dareSchema'

// The dare's list and its things (src/world/dare/dare.ts): the roll at a
// run's start, one thing to a room behind boards, found by opening the room
// and walking onto it, the crew's one list, and none in Endless.

const FRAME_MS = FIXED_STEP_MS

const DIFFICULTIES: ReadonlyArray<Difficulty> = [
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
]

const readyOn = (difficulty: Difficulty, seed: number): Model =>
  modifyFields(readyModel, {
    rngState: () => seed,
    difficulty: setting => modifyFields(setting, { chosen: () => difficulty }),
  })

const startedOn = (difficulty: Difficulty, seed: number) =>
  Story.story(
    APPLICATION,
    Story.given(readyOn(difficulty, seed)),
    startRunFromHome,
    settleRunCommands,
  )

const START_ROOM_SPOT = hidingSpotIn(levelOf(quietWave(2)), DINING_ROOM_ID)

const KITCHEN_SPOT = hidingSpotIn(levelOf(quietWave(2)), KITCHEN_ROOM_ID)

const hiddenAt = (
  id: number,
  kind: DareKind,
  point: Readonly<{ x: number; y: number }>,
): DareThing => ({
  id,
  kind,
  state: DareThingState.Hidden(point),
})

describe('the list', () => {
  it.effect('rolls at a run start, sized by difficulty, the hat last', () =>
    Effect.forEach(DIFFICULTIES, difficulty =>
      startedOn(difficulty, 11).pipe(
        Effect.map(started => {
          expect(started.dare.list).toHaveLength(LIST_LENGTHS[difficulty])
          const card = dareCardOf(started)
          expect(Array.last(card)).toEqual(
            Option.some({ kind: LAST_THING, isFound: false }),
          )
          expect(card).toHaveLength(LIST_LENGTHS[difficulty] + 1)
          expect(Array.map(started.dareThings, ({ kind }) => kind)).toEqual(
            started.dare.list,
          )
        }),
      ),
    ),
  )

  it.effect(
    'the same seed rolls the same list and spots; seeds differ, and the run is untouched',
    () =>
      Effect.gen(function* () {
        const first = yield* startedOn('Normal', 42)
        const again = yield* startedOn('Normal', 42)
        expect(again.dare).toEqual(first.dare)
        expect(again.dareThings).toEqual(first.dareThings)
        expect(again.rngState).toBe(first.rngState)
        const lists = yield* Effect.forEach(Array.range(1, 12), seed =>
          startedOn('Normal', seed * 7919).pipe(
            Effect.map(started => Array.join(started.dare.list, ',')),
          ),
        )
        expect(Array.dedupe(lists).length).toBeGreaterThan(1)
      }),
  )

  it.effect(
    'each room behind boards holds one thing, none twice, on its spots, the dining room none',
    () =>
      Effect.forEach(Array.range(0, 9), seed =>
        startedOn('Nightmare', seed * 104_729).pipe(
          Effect.map(started => {
            const level = levelOf(started)
            const kinds = Array.map(started.dareThings, ({ kind }) => kind)
            expect(Array.dedupe(kinds)).toHaveLength(kinds.length)
            const rooms = Array.map(started.dareThings, thing =>
              Option.getOrThrow(maybeThingRoom(thing, level)),
            )
            expect(Array.dedupe(Array.map(rooms, ({ id }) => id))).toHaveLength(
              4,
            )
            Array.forEach(
              Array.zip(started.dareThings, rooms),
              ([thing, room]) => {
                expect(room.isOpen).toBe(false)
                expect(thing.kind).not.toBe(LAST_THING)
                expect(Option.isNone(maybeLyingAt(thing, level))).toBe(true)
              },
            )
          }),
        ),
      ),
  )

  // NOTE: fully random (owner, 2026-11-10): any thing may lie in any room,
  // so over a few seeds one room holds things no theme would put there.
  it.effect('any thing may lie in any room, by seed', () =>
    Effect.gen(function* () {
      const pairs = yield* Effect.forEach(Array.range(0, 19), seed =>
        startedOn('Nightmare', seed * 7_919).pipe(
          Effect.map(started => {
            const level = levelOf(started)
            return Array.map(started.dareThings, thing => ({
              room: Option.getOrThrow(maybeThingRoom(thing, level)).id,
              kind: thing.kind,
            }))
          }),
        ),
      )
      const kitchenKinds = Array.dedupe(
        Array.map(
          Array.filter(
            Array.flatten(pairs),
            ({ room }) => room === KITCHEN_ROOM_ID,
          ),
          ({ kind }) => kind,
        ),
      )
      expect(kitchenKinds).toContain('MusicBox')
      expect(kitchenKinds).toContain('GuestBookPage')
    }),
  )

  it.effect('Endless, stay the night, has no list and no card', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(readyOn('Normal', 5), {
          home: home => modifyFields(home, { mode: () => 'Endless' }),
        }),
      ),
      startRunFromHome,
      settleRunCommands,
      Story.model(started => {
        expect(started.mode).toEqual(RunMode.Endless())
        expect(started.dare.list).toEqual([])
        expect(started.dareThings).toEqual([])
        expect(dareCardOf(started)).toEqual([])
        expect(isDareListDone(started)).toBe(false)
      }),
    ),
  )
})

describe('finding a thing', () => {
  it.effect(
    'hidden in a spot: a walk onto it finds it, and the last one ends the list',
    () => {
      const far = withPlayerAt(
        withDareThings(quietWave(3), [
          hiddenAt(0, 'SilverSpoon', START_ROOM_SPOT),
        ]),
        START_ROOM_SPOT.x + 40,
        START_ROOM_SPOT.y,
      )
      return Story.story(
        APPLICATION,
        Story.given(far),
        tick(FRAME_MS),
        settleRunCommands,
        Story.model(current => {
          expect(isDareListDone(current)).toBe(false)
          expect(current.dareThings[0]?.state._tag).toBe('Hidden')
        }),
      ).pipe(
        Effect.flatMap(() =>
          Story.story(
            APPLICATION,
            Story.given(
              withPlayerAt(far, START_ROOM_SPOT.x, START_ROOM_SPOT.y),
            ),
            tick(FRAME_MS),
            settleRunCommands,
            Story.model(current => {
              expect(current.dareThings[0]?.state).toEqual(
                DareThingState.Found({ slot: 0 }),
              )
              expect(tagsOf(current.frameEvents)).toContain('DareFound')
              expect(tagsOf(current.frameEvents)).toContain('DareListDone')
              expect(isDareListDone(current)).toBe(true)
              expect(dareCardOf(current)).toEqual([
                { kind: 'SilverSpoon', isFound: true },
                { kind: LAST_THING, isFound: false },
              ])
            }),
            tick(FRAME_MS),
            settleRunCommands,
            Story.model(current => {
              expect(tagsOf(current.frameEvents)).not.toContain('DareListDone')
            }),
          ),
        ),
      )
    },
  )

  it.effect(
    'behind the boards: out of reach until its room opens, then there to take',
    () =>
      Effect.gen(function* () {
        const shut = withPlayerAt(
          withDareThings(quietWave(3), [
            hiddenAt(0, 'ButlersBell', KITCHEN_SPOT),
          ]),
          KITCHEN_SPOT.x,
          KITCHEN_SPOT.y,
        )
        expect(
          Option.isNone(
            maybeLyingAt(
              Option.getOrThrow(Array.head(shut.dareThings)),
              levelOf(shut),
            ),
          ),
        ).toBe(true)
        yield* Story.story(
          APPLICATION,
          Story.given(shut),
          Story.model(current => {
            expect(current.dareThings[0]?.state._tag).toBe('Hidden')
          }),
        )
        const opened = modifyFields(shut, {
          level: level => openExitIn(level, KITCHEN_EXIT),
        })
        yield* Story.story(
          APPLICATION,
          Story.given(opened),
          tick(FRAME_MS),
          settleRunCommands,
          Story.model(current => {
            expect(current.dareThings[0]?.state).toEqual(
              DareThingState.Found({ slot: 0 }),
            )
          }),
        )
      }),
  )

  it.effect(
    'found by its sound: the music box plays louder nearer, panned to its side, and stops once taken',
    () => {
      const BEAT_EDGE_MS = 2400 * 5 - 4
      const listening = (
        box: Readonly<{ x: number; y: number }>,
        at: Readonly<{ x: number; y: number }>,
      ): Model =>
        withPlayerAt(
          modifyFields(
            withDareThings(quietWave(3), [hiddenAt(0, 'MusicBox', box)]),
            {
              audio: () => AudioState.Ready(),
              musicSetting: () => 'Off',
              elapsedMs: () => BEAT_EDGE_MS,
            },
          ),
          at.x,
          at.y,
        )
      const tuneAt = (
        box: Readonly<{ x: number; y: number }>,
        at: Readonly<{ x: number; y: number }>,
      ) =>
        Effect.suspend(() => {
          const heard: Array<{ volume: number; pan: number }> = []
          return Story.story(
            APPLICATION,
            Story.given(listening(box, at)),
            tick(FRAME_MS),
            checkPendingArgs(Story.Command.argsOf(PlayTune))(tunes => {
              heard.push(...tunes)
            }),
            settleRunCommands,
          ).pipe(Effect.as(heard))
        })
      const fromSpot = (dx: number) => ({
        x: START_ROOM_SPOT.x + dx,
        y: START_ROOM_SPOT.y,
      })
      return Effect.gen(function* () {
        const near = yield* tuneAt(START_ROOM_SPOT, fromSpot(30))
        const far = yield* tuneAt(START_ROOM_SPOT, fromSpot(-140))
        const gone = yield* tuneAt(KITCHEN_SPOT, { x: 10, y: 165 })
        expect(near).toHaveLength(1)
        expect(far).toHaveLength(1)
        expect(gone).toEqual([])
        const [nearTune] = near
        const [farTune] = far
        expect(nearTune?.volume ?? 0).toBeGreaterThan(farTune?.volume ?? 1)
        expect(nearTune?.pan ?? 0).toBeLessThan(0)
        expect(farTune?.pan ?? 0).toBeGreaterThan(0)
        const taken = yield* tuneAt(START_ROOM_SPOT, fromSpot(0))
        expect(taken).toEqual([])
      })
    },
  )
})

describe('the crew', () => {
  it.effect(
    'shares one list: a teammate finds it for everyone, and the card fills for each',
    () => {
      const crew = withWorld(
        withDareThings(quietWave(3), [
          hiddenAt(0, 'SilverSpoon', START_ROOM_SPOT),
        ]),
        world =>
          withSeat(seatCrew(world, 2), 1, seat =>
            modifyFocus(seat, {
              player: player =>
                modifyFields(player, {
                  x: () => START_ROOM_SPOT.x,
                  y: () => START_ROOM_SPOT.y,
                }),
            }),
          ),
      )
      return Story.story(
        APPLICATION,
        Story.given(crew),
        tick(FRAME_MS),
        settleRunCommands,
        Story.model(current => {
          expect(current.dareThings[0]?.state).toEqual(
            DareThingState.Found({ slot: 1 }),
          )
          expect(focusOf(current).seat.slot).toBe(0)
          expect(dareCardOf(current)[0]).toEqual({
            kind: 'SilverSpoon',
            isFound: true,
          })
          expect(isDareListDone(current)).toBe(true)
        }),
      )
    },
  )
})

describe('a run between waves', () => {
  it.effect('a break keeps the hunt on', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withPlayerAt(
          modifyFields(
            withDareThings(quietWave(3), [
              hiddenAt(0, 'SilverSpoon', START_ROOM_SPOT),
            ]),
            {
              phase: () =>
                Phase.Preparation({
                  wave: 4,
                  remainingMs: 60_000,
                  durationMs: 60_000,
                  spawns: [DISTANT_SPAWN],
                }),
            },
          ),
          START_ROOM_SPOT.x,
          START_ROOM_SPOT.y,
        ),
      ),
      tick(FRAME_MS),
      settleRunCommands,
      Story.model(current => {
        expect(isDareListDone(current)).toBe(true)
      }),
    ),
  )
})
