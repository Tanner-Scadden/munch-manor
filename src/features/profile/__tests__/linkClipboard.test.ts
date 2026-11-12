// @vitest-environment happy-dom
import { Duration, Effect, Schema } from 'effect'

import { afterEach, describe, expect, it, test, vi } from '@effect/vitest'

import { describeError } from '../../../shared/describeError'
import {
  LINK_CODE_DATA,
  listenForCopyClicks,
  listenForPasteTaps,
} from '../linkClipboard'

type Call = Readonly<{ name: string; data: unknown; isInClick: boolean }>

let isClicking = false
const calls: Array<Call> = []

const record = (name: string, data: unknown) => {
  calls.push({ name, data, isInClick: isClicking })
}

type Clipboard = Readonly<{
  writeText?: (text: string) => Promise<void>
  readText?: () => Promise<string>
}>

const stubClipboard = (clipboard: Clipboard | undefined) => {
  vi.stubGlobal(
    'navigator',
    clipboard === undefined
      ? {}
      : {
          clipboard: {
            ...(clipboard.writeText === undefined
              ? {}
              : {
                  writeText: (text: string) => {
                    record('write', text)
                    return clipboard.writeText?.(text) ?? Promise.resolve()
                  },
                }),
            ...(clipboard.readText === undefined
              ? {}
              : {
                  readText: () => {
                    record('read', undefined)
                    return clipboard.readText?.() ?? Promise.resolve('')
                  },
                }),
          },
        },
  )
}

// NOTE: the old copy, for a browser with no async clipboard.
const stubCopyCommand = (isCopied: boolean) => {
  const execCommand = vi.fn<(command: string) => boolean>(command => {
    record('execCommand', command)
    return isCopied
  })
  Object.defineProperty(document, 'execCommand', {
    value: execCommand,
    configurable: true,
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(document, 'execCommand')
  calls.length = 0
  document.body.innerHTML = ''
})

class NeverSettled extends Schema.TaggedError<
  NeverSettled,
  { readonly brand: unique symbol }
>()('NeverSettled', {
  reason: Schema.String,
}) {}

const settles = (check: () => void) =>
  Effect.tryPromise({
    try: () => vi.waitFor(check),
    catch: error => NeverSettled.make({ reason: describeError(error) }),
  })

// NOTE: the clipboard answers a few promise hops after the click, so a
// test that waits for nothing to happen waits a moment of real time first.
const promiseHops = Effect.sleep(Duration.millis(20))

describe('the link code button', () => {
  const codeButton = () => {
    const button = document.createElement('button')
    button.setAttribute(`data-${LINK_CODE_DATA}`, 'KZ7QWM')
    document.body.append(button)
    const copies = { count: 0 }
    const stopListening = listenForCopyClicks(button, () => {
      copies.count += 1
    })
    return { button, copies, stopListening }
  }

  const clickOn = (element: HTMLElement) => {
    isClicking = true
    element.click()
    isClicking = false
  }

  // NOTE: the copy lands on real promise hops (settles).
  it.live('copies the code on the click own stack', () =>
    Effect.gen(function* () {
      stubClipboard({ writeText: () => Promise.resolve() })
      const { button, copies } = codeButton()
      clickOn(button)
      expect(calls).toEqual([
        { name: 'write', data: 'KZ7QWM', isInClick: true },
      ])
      yield* settles(() => {
        expect(copies.count).toBe(1)
      })
    }),
  )

  // NOTE: the copy lands on real promise hops (settles).
  it.live('with no async clipboard it copies the old way', () =>
    Effect.gen(function* () {
      stubClipboard(undefined)
      stubCopyCommand(true)
      const { button, copies } = codeButton()
      clickOn(button)
      expect(calls).toEqual([
        { name: 'execCommand', data: 'copy', isInClick: true },
      ])
      yield* settles(() => {
        expect(copies.count).toBe(1)
      })
      expect(document.querySelector('textarea')).toBeNull()
    }),
  )

  // NOTE: waits out real promise hops (promiseHops).
  it.live('a copy every way refuses says nothing', () =>
    Effect.gen(function* () {
      stubClipboard({ writeText: () => Promise.reject(new Error('denied')) })
      stubCopyCommand(false)
      const { button, copies } = codeButton()
      clickOn(button)
      yield* promiseHops
      expect(copies.count).toBe(0)
    }),
  )

  test('stops listening when the Mount ends', () => {
    stubClipboard({ writeText: () => Promise.resolve() })
    const { button, stopListening } = codeButton()
    stopListening()
    clickOn(button)
    expect(calls).toHaveLength(0)
  })
})

describe('the link code field', () => {
  const codeField = (value: string) => {
    const field = document.createElement('input')
    field.type = 'text'
    field.value = value
    document.body.append(field)
    const reads: Array<Readonly<{ text: string; typed: string }>> = []
    const stopListening = listenForPasteTaps(field, (text, typed) => {
      reads.push({ text, typed })
    })
    return { field, reads, stopListening }
  }

  // NOTE: a tap as src/input/touchTaps.ts makes one: the finger goes down
  // on the field, then the click comes on the pointerup's own stack.
  const tapOn = (field: HTMLElement, pointerType = 'touch') => {
    field.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, pointerType }),
    )
    isClicking = true
    field.click()
    isClicking = false
  }

  // NOTE: the read lands on real promise hops (settles).
  it.live(
    'a tap that focuses the field reads the clipboard, with what it held',
    () =>
      Effect.gen(function* () {
        stubClipboard({ readText: () => Promise.resolve('kz7 qwm') })
        const { field, reads } = codeField('AB')
        tapOn(field)
        expect(calls).toEqual([
          { name: 'read', data: undefined, isInClick: true },
        ])
        yield* settles(() => {
          expect(reads).toEqual([{ text: 'kz7 qwm', typed: 'AB' }])
        })
      }),
  )

  // NOTE: the read lands on real promise hops (settles).
  it.live('a tap on the focused field reads only while it is empty', () =>
    Effect.gen(function* () {
      stubClipboard({ readText: () => Promise.resolve('KZ7QWM') })
      const { field, reads } = codeField('')
      field.focus()
      tapOn(field)
      yield* settles(() => {
        expect(reads).toEqual([{ text: 'KZ7QWM', typed: '' }])
      })
      field.value = 'KZ'
      tapOn(field)
      yield* promiseHops
      expect(reads).toHaveLength(1)
      expect(calls).toHaveLength(1)
    }),
  )

  test('a mouse click leaves the clipboard alone', () => {
    stubClipboard({ readText: () => Promise.resolve('KZ7QWM') })
    const { field } = codeField('')
    tapOn(field, 'mouse')
    expect(calls).toHaveLength(0)
  })

  // NOTE: waits out real promise hops (promiseHops).
  it.live('a refused read or no clipboard at all says nothing', () =>
    Effect.gen(function* () {
      stubClipboard({
        readText: () =>
          Promise.reject(new DOMException('no', 'NotAllowedError')),
      })
      const refused = codeField('')
      tapOn(refused.field)
      yield* promiseHops
      expect(refused.reads).toHaveLength(0)

      stubClipboard(undefined)
      const missing = codeField('')
      tapOn(missing.field)
      yield* promiseHops
      expect(missing.reads).toHaveLength(0)
    }),
  )

  test('stops listening when the Mount ends', () => {
    stubClipboard({ readText: () => Promise.resolve('KZ7QWM') })
    const { field, stopListening } = codeField('')
    stopListening()
    tapOn(field)
    expect(calls).toHaveLength(0)
  })
})
