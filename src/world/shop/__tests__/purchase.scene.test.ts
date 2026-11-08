import { Array, Option } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import { FridgeDoor, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { purchaseOverlayShapes } from '../../../features/shop/purchaseView'
import type { InputDevice } from '../../../input/inputSchema'
import { cameraOf, screenCameraOf } from '../../../render/camera'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  inPortrait,
  midWaveAtStall,
  pastTimedBreaks,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  HOLD_TICKS,
  SCENE_SUBSCRIPTIONS,
  measureSurface,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { FRIDGE_RULES, fridgeBoxOf } from '../../fridge/leftovers'
import { maxRounds } from '../../gear/weapons'
import { levelOf, openExitIn } from '../../level/arena'
import { EXIT_RULES, KITCHEN_EXIT } from '../../level/exits'
import { modifyFocus } from '../../party/party'
import { SHOP_ITEMS } from '../shop'

const atBoards = (device: InputDevice, balance: number): Model =>
  modifyFocus(
    modifyFields(pastTimedBreaks(asVeteran(initialModel)), {
      lastDevice: () => device,
      phase: () =>
        Phase.Preparation({
          wave: 3,
          remainingMs: 15_000,
          durationMs: 20_000,
          spawns: [],
        }),
    }),
    {
      wallet: () => ({ balance, earned: balance, shown: balance }),
      player: player => modifyFields(player, { x: () => 70, y: () => 26 }),
    },
  )

const holdButton = Scene.role('button', {
  name: `Hold to open the kitchen for ${EXIT_RULES.price} dollars`,
})

const frames = (count: number) =>
  Array.makeBy(count, () =>
    Scene.Subscription.emit(
      SCENE_SUBSCRIPTIONS.frame,
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ),
  )

describe('holding to buy on touch', () => {
  it.effect(
    'at the boards a hold button sits by the guns, and holding it buys the kitchen',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atBoards('Touch', 85)),
        measureSurface,
        Scene.expect(holdButton).toExist(),
        Scene.expect(holdButton).toHaveAttr('data-short', 'false'),
        Scene.pointerDown(holdButton, { pointerType: 'touch', pointerId: 4 }),
        ...frames(HOLD_TICKS - 8),
        Scene.expect(holdButton).toExist(),
        ...frames(8),
        Scene.expect(holdButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.pointerReleases,
          Message.ReleasedPointer({ pointerId: 4 }),
        ),
      ),
  )

  it.effect(
    'short of the price the button says so, and a hold only shakes it',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atBoards('Touch', EXIT_RULES.price - 5)),
        measureSurface,
        Scene.expect(holdButton).toHaveAttr('data-short', 'true'),
        Scene.expect(holdButton).toHaveAttr('aria-disabled', 'true'),
        Scene.pointerDown(holdButton, { pointerType: 'touch', pointerId: 4 }),
        ...frames(2),
        Scene.expect(Scene.selector('.hold-buy-button.is-refused')).toExist(),
        ...frames(HOLD_TICKS),
        Scene.expect(holdButton).toExist(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.pointerReleases,
          Message.ReleasedPointer({ pointerId: 4 }),
        ),
      ),
  )
})

describe('holding to buy on a keyboard', () => {
  it.effect(
    'no button shows, and a screen reader hears the price and the key',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(atBoards('KeyboardMouse', 85)),
        measureSurface,
        Scene.expect(holdButton).toBeAbsent(),
        Scene.expect(
          Scene.text(
            `the kitchen, ${EXIT_RULES.price} dollars. Stand still or hold Enter to buy.`,
          ),
        ).toExist(),
      ),
  )
})

describe('taking a fridge prize on touch', () => {
  const offered = (): Model => {
    const kitchen = openExitIn(asVeteran(initialModel).level, KITCHEN_EXIT)
    const box = Option.getOrThrow(fridgeBoxOf(levelOf({ level: kitchen })))
    return modifyFocus(
      modifyFields(atBoards('Touch', 0), {
        level: () => kitchen,
        fridge: fridge =>
          modifyFields(fridge, {
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
          modifyFields(player, {
            x: () => (box.left + box.right) / 2,
            y: () => box.bottom + 8,
          }),
      },
    )
  }

  const takeButton = Scene.role('button', {
    name: 'Hold to take the prize from the fridge',
  })

  it.effect(
    'the hold button says TAKE, not a price, and holding it takes the prize',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(offered()),
        measureSurface,
        Scene.expect(takeButton).toExist(),
        Scene.expect(Scene.selector('.hold-buy-price')).toHaveText('TAKE'),
        Scene.pointerDown(takeButton, { pointerType: 'touch', pointerId: 4 }),
        ...frames(HOLD_TICKS),
        Scene.expect(takeButton).toBeAbsent(),
        Scene.Subscription.emit(
          SCENE_SUBSCRIPTIONS.pointerReleases,
          Message.ReleasedPointer({ pointerId: 4 }),
        ),
      ),
  )
})

describe('the price tag in a zoomed phone window', () => {
  const tagsFor = (model: Model) =>
    purchaseOverlayShapes(model, screenCameraOf(model))
  const upright = (y: number): Model =>
    inPortrait(
      modifyFocus(atBoards('Touch', 85), {
        player: player => modifyFields(player, { y: () => y }),
      }),
    )

  test('hangs on the boards while the window shows them', () => {
    expect(tagsFor(upright(26))).not.toHaveLength(0)
  })

  test('is not drawn over the HUD band once the window has followed the player away', () => {
    expect(cameraOf(upright(170)).y).toBe(20)
    expect(tagsFor(upright(170))).toHaveLength(0)
  })
})

describe('the ammo tag', () => {
  const ammoTag = Scene.selector('.ammo-tag-button')

  it.effect.each(['KeyboardMouse', 'Touch'] as const)(
    'with %s, a click on the tag at the window buys at once',
    device =>
      Scene.scene(
        APPLICATION,
        Scene.given(
          modifyFields(midWaveAtStall('Smg', maxRounds('Smg', 0) - 1), {
            lastDevice: () => device,
          }),
        ),
        measureSurface,
        Scene.expect(ammoTag).toExist(),
        Scene.expect(ammoTag).toHaveAttr(
          'aria-label',
          `Buy ammo for ${SHOP_ITEMS.SmgRounds.price} dollars`,
        ),
        Scene.click(ammoTag),
        ...frames(1),
        Scene.expect(ammoTag).toHaveAttr('aria-label', 'Your gun is full'),
      ),
  )

  it.effect('away from the window there is no tag to click', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(
        modifyFocus(midWaveAtStall('Smg', 10), {
          player: player => modifyFields(player, { x: () => 40 }),
        }),
      ),
      measureSurface,
      Scene.expect(ammoTag).toBeAbsent(),
    ),
  )
})
