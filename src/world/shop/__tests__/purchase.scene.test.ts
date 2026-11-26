import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import { BreakClock, FridgeDoor, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { prizeSprite } from '../../../art/prizeArt'
import { spriteImage } from '../../../art/sprite'
import { PressHoldButton } from '../../../features/shop/purchaseHud'
import { purchaseOverlayShapes } from '../../../features/shop/purchaseView'
import type { InputDevice } from '../../../input/inputSchema'
import { RunButtonMessage } from '../../../input/message'
import { cameraOf, screenCameraOf } from '../../../render/camera'
import { screenOf } from '../../../render/screen'
import { hudKeepoutsOf } from '../../../screens/game/pocket'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  inPortrait,
  pastTimedBreaks,
  withKeys,
} from '../../../test/model.fixture'
import {
  ackHudSlots,
  byClass,
  emitFrame,
  expectAttr,
  expectClass,
  fromSubscription,
  measureHud,
} from '../../../test/sceneTesting'
import {
  HOLD_TICKS,
  PHONE_LANDSCAPE,
  SURFACE,
  type SceneStep,
  sceneOf,
  steps,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { drawnBoxesOf, isOverBox } from '../../../test/viewReading'
import { FRIDGE_RULES, fridgeBoxOf } from '../../fridge/leftovers'
import { levelOf, openExitIn } from '../../level/arena'
import { EXIT_RULES, KITCHEN_EXIT } from '../../level/exits'
import { EAST_EXIT, FAR_EXIT, WEST_EXIT } from '../../level/plan'
import { modifyFocus } from '../../party/party'

const atBoards = (device: InputDevice, keys: number): Model =>
  modifyFocus(
    UiStruct.evolve(withKeys(pastTimedBreaks(asVeteran(initialModel)), keys), {
      lastDevice: () => device,
      phase: () =>
        Phase.Preparation({
          clock: BreakClock.Counting(),
          wave: 3,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [],
        }),
    }),
    {
      player: player => UiStruct.evolve(player, { x: () => 70, y: () => 26 }),
    },
  )

const holdButton = HtmlLocator.role('button', {
  name: `Hold to open the kitchen for ${EXIT_RULES.kitchenKeys} keys`,
})

const frames = (count: number): SceneStep =>
  steps(
    ...Array.makeBy(count, () => steps(emitFrame(FIXED_STEP_MS), ackHudSlots)),
  )

const fingerDown: SceneStep = s =>
  s.mounted(
    PressHoldButton,
    RunButtonMessage.PressedHoldButton({ pointerId: 4 }),
  )

const fingerUp: SceneStep = fromSubscription(
  'PointerReleases',
  Message.ReleasedPointer({ pointerId: 4 }),
)

describe('holding to buy on touch', () => {
  it.effect(
    'at the boards a hold button sits by the guns, and holding it buys the kitchen',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(atBoards('Touch', EXIT_RULES.kitchenKeys + 2))
        s.pipe(measureHud)
          .expect(holdButton)
          .toExist()
          .pipe(
            expectAttr(holdButton, 'data-short', 'false'),
            fingerDown,
            frames(HOLD_TICKS - 8),
          )
          .expect(holdButton)
          .toExist()
          .pipe(frames(8))
          .expect(holdButton)
          .toBeAbsent()
          .pipe(fingerUp)
      }),
  )

  it.effect(
    'short of the price the button says so, and a hold only shakes it',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(atBoards('Touch', EXIT_RULES.kitchenKeys - 1))
        s.pipe(
          measureHud,
          expectAttr(holdButton, 'data-short', 'true'),
          expectAttr(holdButton, 'aria-disabled', 'true'),
          fingerDown,
          frames(2),
          expectClass(holdButton, 'is-refused'),
          frames(HOLD_TICKS),
        )
          .expect(holdButton)
          .toExist()
          .pipe(fingerUp)
      }),
  )
})

describe('holding to buy on a keyboard', () => {
  it.effect(
    'no button shows, and a screen reader hears the price and the key',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(
          atBoards('KeyboardMouse', EXIT_RULES.kitchenKeys + 2),
        )
        s.pipe(measureHud)
          .expect(holdButton)
          .toBeAbsent()
          .expect(
            Locator.text(
              `the kitchen, ${EXIT_RULES.kitchenKeys} keys. Stand still or hold Enter to buy.`,
            ),
          )
          .toExist()
      }),
  )
})

