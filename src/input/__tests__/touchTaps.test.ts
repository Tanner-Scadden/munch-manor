// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  CLICK_ECHO_MS,
  TAP_MAX_MS,
  TAP_SLOP_PX,
  listenForTouchTaps,
} from '../touchTaps'

// NOTE: a dialog as the shell draws one: a backdrop and a panel side by
// side, a close button in the panel, and a button on the page behind.
const makePage = () => {
  const root = document.createElement('main')
  root.innerHTML = `
    <button id="behind">behind</button>
    <dialog open id="dialog">
      <div id="backdrop"></div>
      <div id="panel"><p id="words">words</p><button id="close"><span id="face">x</span></button></div>
    </dialog>`
  document.body.append(root)
  const clicks: Array<string> = []
  for (const id of ['behind', 'backdrop', 'close', 'panel']) {
    root.querySelector(`#${id}`)!.addEventListener('click', () => {
      clicks.push(id)
    })
  }
  return { root, clicks }
}

const byId = (id: string): Element => document.getElementById(id)!

let under = new Map<string, Element>()
const at = (x: number, y: number) => `${x},${y}`

const pointer = (
  type: string,
  target: Element,
  init: Readonly<{
    pointerId: number
    x: number
    y: number
    timeStamp: number
    pointerType?: string
  }>,
) => {
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: init.pointerId,
    pointerType: init.pointerType ?? 'touch',
    clientX: init.x,
    clientY: init.y,
  })
  Object.defineProperty(event, 'timeStamp', { value: init.timeStamp })
  target.dispatchEvent(event)
}

// NOTE: the browser's own click: detail 1 for a tap or a mouse, 0 for a key.
const nativeClick = (target: Element, timeStamp: number, detail = 1) => {
  const event = new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail,
  })
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  target.dispatchEvent(event)
}

// NOTE: a touch's pointerup goes to where it went down; where it came up
// is what elementFromPoint finds there.
const tap = (
  down: Element,
  up: Element,
  options: Readonly<{
    pointerId?: number
    start?: number
    duration?: number
    drift?: number
    pointerType?: string
  }> = {},
) => {
  const pointerId = options.pointerId ?? 2
  const start = options.start ?? 1000
  const drift = options.drift ?? 0
  under.set(at(10 + drift, 10), up)
  pointer('pointerdown', down, {
    pointerId,
    x: 10,
    y: 10,
    timeStamp: start,
    ...(options.pointerType === undefined
      ? {}
      : { pointerType: options.pointerType }),
  })
  pointer('pointerup', down, {
    pointerId,
    x: 10 + drift,
    y: 10,
    timeStamp: start + (options.duration ?? 80),
    ...(options.pointerType === undefined
      ? {}
      : { pointerType: options.pointerType }),
  })
}

let page: ReturnType<typeof makePage>
let stop: () => void
let taps = 0

beforeEach(() => {
  under = new Map()
  vi.spyOn(document, 'elementFromPoint').mockImplementation(
    (x, y) => under.get(at(x, y)) ?? null,
  )
  page = makePage()
  taps = 0
  stop = listenForTouchTaps(page.root, () => {
    taps++
  })
})

afterEach(() => {
  stop()
  page.root.remove()
  vi.restoreAllMocks()
})

describe('touch taps', () => {
  test('a tap with another finger resting presses the button', () => {
    // NOTE: the resting finger went down long before and stays down.
    pointer('pointerdown', byId('behind'), {
      pointerId: 1,
      x: 1,
      y: 1,
      timeStamp: 0,
    })
    tap(byId('face'), byId('face'))
    expect(page.clicks).toEqual(['close', 'panel'])
    expect(taps).toBe(1)
  })

  test("the browser's own click for that tap is dropped", () => {
    tap(byId('close'), byId('close'))
    nativeClick(byId('close'), 1080 + CLICK_ECHO_MS / 2)
    expect(page.clicks).toEqual(['close', 'panel'])
  })

  test('a press that went down on the panel never closes from the backdrop', () => {
    tap(byId('words'), byId('backdrop'))
    nativeClick(byId('backdrop'), 1100)
    expect(page.clicks).toEqual([])
  })

  test('a press that went down and came up on the backdrop closes', () => {
    tap(byId('backdrop'), byId('backdrop'))
    expect(page.clicks).toEqual(['backdrop'])
  })

  test('a resting finger lifting presses nothing', () => {
    tap(byId('behind'), byId('behind'), { duration: TAP_MAX_MS + 1 })
    expect(page.clicks).toEqual([])
    expect(taps).toBe(0)
  })

  test('a drag presses nothing', () => {
    tap(byId('close'), byId('close'), { drift: TAP_SLOP_PX + 1 })
    expect(page.clicks).toEqual([])
  })

  test('a cancelled touch presses nothing', () => {
    pointer('pointerdown', byId('close'), {
      pointerId: 2,
      x: 10,
      y: 10,
      timeStamp: 0,
    })
    pointer('pointercancel', byId('close'), {
      pointerId: 2,
      x: 10,
      y: 10,
      timeStamp: 10,
    })
    under.set(at(10, 10), byId('close'))
    pointer('pointerup', byId('close'), {
      pointerId: 2,
      x: 10,
      y: 10,
      timeStamp: 20,
    })
    expect(page.clicks).toEqual([])
  })

  test('a mouse is left to its own click', () => {
    tap(byId('close'), byId('close'), { pointerType: 'mouse' })
    expect(page.clicks).toEqual([])
    nativeClick(byId('close'), 1100)
    expect(page.clicks).toEqual(['close', 'panel'])
  })

  test('a key right after a tap still presses', () => {
    tap(byId('backdrop'), byId('backdrop'))
    nativeClick(byId('close'), 1100, 0)
    expect(page.clicks).toEqual(['backdrop', 'close', 'panel'])
  })

  test('a tap on what is inert presses nothing', () => {
    byId('dialog').setAttribute('inert', '')
    tap(byId('close'), byId('close'))
    expect(page.clicks).toEqual([])
  })
})
