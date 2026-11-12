import { Array, Option, Record } from 'effect'
import type { Canvas } from 'foldkit'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import type { Difficulty, Model } from '../../../app/model'
import { DARE_FOUND_SLOTS, SATCHEL_BACK } from '../../../art/dareArt'
import { textWidth } from '../../../art/font'
import { PocketCard } from '../../../domain/clientSchema'
import { PAD_SELECT } from '../../../input/gamepad'
import {
  DEFAULT_PORTRAIT_SCREEN,
  LANDSCAPE_SCREEN,
} from '../../../render/screen'
import { pocketOf } from '../../../screens/game/pocket'
import {
  hidingSpotIn,
  onDifficulty,
  quietWave,
  roomOpenIn,
  withDareThings,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  changeModel,
  isPausedPhase,
  press,
  tick,
  ticks,
} from '../../../test/testing'
import { imagesIn } from '../../../test/viewReading'
import {
  type DareKind,
  type DareThing,
  DareThingState,
} from '../../../world/dare/dareSchema'
import { levelOf } from '../../../world/level/arena'
import { DEFAULT_ARRANGEMENT, LIBRARY_ROOM_ID } from '../../../world/level/plan'
import { DARE_LINES } from '../../../world/names'
import { Phase } from '../../../world/schema/worldSchema'
import { isPocketCardBlocking, maybeClueRoom } from '../pocketCard'
import { pocketCardShapes } from '../pocketCardView'

// The dare card opened again from the HUD's list (src/features/dare/pocketCard.ts),
// with its satchel (src/features/dare/pocketCardView.ts): Tab, a
// controller's Select, or a click on the list opens it; alone the run waits
// under it; any key or tap past its gate, or the same key, puts it away.
// Found things sit in the satchel, the ones new since the last look drop
// in, and a thing still missing shows its room once known, by difficulty.

const FRAME_MS = 50

// NOTE: the library's thing, still hidden, and the portrait found.
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
  modifyFields(model, {
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
    Story.story(
      APPLICATION,
      Story.given(hunting(['FamilyPortrait'])),
      tick(FRAME_MS),
      press('Tab'),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Opened')
        expect(isPocketCardBlocking(current)).toBe(true)
      }),
      Story.message(Message.TickedFrame({ deltaTime: FRAME_MS })),
      Story.model(current => {
        expect(elapsedOf(current)).toBeCloseTo(FRAME_MS)
      }),
      ...ticks(4, FRAME_MS),
      Story.model(current => {
        expect(elapsedOf(current)).toBeCloseTo(FRAME_MS)
      }),
      press('Escape'),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Pocketed')
        expect(isPausedPhase(current)).toBe(false)
      }),
      tick(FRAME_MS),
      Story.model(current => {
        expect(elapsedOf(current)).toBeCloseTo(2 * FRAME_MS)
      }),
    ),
  )

  it.effect('the same key puts it away at once, and Select opens it too', () =>
    Story.story(
      APPLICATION,
      Story.given(hunting([])),
      press('Tab'),
      press('Tab'),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Pocketed')
      }),
      press(PAD_SELECT),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Opened')
      }),
    ),
  )

  it.effect("the HUD list's button opens it and puts it away", () =>
    Story.story(
      APPLICATION,
      Story.given(hunting([])),
      Story.message(Message.ClickedDareList()),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Opened')
      }),
      Story.message(Message.ClickedDareList()),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Pocketed')
      }),
    ),
  )

  it.effect('a key in its first moment is not taken as a close', () =>
    Story.story(
      APPLICATION,
      Story.given(hunting([])),
      press('Tab'),
      press('KeyW'),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Opened')
      }),
    ),
  )

  it.effect('pausing puts it away', () =>
    Story.story(
      APPLICATION,
      Story.given(hunting([])),
      press('Tab'),
      Story.message(Message.ClickedPauseButton()),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Pocketed')
        expect(isPausedPhase(current)).toBe(true)
      }),
    ),
  )

  it.effect('Endless has no list, so there is nothing to open', () =>
    Story.story(
      APPLICATION,
      Story.given(withDareThings(quietWave(3), [])),
      press('Tab'),
      Story.message(Message.ClickedDareList()),
      Story.model(current => {
        expect(current.pocketCard._tag).toBe('Pocketed')
      }),
    ),
  )
})

describe('the satchel', () => {
  it.effect('holds what is found, and only the new finds drop in', () =>
    Story.story(
      APPLICATION,
      Story.given(hunting(['FamilyPortrait'])),
      press('Tab'),
      Story.model(current => {
        expect(openedFresh(current)).toEqual(['FamilyPortrait'])
        expect(current.dareSatchel).toEqual(['FamilyPortrait'])
      }),
      press('Tab'),
      changeModel(current =>
        modifyFields(current, {
          dareThings: () => thingsWith(['FamilyPortrait', 'MusicBox']),
        }),
      ),
      press('Tab'),
      Story.model(current => {
        expect(openedFresh(current)).toEqual(['MusicBox'])
        expect(current.dareSatchel).toEqual(['FamilyPortrait', 'MusicBox'])
      }),
    ),
  )

  const imageSources = (
    shapes: ReadonlyArray<Canvas.Shape>,
  ): ReadonlyArray<string> => Array.map(imagesIn(shapes), ({ src }) => src)

  const firstSource = (shapes: ReadonlyArray<Canvas.Shape>): string =>
    Option.getOrElse(Array.head(imageSources(shapes)), () => '')

  test.each([
    ['landscape', LANDSCAPE_SCREEN],
    ['portrait', DEFAULT_PORTRAIT_SCREEN],
  ])('draws the satchel with its found thing, in %s', (_, screen) => {
    const opened = modifyFields(hunting(['FamilyPortrait']), {
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
