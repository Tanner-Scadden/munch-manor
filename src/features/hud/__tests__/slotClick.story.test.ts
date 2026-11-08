import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { GameEvent, type Model, Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import type { PointerDevice } from '../../../input/inputSchema'
import { MELEE_SLOT_INDEX, gunSlotBox } from '../../../render/hudLayout'
import { screenOf } from '../../../render/screen'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import {
  APPLICATION,
  FIXED_FRAME,
  SURFACE,
  holdingFirst,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { freshGun, heldWeapon } from '../../../world/gear/weapons'
import { modifyFocus } from '../../../world/party/party'

// The HUD's gun and knife slots sit at the bottom middle, over the world.
// Mid-wave a mouse click there is a shot at the zombie beneath, not a swap,
// so a desktop player never changes guns by aiming low. A tap on a phone
// still equips, and in a break a mouse click on a slot does too.

const MOUSE = 1
const FINGER = 7

const armed = (phase: Phase): Model =>
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      maybeSurface: () => Option.some(SURFACE),
      phase: () => phase,
      zombies: () => [],
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => 100,
          y: () => 104,
          arsenal: () => holdingFirst(freshGun('Smg')),
        }),
    },
  )

const midWave = armed(
  Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
)

const inBreak = armed(
  Phase.Preparation({
    wave: 4,
    remainingMs: 15_000,
    durationMs: 20_000,
    spawns: [DISTANT_SPAWN],
  }),
)

// NOTE: the middle of a HUD slot, in view units and as the browser's
// client point on SURFACE.
const slotMiddle = (current: Model, index: number) => {
  const screen = screenOf(current)
  const box = gunSlotBox(screen, index)
  const view = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const scale = Math.min(
    SURFACE.width / screen.width,
    SURFACE.height / screen.height,
  )
  const left = SURFACE.left + (SURFACE.width - screen.width * scale) / 2
  const top = SURFACE.top + (SURFACE.height - screen.height * scale) / 2
  return {
    view,
    client: { x: left + view.x * scale, y: top + view.y * scale },
  }
}

const pressSlot = (
  current: Model,
  index: number,
  device: PointerDevice,
  pointerId: number,
) => {
  const { client } = slotMiddle(current, index)
  return Message.PressedHudSlot({
    pointerId,
    device,
    clientX: client.x,
    clientY: client.y,
  })
}

const hasFired = (current: Model): boolean =>
  Array.some(current.frameEvents, GameEvent.isAnyOf(['Fired']))

describe('a press on a HUD slot', () => {
  it.effect(
    'mid-wave, a mouse press on the knife slot shoots through it and leaves the knife be',
    () => {
      const { view } = slotMiddle(midWave, MELEE_SLOT_INDEX)
      return Story.story(
        APPLICATION,
        Story.given(midWave),
        Story.message(pressSlot(midWave, MELEE_SLOT_INDEX, 'Mouse', MOUSE)),
        Story.model(({ input, lastDevice }) => {
          expect(input.mouseButton._tag).toBe('Held')
          expect(lastDevice).toBe('KeyboardMouse')
          const aim = Option.getOrThrow(input.maybeMouseInView)
          expect(aim.x).toBeCloseTo(view.x)
          expect(aim.y).toBeCloseTo(view.y)
        }),
        Story.message(FIXED_FRAME),
        Story.model(current => {
          expect(hasFired(current)).toBe(true)
        }),
        Story.message(Message.ReleasedPointer({ pointerId: MOUSE })),
        Story.message(Message.ClickedMeleeSlot()),
        Story.model(({ seats: [{ player }], input }) => {
          expect(player.wield).toBe('Gun')
          expect(heldWeapon(player.arsenal)).toBe('Pistol')
          expect(input.mouseButton._tag).toBe('Released')
          expect(input.slotClick).toBe('Acts')
        }),
      )
    },
  )

  it.effect(
    'mid-wave, a mouse press on the other gun slot shoots and does not swap',
    () =>
      Story.story(
        APPLICATION,
        Story.given(midWave),
        Story.message(pressSlot(midWave, 1, 'Mouse', MOUSE)),
        Story.message(FIXED_FRAME),
        Story.model(current => {
          expect(hasFired(current)).toBe(true)
        }),
        Story.message(Message.ReleasedPointer({ pointerId: MOUSE })),
        Story.message(Message.ClickedGunSlot({ slot: 'Second' })),
        Story.model(({ seats: [{ player }] }) => {
          expect(heldWeapon(player.arsenal)).toBe('Pistol')
        }),
      ),
  )

  it.effect(
    'mid-wave, a tap on the knife slot still draws the knife and fires nothing',
    () =>
      Story.story(
        APPLICATION,
        Story.given(midWave),
        Story.message(pressSlot(midWave, MELEE_SLOT_INDEX, 'Touch', FINGER)),
        Story.model(({ input, lastDevice }) => {
          expect(input.mouseButton._tag).toBe('Released')
          expect(input.aimStick._tag).toBe('Idle')
          expect(input.moveStick._tag).toBe('Idle')
          expect(lastDevice).toBe('Touch')
        }),
        Story.message(Message.ReleasedPointer({ pointerId: FINGER })),
        Story.message(Message.ClickedMeleeSlot()),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Melee')
        }),
        Story.message(FIXED_FRAME),
        Story.model(current => {
          expect(hasFired(current)).toBe(false)
        }),
      ),
  )

  it.effect(
    'in a break, a mouse click on the knife slot draws the knife and fires nothing',
    () =>
      Story.story(
        APPLICATION,
        Story.given(inBreak),
        Story.message(pressSlot(inBreak, MELEE_SLOT_INDEX, 'Mouse', MOUSE)),
        Story.model(({ input }) => {
          expect(input.mouseButton._tag).toBe('Released')
        }),
        Story.message(Message.ReleasedPointer({ pointerId: MOUSE })),
        Story.message(Message.ClickedMeleeSlot()),
        Story.model(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Melee')
        }),
        Story.message(FIXED_FRAME),
        Story.model(current => {
          expect(hasFired(current)).toBe(false)
        }),
      ),
  )

  it.effect('in a break, a mouse click on the other gun slot swaps to it', () =>
    Story.story(
      APPLICATION,
      Story.given(inBreak),
      Story.message(pressSlot(inBreak, 1, 'Mouse', MOUSE)),
      Story.message(Message.ReleasedPointer({ pointerId: MOUSE })),
      Story.message(Message.ClickedGunSlot({ slot: 'Second' })),
      Story.model(({ seats: [{ player }] }) => {
        expect(heldWeapon(player.arsenal)).toBe('Smg')
      }),
    ),
  )

  it.effect('only the one click passes through: the next activation acts', () =>
    Story.story(
      APPLICATION,
      Story.given(midWave),
      Story.message(pressSlot(midWave, MELEE_SLOT_INDEX, 'Mouse', MOUSE)),
      Story.message(Message.ReleasedPointer({ pointerId: MOUSE })),
      Story.message(Message.ClickedMeleeSlot()),
      Story.message(Message.ClickedMeleeSlot()),
      Story.model(({ seats: [{ player }] }) => {
        expect(player.wield).toBe('Melee')
      }),
    ),
  )
})
