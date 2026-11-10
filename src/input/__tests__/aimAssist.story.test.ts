import { Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { screenCameraOf, worldToView } from '../../render/camera'
import { FIXED_STEP_MS, STICK_RADIUS_PX } from '../../shared/constants'
import { DISTANT_SPAWN } from '../../test/model.fixture'
import {
  APPLICATION,
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  START_SPOT,
  tick,
  zombieOf,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { focusOf, modifyFocus } from '../../world/party/party'
import { AIM_ASSIST } from '../aimAssist'
import { MouseButton, Stick } from '../inputSchema'

// NOTE: the start spot, with open floor east of it to the candelabra.
const PLAYER = START_SPOT
const ZOMBIE_DISTANCE_PX = 40

// NOTE: the right thumb holds the aim stick straight right, so the raw aim
// is angle 0 and the trigger is held.
const aimingRight = (
  orientation: 'Portrait' | 'Landscape',
  zombieAngle: number,
): Model =>
  modifyFocus(
    modifyFields(asVeteran(initialModel), {
      lastDevice: () => 'Touch',
      orientation: () => orientation,
      maybeSurface: () =>
        Option.some(
          orientation === 'Portrait' ? PHONE_PORTRAIT : PHONE_LANDSCAPE,
        ),
      phase: () =>
        Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      zombies: () => [
        zombieOf(
          'Shambler',
          900,
          PLAYER.x + Math.cos(zombieAngle) * ZOMBIE_DISTANCE_PX,
          PLAYER.y + Math.sin(zombieAngle) * ZOMBIE_DISTANCE_PX,
        ),
      ],
      input: input =>
        modifyFields(input, {
          aimStick: () =>
            Stick.Active({
              pointerId: 12,
              originX: 300,
              originY: 700,
              currentX: 300 + STICK_RADIUS_PX,
              currentY: 700,
            }),
        }),
    }),
    { player: player => ({ ...player, ...PLAYER }) },
  )

const aimAngleOf = (current: Model): number =>
  Option.match(focusOf(current).intent.maybeAim, {
    onNone: () => Number.NaN,
    onSome: ({ x, y }) => Math.atan2(y, x),
  })

// NOTE: the same zombie and the same aim, with a mouse held on the
// zombie's side of the player instead of a thumb on the stick.
const mouseAimingRight = (zombieAngle: number): Model => {
  const touching = aimingRight('Landscape', zombieAngle)
  const mousing = modifyFields(touching, {
    lastDevice: () => 'KeyboardMouse',
    maybeSurface: () => Option.none(),
  })
  return modifyFields(mousing, {
    input: input =>
      modifyFields(input, {
        aimStick: () => Stick.Idle(),
        mouseButton: () => MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: () =>
          Option.some(
            worldToView(screenCameraOf(mousing), {
              x: PLAYER.x + ZOMBIE_DISTANCE_PX,
              y: PLAYER.y,
            }),
          ),
      }),
  })
}

describe('aim assist on touch', () => {
  it.effect(
    'held upright, a held aim a few degrees off a zombie lands on it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(aimingRight('Portrait', 0.06)),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(aimAngleOf(current)).toBeCloseTo(0.06, 5)
        }),
      ),
  )

  it.effect(
    'held sideways, a held aim a few degrees off a zombie lands on it',
    () =>
      Story.story(
        APPLICATION,
        Story.given(aimingRight('Landscape', 0.06)),
        tick(FIXED_STEP_MS),
        Story.model(current => {
          expect(aimAngleOf(current)).toBeCloseTo(0.06, 5)
        }),
      ),
  )

  it.effect(
    'past the inner cone the pull fades, and past the outer cone it is gone',
    () =>
      Effect.gen(function* () {
        const between = (AIM_ASSIST.innerRadians + AIM_ASSIST.outerRadians) / 2
        yield* Story.story(
          APPLICATION,
          Story.given(aimingRight('Landscape', between)),
          tick(FIXED_STEP_MS),
          Story.model(current => {
            expect(aimAngleOf(current)).toBeCloseTo(between / 2, 5)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(aimingRight('Portrait', AIM_ASSIST.outerRadians + 0.05)),
          tick(FIXED_STEP_MS),
          Story.model(current => {
            expect(aimAngleOf(current)).toBeCloseTo(0, 5)
          }),
        )
      }),
  )

  it.effect('a held mouse goes exactly where it points', () =>
    Story.story(
      APPLICATION,
      Story.given(mouseAimingRight(0.06)),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(aimAngleOf(current)).toBeCloseTo(0, 5)
      }),
    ),
  )

  it.effect('a key press hands the aim back to the player, untouched', () =>
    Story.story(
      APPLICATION,
      Story.given(aimingRight('Landscape', 0.06)),
      Story.message(Message.PressedKey({ code: 'KeyW' })),
      tick(FIXED_STEP_MS),
      Story.model(current => {
        expect(current.lastDevice).toBe('KeyboardMouse')
        expect(aimAngleOf(current)).toBeCloseTo(0, 5)
      }),
    ),
  )
})
