// A stand-in controller for the audits: a script run in the page before
// the game's modules replaces `navigator.getGamepads` with one pad in the
// standard layout, read off `window.__pad`, so the game's own gamepad
// Subscription polls it (tools/audit/pad.ts, tools/audit/padMenus.ts).
import { Array, Effect } from 'effect'
import type { Page } from 'playwright-core'

import { wait } from './lib'
import { attempt } from './page'

// NOTE: the standard layout's buttons the audits press, by index.
const BUTTON_COUNT = 17
export const A = 0
export const B = 1
export const RB = 5
export const RT = 7
export const START = 9
export const DPAD_UP = 12
export const DPAD_DOWN = 13
export const DPAD_RIGHT = 15

// NOTE: runs in the page before the game's modules: a controller in slot 0
// read off `window.__pad`, with a rumble motor that counts its rumbles.
export const padStandIn = () => {
  window.__pad = {
    isPlugged: true,
    axes: [0, 0, 0, 0],
    buttons: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  }
  window.__rumbles = 0
  const actuator = {
    playEffect: () => {
      window.__rumbles = (window.__rumbles ?? 0) + 1
      return Promise.resolve('complete')
    },
  }
  Object.defineProperty(navigator, 'getGamepads', {
    value: () => {
      const pad = window.__pad
      if (pad === undefined || !pad.isPlugged) {
        return [null]
      }
      const buttons = []
      for (const value of pad.buttons) {
        buttons.push({ value, pressed: value > 0.5, touched: value > 0 })
      }
      return [
        {
          index: 0,
          id: 'Audit pad (standard)',
          connected: true,
          mapping: 'standard',
          timestamp: 0,
          axes: pad.axes,
          buttons,
          vibrationActuator: actuator,
        },
      ]
    },
  })
}

type StandInPad = {
  isPlugged: boolean
  axes: Array<number>
  buttons: Array<number>
}

type Hold = Readonly<{
  page: Page
  axes?: ReadonlyArray<number>
  held?: ReadonlyArray<number>
  isPlugged?: boolean
}>

export const setPad = ({
  page,
  axes = [0, 0, 0, 0],
  held = [],
  isPlugged = true,
}: Hold) =>
  attempt(() =>
    page.evaluate(
      (pad: StandInPad) => {
        window.__pad = pad
      },
      {
        isPlugged,
        axes: [...axes],
        buttons: Array.makeBy(BUTTON_COUNT, position =>
          Array.contains(held, position) ? 1 : 0,
        ),
      },
    ),
  )

// NOTE: a button pressed and let go, as a thumb does, a few frames each.
export const pressPad = ({
  page,
  button,
}: Readonly<{ page: Page; button: number }>) =>
  Effect.gen(function* () {
    yield* setPad({ page, held: [button] })
    yield* wait(120)
    yield* setPad({ page })
    yield* wait(120)
  })