describe('taking a fridge prize on touch', () => {
  const offered = (): Model => {
    const kitchen = openExitIn(asVeteran(initialModel).level, KITCHEN_EXIT)
    const box = Option.getOrThrow(fridgeBoxOf(levelOf({ level: kitchen })))
    return modifyFocus(
      UiStruct.evolve(atBoards('Touch', 0), {
        level: () => kitchen,
        fridge: fridge =>
          UiStruct.evolve(fridge, {
            door: () =>
              FridgeDoor.Offering({
                prize: 'Freeze',
                slot: 0,
                remainingMs: 5000,
                durationMs: FRIDGE_RULES.offerMs,
              }),
          }),
      }),
      {
        player: player =>
          UiStruct.evolve(player, {
            x: () => (box.left + box.right) / 2,
            y: () => box.bottom + 8,
          }),
      },
    )
  }

  const takeButton = HtmlLocator.role('button', {
    name: 'Hold to take the prize from the fridge',
  })

  it.effect(
    'the hold button shows a hand and the prize, no word, and holding it takes the prize',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(offered())
        s.pipe(
          measureHud,
          expectAttr(
            byClass('hold-buy-take-item'),
            'src',
            Option.getOrThrow(spriteImage(prizeSprite('Freeze'))).src,
          ),
        )
          .expect(takeButton)
          .toExist()
          .expect(byClass('hold-buy-take-hand'))
          .toExist()
          .expect(byClass('hold-buy-price'))
          .toHaveText('')
          .pipe(fingerDown, frames(HOLD_TICKS))
          .expect(takeButton)
          .toBeAbsent()
          .pipe(fingerUp)
      }),
  )
})

describe('the price tag in a zoomed phone window', () => {
  const tagsFor = (model: Model) =>
    purchaseOverlayShapes(model, screenCameraOf(model), hudKeepoutsOf(model))
  const upright = (y: number): Model =>
    inPortrait(
      modifyFocus(
        UiStruct.evolve(atBoards('Touch', EXIT_RULES.kitchenKeys + 2), {
          level: level =>
            Array.reduce([WEST_EXIT, EAST_EXIT, FAR_EXIT], level, openExitIn),
        }),
        { player: player => UiStruct.evolve(player, { y: () => y }) },
      ),
    )

  test('hangs on the boards while the window shows them', () => {
    expect(tagsFor(upright(26))).not.toHaveLength(0)
  })

  test('is not drawn over the HUD band once the window has followed the player away', () => {
    expect(cameraOf(upright(170)).y).toBeGreaterThan(cameraOf(upright(26)).y)
    expect(tagsFor(upright(170))).toHaveLength(0)
  })
})

describe('a price tag at the edge of the window', () => {
  const sideways = (model: Model): Model =>
    UiStruct.evolve(model, {
      maybeSurface: () => Option.some(PHONE_LANDSCAPE),
    })
  const onDesktop = (model: Model): Model =>
    UiStruct.evolve(model, {
      lastDevice: (): InputDevice => 'KeyboardMouse',
      maybeSurface: () => Option.some(SURFACE),
    })
  const LAYOUTS: ReadonlyArray<Readonly<[string, (model: Model) => Model]>> = [
    ['a phone on its side', sideways],
    ['a phone held upright', inPortrait],
    ['a desktop', onDesktop],
  ]
  const STRIDE = 12
  const start = atBoards('Touch', EXIT_RULES.kitchenKeys + 2)
  const { bounds } = levelOf(start)
  const spots = Array.flatMap(
    Array.range(0, Math.floor((bounds.right - bounds.left) / STRIDE)),
    column =>
      Array.map(
        Array.range(0, Math.floor((bounds.bottom - bounds.top) / STRIDE)),
        row => ({
          x: bounds.left + column * STRIDE,
          y: bounds.top + row * STRIDE,
        }),
      ),
  )

  test.each(LAYOUTS)(
    'stays whole in the window and off the HUD on %s',
    (_name, layout) => {
      const misses = Array.flatMap(spots, spot => {
        const model = layout(
          modifyFocus(start, {
            player: player =>
              UiStruct.evolve(player, { x: () => spot.x, y: () => spot.y }),
          }),
        )
        const window = screenOf(model).world
        const keepouts = hudKeepoutsOf(model)
        const drawn = drawnBoxesOf(
          purchaseOverlayShapes(model, screenCameraOf(model), keepouts),
        )
        return Array.filter(
          drawn,
          box =>
            box.left < window.x ||
            box.top < window.y ||
            box.right > window.x + window.width ||
            box.bottom > window.y + window.height ||
            Array.some(keepouts, isOverBox(box)),
        ).length > 0
          ? [spot]
          : []
      })
      expect(misses).toEqual([])
    },
  )
})
