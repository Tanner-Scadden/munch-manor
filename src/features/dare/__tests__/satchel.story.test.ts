import { Array, Effect, Option, Record } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import type { Difficulty, Model } from '#app/model.ts'
import { DARE_FOUND_SLOTS, SATCHEL_BACK } from '#art/dareArt.ts'
import { textWidth } from '#art/font.ts'
import { PocketCard } from '#domain/clientSchema.ts'
import {
  isPocketCardBlocking,
  maybeClueRoom,
} from '#features/dare/pocketCard.ts'
import { pocketCardShapes } from '#features/dare/views/pocketCardView.ts'
import { PAD_SELECT } from '#input/gamepad.ts'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
} from '#render/camera/screen.ts'
import type * as Draw from '#render/draw.ts'
import { pocketOf } from '#screens/game/pocket.ts'
import {
  hidingSpotIn,
  onDifficulty,
  quietWave,
  roomOpenIn,
  withDareThings,
} from '#test/model.fixture.ts'
import {
  changeModel,
  checkModel,
  isPausedPhase,
  press,
  send,
  storyOf,
  tick,
  ticks,
} from '#test/testing.ts'
import { imagesIn } from '#test/viewReading.ts'
import {
  type DareKind,
  type DareThing,
  DareThingState,
} from '#world/dare/dareSchema.ts'
import { levelOf } from '#world/level/arena.ts'
import { DEFAULT_ARRANGEMENT, LIBRARY_ROOM_ID } from '#world/level/plan.ts'
import { DARE_LINES } from '#world/names.ts'
import { Phase } from '#world/schema/worldSchema.ts'

const FRAME_MS = 50

const SPOON_SPOT = hidingSpotIn(levelOf(quietWave(3)), LIBRARY_ROOM_ID)

const thingsWith = (found: ReadonlyArray<DareKind>): ReadonlyArray<DareThing> =>
  Array.map(
    ['SilverSpoon', 'FamilyPortrait', 'MusicBox'] as const,
    (kind, id) => ({
      id,
      kind,
      state: Array.contains(found, kind)
        ? DareThingState.Found({ slot: 0 })
        : DareThingState.Hidden({ ...SPOON_SPOT, workedMs: 0 }),
    }),
  )

const hunting = (found: ReadonlyArray<DareKind>): Model =>
  withDareThings(quietWave(3), thingsWith(found))

const libraryOpen = (model: Model): Model =>
  UiStruct.evolve(model, {
    level: () => roomOpenIn(DEFAULT_ARRANGEMENT, 'Library'),
  })

const elapsedOf = (model: Model): number =>
  Phase.matchOrElse(
    model.phase,
    { Wave: ({ elapsedMs }) => elapsedMs },
    () => -1,
  )

const openedFresh = (model: Model): ReadonlyArray<DareKind> =>
  PocketCard.matchOrElse(
    model.pocketCard,
    { Opened: ({ fresh }) => fresh },
    () => [],
  )

describe('the dare card opened again', () => {
  it.effect('Tab opens it, the run waits alone, and any key puts it away', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting(['FamilyPortrait']))
      s.pipe(
        tick(FRAME_MS),
        press('Tab'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
          expect(isPocketCardBlocking(current)).toBe(true)
        }),
        send(Message.TickedFrame({ deltaTime: FRAME_MS })),
        checkModel(current => {
          expect(elapsedOf(current)).toBeCloseTo(FRAME_MS)
        }),
        ticks(4, FRAME_MS),
        checkModel(current => {
          expect(elapsedOf(current)).toBeCloseTo(FRAME_MS)
        }),
        press('Escape'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
          expect(isPausedPhase(current)).toBe(false)
        }),
        tick(FRAME_MS),
        checkModel(current => {
          expect(elapsedOf(current)).toBeCloseTo(2 * FRAME_MS)
        }),
      )
    }),
  )

  it.effect('the same key puts it away at once, and Select opens it too', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting([]))
      s.pipe(
        press('Tab'),
        press('Tab'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
        }),
        press(PAD_SELECT),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
        }),
      )
    }),
  )

  it.effect("the HUD list's button opens it and puts it away", () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting([]))
      s.pipe(
        send(Message.ClickedDareList()),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
        }),
        send(Message.ClickedDareList()),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
        }),
      )
    }),
  )

  it.effect('a key in its first moment is not taken as a close', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting([]))
      s.pipe(
        press('Tab'),
        press('KeyW'),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Opened')
        }),
      )
    }),
  )

  it.effect('pausing puts it away', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting([]))
      s.pipe(
        press('Tab'),
        send(Message.ClickedPauseButton()),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
          expect(isPausedPhase(current)).toBe(true)
        }),
      )
    }),
  )

  it.effect('Endless has no list, so there is nothing to open', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(withDareThings(quietWave(3), []))
      s.pipe(
        press('Tab'),
        send(Message.ClickedDareList()),
        checkModel(current => {
          expect(current.pocketCard._tag).toBe('Pocketed')
        }),
      )
    }),
  )
})

