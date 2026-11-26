import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { type Model, Phase, Reload } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { holdingSecond } from '../../../test/arsenals'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import { SURFACE, checkModel, send, storyOf } from '../../../test/testing'
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
    UiStruct.evolve(asVeteran(initialModel), {
      lastDevice: () => 'Touch',
      maybeSurface: () => Option.some(SURFACE),
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => [],
    }),
    {
      player: player =>
        UiStruct.evolve(player, {
          arsenal: () =>
            holdingSecond({ kind: 'Smg', loaded, tier: 0, kills: 0 }),
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
  it.effect(
    'swaps guns while the first holds the move stick, and the stick stays held',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(carrying(20))
        s.pipe(
          send(moveThumbDown),
          send(moveThumbDrag),
          checkModel(({ input }) => {
            expect(input.moveStick._tag).toBe('Active')
          }),
          send(Message.ClickedGunSlot({ slot: 'First' })),
          checkModel(({ input, seats: [{ player }] }) => {
            expect(heldWeapon(player.arsenal)).toBe('Pistol')
            expect(input.moveStick._tag).toBe('Active')
          }),
        )
      }),
  )

  it.effect('draws the knife and reloads while the move stick is held', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(carrying(20))
      s.pipe(
        send(moveThumbDown),
        send(Message.ClickedMeleeSlot()),
        checkModel(({ seats: [{ player }] }) => {
          expect(player.wield).toBe('Melee')
        }),
        send(Message.ClickedReloadButton()),
        checkModel(current => {
          expect(focusOf(current).player.wield).toBe('Gun')
          expect(isReloading(current)).toBe(true)
          expect(current.input.moveStick._tag).toBe('Active')
        }),
      )
    }),
  )
})

describe('the reload button', () => {
  it.effect('reloads the held gun', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(carrying(20))
      s.pipe(
        send(Message.ClickedReloadButton()),
        checkModel(current => {
          expect(isReloading(current)).toBe(true)
          expect(heldWeapon(focusOf(current).player.arsenal)).toBe('Smg')
        }),
      )
    }),
  )

  it.effect(
    'with the knife out, draws the last gun and reloads it, as R does',
    () => {
      const knifeOut = modifyFocus(carrying(20), {
        player: player => UiStruct.evolve(player, { wield: () => 'Melee' }),
      })
      return Effect.gen(function* () {
        const s = yield* storyOf(knifeOut)
        s.pipe(
          send(Message.ClickedReloadButton()),
          checkModel(current => {
            expect(focusOf(current).player.wield).toBe('Gun')
            expect(heldWeapon(focusOf(current).player.arsenal)).toBe('Smg')
            expect(isReloading(current)).toBe(true)
          }),
        )
      })
    },
  )

  it.effect('with a full magazine, loads nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(carrying(30))
      s.pipe(
        send(Message.ClickedReloadButton()),
        checkModel(current => {
          expect(isReloading(current)).toBe(false)
          expect(focusOf(current).player.wield).toBe('Gun')
        }),
      )
    }),
  )
})
