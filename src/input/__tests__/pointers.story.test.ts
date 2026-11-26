// @vitest-environment happy-dom
import { Array, Effect, Fiber, Option, Stream } from 'effect'

import { type Subscription, UiStruct } from '@effect/ui'
import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../app/message'
import { GameEvent, type Model, Phase } from '../../app/model'
import { initialModel } from '../../app/pureApp'
import { subscriptions } from '../../app/subscriptions'
import { FIXED_STEP_MS } from '../../shared/constants'
import {
  FIRE_LIFT,
  FIRE_PRESS,
  FIRE_PUSH,
  SURFACE,
  checkModel,
  send,
  settleRunCommands,
  storyOf,
  tick,
  ticks,
} from '../../test/testing'
import { asVeteran } from '../../test/veteran'
import { focusOf } from '../../world/party/party'
import { isTrackingPointer } from '../input'
import { MouseButton, Stick } from '../inputSchema'

const LEFT_THUMB = 11
const RIGHT_THUMB = 12
const MOUSE_POINTER = 1

const playingModel: Model = UiStruct.evolve(asVeteran(initialModel), {
  maybeSurface: () => Option.some(SURFACE),
  lastDevice: () => 'Touch',
  phase: () => Phase.Wave({ wave: 1, elapsedMs: 0, spawns: [] }),
})

const touchDown = (pointerId: number, clientX: number) =>
  send(
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

// NOTE: the root's PointerReleases Subscription, as the root lists it for
// `model`. Its stream reads only the document, never the services other
// Subscriptions in the list need, so the guard names it with none.
const isPointerReleases = (
  subscription: Subscription.Subscription<Message, unknown>,
): subscription is Subscription.Subscription<Message> =>
  subscription.name === 'PointerReleases'

const pointerReleasesFor = (model: Model): Stream.Stream<Message> =>
  Option.getOrThrow(
    Array.findFirst(subscriptions({ model }), isPointerReleases),
  ).stream

// NOTE: the subscription listens for real document events, so the event
// goes out on a real timer until it is heard: run it with `it.live`.
const firstReleaseMessage = (dispatch: () => void) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Stream.runCollect(Stream.take(pointerReleasesFor(initialModel), 1)),
    )
    const dispatcher = yield* Effect.forkChild(
      Effect.forever(
        Effect.andThen(Effect.sleep('10 millis'), Effect.sync(dispatch)),
      ),
    )
    const messages = yield* Fiber.join(fiber).pipe(Effect.timeout('5 seconds'))
    yield* Fiber.interrupt(dispatcher)
    return messages
  })

describe('stuck sticks', () => {
  it.effect(
    'a quick tap that lifts before any frame leaves no stick held',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(playingModel)
        s.pipe(
          touchDown(LEFT_THUMB, 100),
          touchDown(RIGHT_THUMB, 700),
          send(Message.ReleasedPointer({ pointerId: LEFT_THUMB })),
          send(Message.CancelledPointer({ pointerId: RIGHT_THUMB })),
          checkModel(after => {
            expect(isAnyStickActive(after)).toBe(false)
            expect(isTrackingPointer(after.input)).toBe(false)
            expect(focusOf(after).intent.trigger).toBe('Released')
          }),
        )
      }),
  )

  it.effect(
    'lifting every finger lets go of both sticks but not the mouse',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(playingModel, {
            input: input =>
              UiStruct.evolve(input, {
                mouseButton: () =>
                  MouseButton.Held({ pointerId: MOUSE_POINTER }),
              }),
          }),
        )
        s.pipe(
          touchDown(LEFT_THUMB, 100),
          touchDown(RIGHT_THUMB, 700),
          send(Message.ChangedTouches({ points: [] })),
          checkModel(after => {
            expect(isAnyStickActive(after)).toBe(false)
            expect(after.input.mouseButton).toEqual(
              MouseButton.Held({ pointerId: MOUSE_POINTER }),
            )
          }),
        )
      }),
  )

  it.effect(
    'a stick whose finger lifted unheard lets go at the next touch',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(playingModel)
        s.pipe(
          touchDown(LEFT_THUMB, 100),
          touchDown(RIGHT_THUMB, 700), // NOTE: the left thumb's lift is lost; the right thumb is still down.
          send(
            Message.ChangedTouches({
              points: [{ clientX: 700, clientY: 300 }],
            }),
          ),
          checkModel(after => {
            expect(after.input.moveStick).toEqual(Stick.Idle())
            expect(Stick.isAnyOf(['Active'])(after.input.aimStick)).toBe(true)
          }),
        )
      }),
  )

  it.effect('a finger still on the glass keeps its stick as it moves', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        touchDown(LEFT_THUMB, 100),
        send(
          Message.MovedPointer({
            pointerId: LEFT_THUMB,
            clientX: 160,
            clientY: 280,
          }),
        ),
        send(
          Message.ChangedTouches({ points: [{ clientX: 175, clientY: 290 }] }),
        ),
        checkModel(after => {
          expect(Stick.isAnyOf(['Active'])(after.input.moveStick)).toBe(true)
        }),
      )
    }),
  )

  it.effect('a thumb landing on a stick left held takes it back', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        touchDown(LEFT_THUMB, 100),
        touchDown(13, 140),
        send(
          Message.MovedPointer({
            pointerId: LEFT_THUMB,
            clientX: 40,
            clientY: 300,
          }),
        ),
        send(Message.ReleasedPointer({ pointerId: 13 })),
        checkModel(after => {
          expect(after.input.moveStick).toEqual(Stick.Idle())
        }),
      )
    }),
  )

  it.effect('releasing a pointer nothing tracks changes nothing', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        touchDown(LEFT_THUMB, 100),
        send(Message.ReleasedPointer({ pointerId: 404 })),
        checkModel(after => {
          expect(Stick.isAnyOf(['Active'])(after.input.moveStick)).toBe(true)
        }),
      )
    }),
  )

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

// NOTE: a slow frame can come after a click is already let go. The press
// waits for the next step (FirePress), so the shot is still fired, once.
describe('quick clicks on slow frames', () => {
  const firedOn = (current: Model): number =>
    Array.filter(current.frameEvents, GameEvent.isAnyOf(['Fired'])).length

  it.effect('a mouse click let go before the next frame still fires once', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(playingModel, { lastDevice: () => 'KeyboardMouse' }),
      )
      s.pipe(
        send(
          Message.PressedPointer({
            pointerId: MOUSE_POINTER,
            device: 'Mouse',
            clientX: 600,
            clientY: 200,
          }),
        ),
        send(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
        tick(FIXED_STEP_MS),
        checkModel(after => {
          expect(firedOn(after)).toBe(1)
          expect(after.input.firePress).toBe('Seen')
        }),
        ticks(30, FIXED_STEP_MS),
        checkModel(after => {
          expect(focusOf(after).intent.trigger).toBe('Released')
          expect(firedOn(after)).toBe(0)
        }),
        settleRunCommands,
      )
    }),
  )

  it.effect('a thumb flicked through the fire zone between frames fires', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(playingModel)
      s.pipe(
        send(FIRE_PRESS),
        send(FIRE_PUSH),
        send(FIRE_LIFT),
        tick(FIXED_STEP_MS),
        checkModel(after => {
          expect(firedOn(after)).toBe(1)
        }),
        settleRunCommands,
      )
    }),
  )
})