describe('the satchel', () => {
  it.effect('holds what is found, and only the new finds drop in', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(hunting(['FamilyPortrait']))
      s.pipe(
        press('Tab'),
        checkModel(current => {
          expect(openedFresh(current)).toEqual(['FamilyPortrait'])
          expect(current.dareSatchel).toEqual(['FamilyPortrait'])
        }),
        press('Tab'),
        changeModel(current =>
          UiStruct.evolve(current, {
            dareThings: () => thingsWith(['FamilyPortrait', 'MusicBox']),
          }),
        ),
        press('Tab'),
        checkModel(current => {
          expect(openedFresh(current)).toEqual(['MusicBox'])
          expect(current.dareSatchel).toEqual(['FamilyPortrait', 'MusicBox'])
        }),
      )
    }),
  )

  const imageSources = (
    shapes: ReadonlyArray<Draw.Shape>,
  ): ReadonlyArray<string> => Array.map(imagesIn(shapes), ({ src }) => src)

  const firstSource = (shapes: ReadonlyArray<Draw.Shape>): string =>
    Option.getOrElse(Array.head(imageSources(shapes)), () => '')

  test.each([
    ['landscape', LANDSCAPE_SCREEN],
    ['portrait', DEFAULT_PORTRAIT_SCREEN],
  ])('draws the satchel with its found thing, in %s', (_, screen) => {
    const opened = UiStruct.evolve(hunting(['FamilyPortrait']), {
      pocketCard: () => PocketCard.Opened({ ageMs: 5_000, fresh: [] }),
      dareSatchel: () => ['FamilyPortrait'],
    })
    const drawn = imageSources(
      pocketCardShapes(opened, screen, pocketOf(opened)),
    )
    expect(drawn).toContain(firstSource(SATCHEL_BACK))
    expect(drawn).toContain(firstSource(DARE_FOUND_SLOTS.FamilyPortrait))
    expect(drawn).not.toContain(firstSource(DARE_FOUND_SLOTS.SilverSpoon))
  })

  test('each line fits the narrowest card', () => {
    Record.map(DARE_LINES, line => {
      expect(textWidth(line)).toBeLessThanOrEqual(148)
    })
  })
})

describe("a missing thing's room, by difficulty", () => {
  const spoonRoom = (difficulty: Difficulty, isOpen: boolean) =>
    maybeClueRoom(
      onDifficulty(isOpen ? libraryOpen(hunting([])) : hunting([]), difficulty),
      'SilverSpoon',
    )

  test.each(['Easy', 'Normal'] as const)(
    '%s shows its room once the boards are down',
    difficulty => {
      expect(spoonRoom(difficulty, false)).toEqual(Option.none())
      expect(spoonRoom(difficulty, true)).toEqual(Option.some(LIBRARY_ROOM_ID))
    },
  )

  test.each(['Hard', 'Nightmare'] as const)(
    '%s shows no room until it is found',
    difficulty => {
      expect(spoonRoom(difficulty, true)).toEqual(Option.none())
    },
  )

  test('a thing found shows no room', () => {
    expect(
      maybeClueRoom(libraryOpen(hunting(['SilverSpoon'])), 'SilverSpoon'),
    ).toEqual(Option.none())
  })
})
