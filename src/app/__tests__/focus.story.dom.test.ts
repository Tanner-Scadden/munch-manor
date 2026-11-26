import { Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { Arsenal, type Model, Phase, RunMode } from '#app/model.ts'
import {
  type KeyDown,
  maybeKeyDownMessage,
  maybeWindowBlurMessage,
} from '#app/subscriptions.ts'
import { MouseButton, Stick } from '#input/inputSchema.ts'
import { screenToFloorDirection } from '#render/lens.ts'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '#shared/constants.ts'
import { holdingFirst } from '#test/arsenals.ts'
import { WAVE_2_BREAK, WAVE_2_FIGHT, readyModel } from '#test/model.fixture.ts'
import {
  type StoryStep,
  checkModel,
  send,
  steps,
  storyOf,
  throughIntro,
  tick,
} from '#test/testing.ts'
import { modifyFocus } from '#world/party/party.ts'

const FRAME_MS = FIXED_STEP_MS
const MOUSE_POINTER = 1
const RIGHT_THUMB = 12

const fightingModel: Model = UiStruct.evolve(readyModel, {
  phase: () => WAVE_2_FIGHT,
})

const pausedModel: Model = UiStruct.evolve(readyModel, {
  phase: () => Phase.Paused({ round: WAVE_2_FIGHT }),
})

const blurWindow = send(Message.BlurredWindow())

const mouseDown = send(
  Message.PressedPointer({
    pointerId: MOUSE_POINTER,
    device: 'Mouse',
    clientX: 700,
    clientY: 200,
  }),
)

const keyDownOn = (target: EventTarget, code: string): StoryStep =>
  Option.match(
    maybeKeyDownMessage({ code, repeat: false, target } satisfies KeyDown),
    {
      onNone: () => steps(),
      onSome: send,
    },
  )

const buttonElement = (): HTMLButtonElement => {
  const button = document.createElement('button')
  button.append(document.createElement('span'))
  return button
}

const gameSurfaceElement = (): HTMLDivElement => {
  const surface = document.createElement('div')
  surface.className = 'game-surface'
  return surface
}

describe('leaving the window', () => {
  it.effect(
    'a window blur pauses a wave and lets go of every key and the trigger',
    () =>
      Effect.map(
        storyOf(fightingModel),
        steps(
          send(Message.PressedKey({ code: 'KeyD' })),
          mouseDown,
          blurWindow,
          checkModel(({ phase, input, seats: [{ intent }] }) => {
            expect(phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
            expect(input.pressedKeys).toEqual([])
            expect(input.mouseButton).toEqual(MouseButton.Released())
            expect(intent.trigger).toBe('Released')
          }),
          tick(FRAME_MS),
          checkModel(({ phase }) => {
            expect(phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
          }),
        ),
      ),
  )

  it.effect('a window blur in Preparation pauses the countdown', () =>
    Effect.map(
      storyOf(UiStruct.evolve(readyModel, { phase: () => WAVE_2_BREAK })),
      steps(
        blurWindow,
        checkModel(({ phase }) => {
          expect(phase).toEqual(Phase.Paused({ round: WAVE_2_BREAK }))
        }),
      ),
    ),
  )

  it.effect(
    'a window blur leaves the title, the end screens, and the pause screen alone',
    () =>
      Effect.gen(function* () {
        const screens: ReadonlyArray<Model> = [
          readyModel,
          UiStruct.evolve(readyModel, {
            phase: () => Phase.GameOver({ wave: 3 }),
          }),
          UiStruct.evolve(readyModel, {
            phase: () => Phase.Escaped({ wave: 10 }),
          }),
          pausedModel,
        ]
        yield* Effect.forEach(screens, screen =>
          Effect.map(
            storyOf(screen),
            steps(
              blurWindow,
              checkModel(({ phase }) => {
                expect(phase).toEqual(screen.phase)
              }),
            ),
          ),
        )
      }),
  )

  test('only a blur aimed at the window itself counts, not focus moving between elements', () => {
    const blurs: Array<Option.Option<Message>> = []
    const recordBlur = (event: FocusEvent) => {
      blurs.push(maybeWindowBlurMessage(event))
    }
    window.addEventListener('blur', recordBlur)

    const first = buttonElement()
    const second = buttonElement()
    document.body.append(first, second)
    first.focus()
    second.focus()
    first.dispatchEvent(new FocusEvent('blur'))
    expect(blurs).toEqual([])

    window.dispatchEvent(new FocusEvent('blur'))
    window.removeEventListener('blur', recordBlur)
    first.remove()
    second.remove()

    expect(blurs).toEqual([Option.some(Message.BlurredWindow())])
    expect(maybeWindowBlurMessage({ target: first })).toEqual(Option.none())
  })
})

describe('resuming', () => {
  it.effect(
    'the click that resumes does not fire, and the next click does',
    () =>
      Effect.map(
        storyOf(pausedModel),
        steps(
          mouseDown,
          checkModel(({ phase, input, seats: [{ intent }] }) => {
            expect(phase).toEqual(WAVE_2_FIGHT)
            expect(input.mouseButton).toEqual(MouseButton.Released())
            expect(intent.trigger).toBe('Released')
          }),
          tick(FRAME_MS),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(0)
          }),
          send(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
          mouseDown,
          tick(FRAME_MS),
          checkModel(({ stats }) => {
            expect(stats.shotsFired).toBe(1)
          }),
        ),
      ),
  )

  it.effect('the tap that resumes does not take the aim stick', () =>
    Effect.map(
      storyOf(UiStruct.evolve(pausedModel, { lastDevice: () => 'Touch' })),
      steps(
        send(
          Message.PressedPointer({
            pointerId: RIGHT_THUMB,
            device: 'Touch',
            clientX: 600,
            clientY: 200,
          }),
        ),
        checkModel(({ phase, input }) => {
          expect(phase).toEqual(WAVE_2_FIGHT)
          expect(input.aimStick).toEqual(Stick.Idle())
        }),
      ),
    ),
  )

  it.effect(
    'Esc resumes without firing, and a movement key held through the pause still moves',
    () =>
      Effect.map(
        storyOf(pausedModel),
        steps(
          send(Message.PressedKey({ code: 'KeyD' })),
          send(Message.PressedKey({ code: 'Escape' })),
          checkModel(({ phase, input, seats: [{ intent }] }) => {
            expect(phase).toEqual(WAVE_2_FIGHT)
            expect(input.pressedKeys).toEqual(['KeyD'])
            expect(intent.trigger).toBe('Released')
            expect(intent.move).toEqual(screenToFloorDirection({ x: 1, y: 0 }))
          }),
        ),
      ),
  )
})

describe('keys on a focused button', () => {
  it.effect(
    'Space on the focused Swap button swaps once and does not fire',
    () => {
      const swapButton = buttonElement()
      return Effect.map(
        storyOf(
          modifyFocus(fightingModel, {
            player: player =>
              UiStruct.evolve(player, {
                arsenal: () =>
                  holdingFirst({
                    kind: 'Shotgun',
                    loaded: 6,
                    tier: 0,
                    kills: 0,
                  }),
              }),
          }),
        ),
        steps(
          keyDownOn(swapButton, 'Space'),
          send(Message.ClickedSwapButton()),
          checkModel(({ seats: [{ player, intent }], input }) => {
            expect(Arsenal.guards.HoldingSecond(player.arsenal)).toBe(true)
            expect(input.pressedKeys).toEqual([])
            expect(intent.trigger).toBe('Released')
          }),
        ),
      )
    },
  )

  it.effect(
    'Enter on the focused Endless button starts endless, not a campaign',
    () => {
      const endlessButton = buttonElement()
      return Effect.map(
        storyOf(
          UiStruct.evolve(readyModel, {
            phase: () => Phase.GameOver({ wave: 3 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
        ),
        steps(
          keyDownOn(endlessButton, 'Enter'),
          send(Message.ClickedEndlessButton()),
          throughIntro,
          checkModel(({ mode, phase }) => {
            expect(mode).toEqual(RunMode.Endless())
            expect(Phase.guards.Preparation(phase)).toBe(true)
          }),
        ),
      )
    },
  )

  test('Space on a span inside a button is left to the button', () => {
    const button = buttonElement()
    const label = Option.getOrThrow(Option.fromNullishOr(button.firstChild))
    expect(
      maybeKeyDownMessage({ code: 'Space', repeat: false, target: label }),
    ).toEqual(Option.none())
  })

  test('Enter on a focused link opens it and never reaches the game', () => {
    const link = document.createElement('a')
    link.href = 'https://buy.stripe.com/test_coffee'
    link.append(document.createElement('span'))
    expect(
      maybeKeyDownMessage({ code: 'Enter', repeat: false, target: link }),
    ).toEqual(Option.none())
    expect(
      maybeKeyDownMessage({
        code: 'Enter',
        repeat: false,
        target: link.firstChild,
      }),
    ).toEqual(Option.none())
  })

  test('Space and Enter on the game surface reach the game, and other keys on a button do too', () => {
    const surface = gameSurfaceElement()
    const button = buttonElement()
    expect(
      maybeKeyDownMessage({ code: 'Space', repeat: false, target: surface }),
    ).toEqual(Option.some(Message.PressedKey({ code: 'Space' })))
    expect(
      maybeKeyDownMessage({ code: 'Enter', repeat: false, target: surface }),
    ).toEqual(Option.some(Message.PressedKey({ code: 'Enter' })))
    expect(
      maybeKeyDownMessage({ code: 'KeyW', repeat: false, target: button }),
    ).toEqual(Option.some(Message.PressedKey({ code: 'KeyW' })))
    expect(
      maybeKeyDownMessage({ code: 'Escape', repeat: false, target: button }),
    ).toEqual(Option.some(Message.PressedKey({ code: 'Escape' })))
  })
})
