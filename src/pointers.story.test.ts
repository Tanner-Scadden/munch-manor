// @vitest-environment happy-dom
import { Effect, Fiber, Option, Stream } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { isTrackingPointer } from './input'
import { update } from './main'
import { Message } from './message'
import { type Model, MouseButton, Phase, Stick, initialModel } from './model'
import { subscriptions } from './subscriptions'
import { SURFACE } from './testing'
import { asVeteran } from './veteran'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const MOUSE_POINTER = 1

const playingModel: Model = modifyFields(asVeteran(initialModel), {
  maybeSurface: () => Option.some(SURFACE),
  lastDevice: () => 'Touch',
  phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
})

const touchDown = (pointerId: number, clientX: number) =>
  message(
    Message.PressedPointer({
      pointerId,
      device: 'Touch',
      clientX,
      clientY: 300,
    }),
  )

const isAnyStickActive = (current: Model): boolean =>
  Stick.isAnyOf(['Active'])(current.input.moveStick) ||
  Stick.isAnyOf(['Active'])(current.input.aimStick)

// NOTE: the subscription listens for real document events, so the event
// goes out on a real timer until it is heard: run it with `it.live`.
const firstReleaseMessage = (dispatch: () => void) => {
  const { pointerReleases } = subscriptions
  const stream = pointerReleases.dependenciesToStream(
    pointerReleases.modelToDependencies(initialModel),
  )
  return Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Stream.runCollect(Stream.take(stream, 1)),
    )
    const dispatcher = yield* Effect.forkChild(
      Effect.forever(
        Effect.andThen(Effect.sleep('10 millis'), Effect.sync(dispatch)),
      ),
    )
    const messages = yield* Fiber.join(fiber).pipe(Effect.timeout('5 seconds'))
    yield* Fiber.interrupt(dispatcher)
    return messages
  }).pipe(Effect.provide(pointerReleases.layer))
}

describe('stuck sticks', () => {
  test('a quick tap that lifts before any frame leaves no stick held', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100),
      touchDown(RIGHT_THUMB, 700),
      message(Message.ReleasedPointer({ pointerId: LEFT_THUMB })),
      message(Message.CancelledPointer({ pointerId: RIGHT_THUMB })),
      model(after => {
        expect(isAnyStickActive(after)).toBe(false)
        expect(isTrackingPointer(after.input)).toBe(false)
        expect(after.intent.trigger).toBe('Released')
      }),
    )
  })

  test('lifting every finger lets go of both sticks but not the mouse', () => {
    story(
      update,
      given(
        modifyFields(playingModel, {
          input: input =>
            modifyFields(input, {
              mouseButton: () => MouseButton.Held({ pointerId: MOUSE_POINTER }),
            }),
        }),
      ),
      touchDown(LEFT_THUMB, 100),
      touchDown(RIGHT_THUMB, 700),
      message(Message.ReleasedEveryTouch()),
      model(after => {
        expect(isAnyStickActive(after)).toBe(false)
        expect(after.input.mouseButton).toEqual(
          MouseButton.Held({ pointerId: MOUSE_POINTER }),
        )
      }),
    )
  })

  test('releasing a pointer nothing tracks changes nothing', () => {
    story(
      update,
      given(playingModel),
      touchDown(LEFT_THUMB, 100),
      message(Message.ReleasedPointer({ pointerId: 404 })),
      model(after => {
        expect(Stick.isAnyOf(['Active'])(after.input.moveStick)).toBe(true)
      }),
    )
  })

  // NOTE: real document events, heard on a real timer (firstReleaseMessage).
  it.live('releases are heard while no pointer is tracked', () =>
    Effect.gen(function* () {
      expect(isTrackingPointer(initialModel.input)).toBe(false)
      const messages = yield* firstReleaseMessage(() => {
        document.dispatchEvent(
          new PointerEvent('pointerup', { pointerId: LEFT_THUMB }),
        )
      })
      expect(messages).toEqual([
        Message.ReleasedPointer({ pointerId: LEFT_THUMB }),
      ])
    }),
  )

  // NOTE: real document events, heard on a real timer (firstReleaseMessage).
  it.live('cancels are heard while no pointer is tracked', () =>
    Effect.gen(function* () {
      const messages = yield* firstReleaseMessage(() => {
        document.dispatchEvent(
          new PointerEvent('pointercancel', { pointerId: RIGHT_THUMB }),
        )
      })
      expect(messages).toEqual([
        Message.CancelledPointer({ pointerId: RIGHT_THUMB }),
      ])
    }),
  )
})
