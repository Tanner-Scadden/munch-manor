// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from 'vitest'

import type { ShareOutcome } from './model'
import { SHARE_TEXT_DATA, listenForShareClicks } from './mount'
import { GAME_URL } from './share'

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

// NOTE: the outcome lands a few promise hops after the click.
const settlesAs = (
  outcomes: ReadonlyArray<ShareOutcome>,
  expected: ShareOutcome,
) =>
  vi.waitFor(() => {
    expect(outcomes).toEqual([expected])
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
  test('opens the share sheet on the click own stack, with the post and the game', async () => {
    stubBrowser(
      () => Promise.resolve(),
      () => Promise.resolve(),
    )
    const { button, outcomes } = shareButton()
    clickOn(button)
    expect(calls).toEqual([
      { name: 'share', data: { text: TEXT, url: GAME_URL }, isInClick: true },
    ])
    await settlesAs(outcomes, 'Shared')
  })

  test('a sheet the player closes is Cancelled, and nothing is copied', async () => {
    stubBrowser(
      () => Promise.reject(new DOMException('closed', 'AbortError')),
      () => Promise.resolve(),
    )
    const { button, outcomes } = shareButton()
    clickOn(button)
    await settlesAs(outcomes, 'Cancelled')
    expect(calls.map(call => call.name)).toEqual(['share'])
  })

  test('a sheet the browser refuses copies the post instead', async () => {
    stubBrowser(
      () => Promise.reject(new DOMException('no', 'NotAllowedError')),
      () => Promise.resolve(),
    )
    const { button, outcomes } = shareButton()
    clickOn(button)
    await settlesAs(outcomes, 'Copied')
    expect(calls.map(call => call.name)).toEqual(['share', 'copy'])
  })

  test('with no share sheet the click copies the words and the link at once', async () => {
    stubBrowser(undefined, () => Promise.resolve())
    const { button, outcomes } = shareButton()
    clickOn(button)
    expect(calls).toEqual([
      { name: 'copy', data: `${TEXT} ${GAME_URL}`, isInClick: true },
    ])
    await settlesAs(outcomes, 'Copied')
  })

  test('a clipboard that refuses ends Failed', async () => {
    stubBrowser(undefined, () => Promise.reject(new Error('denied')))
    const { button, outcomes } = shareButton()
    clickOn(button)
    await settlesAs(outcomes, 'Failed')
    expect(calls.map(call => call.name)).toEqual(['copy'])
  })

  test('stops listening when the Mount ends', () => {
    stubBrowser(undefined, () => Promise.resolve())
    const { button, stopListening } = shareButton()
    stopListening()
    clickOn(button)
    expect(calls).toHaveLength(0)
  })
})
