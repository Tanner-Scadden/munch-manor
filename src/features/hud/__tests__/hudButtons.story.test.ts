import { Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { Message } from '../../../app/message'
import { type Model, Phase, Reload } from '../../../app/model'
import { initialModel, update } from '../../../app/pureApp'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import { SURFACE, holdingSecond } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { heldWeapon } from '../../../world/gear/weapons'
import { focusOf, modifyFocus } from '../../../world/party/party'

// The touch HUD's gun slots, melee slot, and reload button act on their
// click. A browser makes no click for a tap while another finger is down, so
// with a thumb on the move stick the slots used to do nothing: the owner
// could not swap or reload while moving. src/input/touchTaps.ts now makes that
// click from the second finger's own tap (tested in src/input/__tests__/touchTaps.test.ts
// and in headless Chrome by tools/audit/twoThumbs.ts); these stories check
// that the click does its job with the move stick held, and leaves it held.

const MOVE_FINGER = 3

const carrying = (loaded: number): Model =>
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      lastDevice: () => 'Touch',
      maybeSurface: () => Option.some(SURFACE),
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => [],
    }),
    {
      player: player =>
        modifyFields(player, {
          arsenal: () =>
            holdingSecond({ kind: 'Smg', rounds: 90, loaded, tier: 0 }),
        }),
    },
  )

// NOTE: the left thumb lands on the left of the surface, the move stick.
const moveThumbDown = Message.PressedPointer({
  pointerId: MOVE_FINGER,
  device: 'Touch',
  clientX: 120,
  clientY: 260,
})

const moveThumbDrag = Message.MovedPointer({
  pointerId: MOVE_FINGER,
  clientX: 150,
  clientY: 250,
})

const isReloading = (current: Model): boolean =>
  Reload.isAnyOf(['Reloading'])(focusOf(current).player.reload)

describe('a HUD tap with the move stick held', () => {
  test('swaps guns while the first holds the move stick, and the stick stays held', () => {
    story(
      update,
      given(carrying(20)),
      message(moveThumbDown),
      message(moveThumbDrag),
      model(({ input }) => {
        expect(input.moveStick._tag).toBe('Active')
      }),
      message(Message.ClickedGunSlot({ slot: 'First' })),
      model(({ input, seats: [{ player }] }) => {
        expect(heldWeapon(player.arsenal)).toBe('Pistol')
        expect(input.moveStick._tag).toBe('Active')
      }),
    )
  })

  test('draws the knife and reloads while the move stick is held', () => {
    story(
      update,
      given(carrying(20)),
      message(moveThumbDown),
      message(Message.ClickedMeleeSlot()),
      model(({ seats: [{ player }] }) => {
        expect(player.wield).toBe('Melee')
      }),
      message(Message.ClickedReloadButton()),
      model(current => {
        expect(focusOf(current).player.wield).toBe('Gun')
        expect(isReloading(current)).toBe(true)
        expect(current.input.moveStick._tag).toBe('Active')
      }),
    )
  })
})

describe('the reload button', () => {
  test('reloads the held gun', () => {
    story(
      update,
      given(carrying(20)),
      message(Message.ClickedReloadButton()),
      model(current => {
        expect(isReloading(current)).toBe(true)
        expect(heldWeapon(focusOf(current).player.arsenal)).toBe('Smg')
      }),
    )
  })

  test('with the knife out, draws the last gun and reloads it, as R does', () => {
    const knifeOut = modifyFocus(carrying(20), {
      player: player => modifyFields(player, { wield: () => 'Melee' }),
    })
    story(
      update,
      given(knifeOut),
      message(Message.ClickedReloadButton()),
      model(current => {
        expect(focusOf(current).player.wield).toBe('Gun')
        expect(heldWeapon(focusOf(current).player.arsenal)).toBe('Smg')
        expect(isReloading(current)).toBe(true)
      }),
    )
  })

  test('with a full magazine, loads nothing', () => {
    story(
      update,
      given(carrying(30)),
      message(Message.ClickedReloadButton()),
      model(current => {
        expect(isReloading(current)).toBe(false)
        expect(focusOf(current).player.wield).toBe('Gun')
      }),
    )
  })
})
