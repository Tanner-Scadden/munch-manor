// @vitest-environment happy-dom
import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  type Model,
  MouseButton,
  Phase,
  RunMode,
  ShopState,
  Stick,
} from './model'
import { WAVE_2_BREAK, WAVE_2_FIGHT, readyModel } from './model.fixture'
import {
  type KeyDown,
  maybeKeyDownMessage,
  maybeWindowBlurMessage,
} from './subscriptions'
import { holdingFirst, tick } from './testing'

const FRAME_MS = FIXED_STEP_MS
const MOUSE_POINTER = 1
const RIGHT_THUMB = 12

const fightingModel: Model = modifyFields(readyModel, {
  phase: () => WAVE_2_FIGHT,
})

const pausedModel: Model = modifyFields(readyModel, {
  phase: () => Phase.Paused({ round: WAVE_2_FIGHT }),
})

const blurWindow = message(Message.BlurredWindow())

const mouseDown = message(
  Message.PressedPointer({
    pointerId: MOUSE_POINTER,
    device: 'Mouse',
    clientX: 700,
    clientY: 200,
  }),
)

const keyDownOn = (target: EventTarget, code: string) =>
  Option.match(
    maybeKeyDownMessage({ code, repeat: false, target } satisfies KeyDown),
    {
      onNone: () => [],
      onSome: keyMessage => [message(keyMessage)],
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
  test('a window blur pauses a wave and lets go of every key and the trigger', () => {
    story(
      update,
      given(fightingModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      mouseDown,
      blurWindow,
      model(({ phase, input, intent }) => {
        expect(phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
        expect(input.pressedKeys).toEqual([])
        expect(input.mouseButton).toEqual(MouseButton.Released())
        expect(intent.trigger).toBe('Released')
      }),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Paused({ round: WAVE_2_FIGHT }))
      }),
    )
  })

  test('a window blur in Preparation closes the shop and pauses the countdown', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => WAVE_2_BREAK,
          shop: () => ShopState.Browsing({ focusedItem: 'Shotgun' }),
        }),
      ),
      blurWindow,
      model(({ phase, shop }) => {
        expect(phase).toEqual(Phase.Paused({ round: WAVE_2_BREAK }))
        expect(ShopState.guards.Browsing(shop)).toBe(false)
      }),
    )
  })

  test('a window blur leaves the title, the end screens, and the pause screen alone', () => {
    const screens: ReadonlyArray<Model> = [
      readyModel,
      modifyFields(readyModel, { phase: () => Phase.GameOver({ wave: 3 }) }),
      modifyFields(readyModel, { phase: () => Phase.Victory() }),
      pausedModel,
    ]
    Array.forEach(screens, screen => {
      story(
        update,
        given(screen),
        blurWindow,
        model(({ phase }) => {
          expect(phase).toEqual(screen.phase)
        }),
      )
    })
  })

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
  test('the click that resumes does not fire, and the next click does', () => {
    story(
      update,
      given(pausedModel),
      mouseDown,
      model(({ phase, input, intent }) => {
        expect(phase).toEqual(WAVE_2_FIGHT)
        expect(input.mouseButton).toEqual(MouseButton.Released())
        expect(intent.trigger).toBe('Released')
      }),
      tick(FRAME_MS),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(0)
      }),
      message(Message.ReleasedPointer({ pointerId: MOUSE_POINTER })),
      mouseDown,
      tick(FRAME_MS),
      model(({ stats }) => {
        expect(stats.shotsFired).toBe(1)
      }),
    )
  })

  test('the tap that resumes does not take the aim stick', () => {
    story(
      update,
      given(modifyFields(pausedModel, { lastDevice: () => 'Touch' })),
      message(
        Message.PressedPointer({
          pointerId: RIGHT_THUMB,
          device: 'Touch',
          clientX: 600,
          clientY: 200,
        }),
      ),
      model(({ phase, input }) => {
        expect(phase).toEqual(WAVE_2_FIGHT)
        expect(input.aimStick).toEqual(Stick.Idle())
      }),
    )
  })

  test('Esc resumes without firing, and a movement key held through the pause still moves', () => {
    story(
      update,
      given(pausedModel),
      message(Message.PressedKey({ code: 'KeyD' })),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ phase, input, intent }) => {
        expect(phase).toEqual(WAVE_2_FIGHT)
        expect(input.pressedKeys).toEqual(['KeyD'])
        expect(intent.trigger).toBe('Released')
        expect(intent.move).toEqual({ x: 1, y: 0 })
      }),
    )
  })
})

describe('keys on a focused button', () => {
  test('Space on the focused Swap button swaps once and does not fire', () => {
    const swapButton = buttonElement()
    story(
      update,
      given(
        modifyFields(fightingModel, {
          player: player =>
            modifyFields(player, {
              arsenal: () =>
                holdingFirst({
                  kind: 'Shotgun',
                  rounds: 20,
                  loaded: 6,
                  tier: 0,
                }),
            }),
        }),
      ),
      ...keyDownOn(swapButton, 'Space'),
      message(Message.ClickedSwapButton()),
      model(({ player, input, intent }) => {
        expect(Arsenal.guards.HoldingSecond(player.arsenal)).toBe(true)
        expect(input.pressedKeys).toEqual([])
        expect(intent.trigger).toBe('Released')
      }),
    )
  })

  test('Enter on the focused Endless button starts endless, not a campaign', () => {
    const endlessButton = buttonElement()
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      ...keyDownOn(endlessButton, 'Enter'),
      message(Message.ClickedEndlessButton()),
      model(({ mode, phase }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    )
  })

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
