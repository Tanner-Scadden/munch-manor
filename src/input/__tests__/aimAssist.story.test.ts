import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { type Model, Phase } from '#app/model.ts'
import { initialModel } from '#app/pureApp.ts'
import { AIM_ASSIST } from '#input/aimAssist.ts'
import { MouseButton, Stick } from '#input/inputSchema.ts'
import { screenCameraOf, worldToView } from '#render/camera.ts'
import { screenToFloorDirection } from '#render/lens.ts'
import { FIXED_STEP_MS, STICK_RADIUS_PX } from '#shared/constants.ts'
import { DISTANT_SPAWN } from '#test/model.fixture.ts'
import {
  PHONE_LANDSCAPE,
  PHONE_PORTRAIT,
  START_SPOT,
  checkModel,
  send,
  storyOf,
  tick,
  zombieOf,
} from '#test/testing.ts'
import { asVeteran } from '#test/veteran.ts'
import { focusOf, modifyFocus } from '#world/party/party.ts'

const PLAYER = START_SPOT
const ZOMBIE_DISTANCE_PX = 40

const RIGHT_ON_SCREEN = (() => {
  const { x, y } = screenToFloorDirection({ x: 1, y: 0 })
  return Math.atan2(y, x)
})()

const aimingRight = (
  orientation: 'Portrait' | 'Landscape',
  offAim: number,
): Model => {
  const zombieAngle = RIGHT_ON_SCREEN + offAim
  return modifyFocus(
    UiStruct.evolve(asVeteran(initialModel), {
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
        UiStruct.evolve(input, {
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
}

const aimAngleOf = (current: Model): number =>
  Option.match(focusOf(current).intent.maybeAim, {
    onNone: () => Number.NaN,
    onSome: ({ x, y }) => Math.atan2(y, x),
  })

const mouseAimingRight = (zombieAngle: number): Model => {
  const touching = aimingRight('Landscape', zombieAngle)
  const mousing = UiStruct.evolve(touching, {
    lastDevice: () => 'KeyboardMouse',
    maybeSurface: () => Option.none(),
  })
  return UiStruct.evolve(mousing, {
    input: input =>
      UiStruct.evolve(input, {
        aimStick: () => Stick.Idle(),
        mouseButton: () => MouseButton.Held({ pointerId: 1 }),
        maybeMouseInView: () =>
          Option.some(
            worldToView(screenCameraOf(mousing), {
              x: PLAYER.x + Math.cos(RIGHT_ON_SCREEN) * ZOMBIE_DISTANCE_PX,
              y: PLAYER.y + Math.sin(RIGHT_ON_SCREEN) * ZOMBIE_DISTANCE_PX,
            }),
          ),
      }),
  })
}

describe('aim assist on touch', () => {
  it.effect(
    'held upright, a held aim a few degrees off a zombie lands on it',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(aimingRight('Portrait', 0.06))
        s.pipe(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(aimAngleOf(current)).toBeCloseTo(RIGHT_ON_SCREEN + 0.06, 5)
          }),
        )
      }),
  )

  it.effect(
    'held sideways, a held aim a few degrees off a zombie lands on it',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(aimingRight('Landscape', 0.06))
        s.pipe(
          tick(FIXED_STEP_MS),
          checkModel(current => {
            expect(aimAngleOf(current)).toBeCloseTo(RIGHT_ON_SCREEN + 0.06, 5)
          }),
        )
      }),
  )

  it.effect(
    'past the inner cone the pull fades, and past the outer cone it is gone',
    () =>
      Effect.gen(function* () {
        const between =
          (AIM_ASSIST.Touch.innerRadians + AIM_ASSIST.Touch.outerRadians) / 2
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(aimingRight('Landscape', between))
            s.pipe(
              tick(FIXED_STEP_MS),
              checkModel(current => {
                expect(aimAngleOf(current)).toBeCloseTo(
                  RIGHT_ON_SCREEN + between / 2,
                  5,
                )
              }),
            )
          }),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const s = yield* storyOf(
              aimingRight('Portrait', AIM_ASSIST.Touch.outerRadians + 0.05),
            )
            s.pipe(
              tick(FIXED_STEP_MS),
              checkModel(current => {
                expect(aimAngleOf(current)).toBeCloseTo(RIGHT_ON_SCREEN, 5)
              }),
            )
          }),
        )
      }),
  )

  it.effect('a held mouse goes exactly where it points', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(mouseAimingRight(0.06))
      s.pipe(
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(aimAngleOf(current)).toBeCloseTo(RIGHT_ON_SCREEN, 5)
        }),
      )
    }),
  )

  it.effect('a key press hands the aim back to the player, untouched', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(aimingRight('Landscape', 0.06))
      s.pipe(
        send(Message.PressedKey({ code: 'KeyW' })),
        tick(FIXED_STEP_MS),
        checkModel(current => {
          expect(current.lastDevice).toBe('KeyboardMouse')
          expect(aimAngleOf(current)).toBeCloseTo(RIGHT_ON_SCREEN, 5)
        }),
      )
    }),
  )
})
