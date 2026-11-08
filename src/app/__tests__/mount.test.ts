// @vitest-environment happy-dom
import { Array, Effect, Schema } from 'effect'

import { afterEach, describe, expect, it, test, vi } from '@effect/vitest'

import { GAME_URL, type ShareOutcome } from '../../features/end/share'
import { SHARE_TEXT_DATA } from '../../features/end/share'
import { describeError } from '../../shared/describeError'
import { listenForShareClicks } from '../mount'

const TEXT = '💀 Got munched on wave 4 in Munch Manor. Your turn!'

type Call = Readonly<{ name: string; data: unknown }>

// NOTE: SHARE as the view draws it, with ShareFromClick's listener on it.
// `calls` records each browser call and whether the click was still on the
// stack when it came, as navigator.share and the clipboard need.
const shareButton = () => {
  const button = document.createElement('button')
  button.setAttribute(`data-${SHARE_TEXT_DATA}`, TEXT)
  document.body.append(button)
  const outcomes: Array<ShareOutcome> = []
  const stopListening = listenForShareClicks(button, outcome => {
    outcomes.push(outcome)
  })
  return { button, outcomes, stopListening }
}

let isClicking = false
const calls: Array<Call & { isInClick: boolean }> = []

const record = (name: string, data: unknown) => {
  calls.push({ name, data, isInClick: isClicking })
}

const clickOn = (button: HTMLElement) => {
  isClicking = true
  button.click()
  isClicking = false
}

class NeverSettled extends Schema.TaggedError<
  NeverSettled,
  { readonly brand: unique symbol }
>()('NeverSettled', {
  reason: Schema.String,
}) {}

// NOTE: the outcome lands a few promise hops after the click, so the tests
// that wait for it run on real timers (`it.live`).
const settlesAs = (
  outcomes: ReadonlyArray<ShareOutcome>,
  expected: ShareOutcome,
) =>
  Effect.tryPromise({
    try: () =>
      vi.waitFor(() => {
        expect(outcomes).toEqual([expected])
      }),
    catch: error => NeverSettled.make({ reason: describeError(error) }),
  })

const stubBrowser = (
  share: ((data: unknown) => Promise<void>) | undefined,
  writeText: (line: string) => Promise<void>,
) => {
  vi.stubGlobal('navigator', {
    ...(share === undefined
      ? {}
      : {
          share: (data: unknown) => {
            record('share', data)
            return share(data)
          },
        }),
    clipboard: {
      writeText: (line: string) => {
        record('copy', line)
        return writeText(line)
      },
    },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  calls.length = 0
  document.body.innerHTML = ''
})

describe('SHARE in the click itself', () => {
  // NOTE: the share outcome lands on real promise hops (settlesAs).
  it.live(
    'opens the share sheet on the click own stack, with the post and the game',
    () =>
      Effect.gen(function* () {
        stubBrowser(
          () => Promise.resolve(),
          () => Promise.resolve(),
        )
        const { button, outcomes } = shareButton()
        clickOn(button)
        expect(calls).toEqual([
          {
            name: 'share',
            data: { text: TEXT, url: GAME_URL },
            isInClick: true,
          },
        ])
        yield* settlesAs(outcomes, 'Shared')
      }),
  )

  // NOTE: the share outcome lands on real promise hops (settlesAs).
  it.live('a sheet the player closes is Cancelled, and nothing is copied', () =>
    Effect.gen(function* () {
      stubBrowser(
        () => Promise.reject(new DOMException('closed', 'AbortError')),
        () => Promise.resolve(),
      )
      const { button, outcomes } = shareButton()
      clickOn(button)
      yield* settlesAs(outcomes, 'Cancelled')
      expect(Array.map(calls, call => call.name)).toEqual(['share'])
    }),
  )

  // NOTE: the share outcome lands on real promise hops (settlesAs).
  it.live('a sheet the browser refuses copies the post instead', () =>
    Effect.gen(function* () {
      stubBrowser(
        () => Promise.reject(new DOMException('no', 'NotAllowedError')),
        () => Promise.resolve(),
      )
      const { button, outcomes } = shareButton()
      clickOn(button)
      yield* settlesAs(outcomes, 'Copied')
      expect(Array.map(calls, call => call.name)).toEqual(['share', 'copy'])
    }),
  )

  // NOTE: the share outcome lands on real promise hops (settlesAs).
  it.live(
    'with no share sheet the click copies the words and the link at once',
    () =>
      Effect.gen(function* () {
        stubBrowser(undefined, () => Promise.resolve())
        const { button, outcomes } = shareButton()
        clickOn(button)
        expect(calls).toEqual([
          { name: 'copy', data: `${TEXT} ${GAME_URL}`, isInClick: true },
        ])
        yield* settlesAs(outcomes, 'Copied')
      }),
  )

  // NOTE: the share outcome lands on real promise hops (settlesAs).
  it.live('a clipboard that refuses ends Failed', () =>
    Effect.gen(function* () {
      stubBrowser(undefined, () => Promise.reject(new Error('denied')))
      const { button, outcomes } = shareButton()
      clickOn(button)
      yield* settlesAs(outcomes, 'Failed')
      expect(Array.map(calls, call => call.name)).toEqual(['copy'])
    }),
  )

  test('stops listening when the Mount ends', () => {
    stubBrowser(undefined, () => Promise.resolve())
    const { button, stopListening } = shareButton()
    stopListening()
    clickOn(button)
    expect(calls).toHaveLength(0)
  })
})
