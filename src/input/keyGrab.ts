import { Function } from 'effect'
import type { Html } from 'foldkit/html'
import { modifyFields } from 'foldkit/struct'

import type { ApplicationViewBuilder } from '../app/composition'
import type { Model } from '../app/model'
import { pixelIconUrl } from '../art/icons'

// KEYS A BROWSER EXTENSION GRABS

// NOTE: Vimium and its kin listen on the window ahead of the page and
// swallow the keydown of every letter they bind (d scrolls, t opens a tab,
// r reloads, H goes back), so the game never sees the press. The keyup
// still reaches the page, and a keyup with no keydown before it is the tell.
// Letters only: those are what such extensions bind, and what the game
// binds most.
const LETTER_KEY = /^Key[A-Z]$/

export const isLetterKeyCode = (code: string): boolean => LETTER_KEY.test(code)

// NOTE: a key held down while the page loads or gets focus back sends its
// keyup with no keydown here, so the watch keeps quiet for a moment after.
export const KEY_WATCH_QUIET_MS = 1000

export type KeyUp = Readonly<{
  code: string
  wasSeen: boolean
  isModified: boolean
  hasFocus: boolean
  nowMs: number
  quietUntilMs: number
}>

export const isGrabbedKeyUp = ({
  code,
  wasSeen,
  isModified,
  hasFocus,
  nowMs,
  quietUntilMs,
}: KeyUp): boolean =>
  !wasSeen &&
  !isModified &&
  hasFocus &&
  nowMs >= quietUntilMs &&
  isLetterKeyCode(code)

// NOTE: two misses before the toast, so one stray keyup never shows it.
const MISSES_TO_WARN = 2

export const noteMissedKeyDown = (model: Model): Model =>
  modifyFields(model, {
    missedKeyDowns: missed => Math.min(missed + 1, MISSES_TO_WARN),
  })

export const isKeyGrabToastShown = (model: Model): boolean =>
  model.missedKeyDowns >= MISSES_TO_WARN

// TOAST

const KEYBOARD_ICON = pixelIconUrl(
  [
    'OOOOOOOOOOOOO',
    'OXXXXXXXXXXXO',
    'OXOXOXOXOXOXO',
    'OXXXXXXXXXXXO',
    'OXOXOXOXOXOXO',
    'OXXXXXXXXXXXO',
    'OXXOOOOOOOXXO',
    'OXXXXXXXXXXXO',
    'OOOOOOOOOOOOO',
  ],
  { X: '#f4f1de', O: '#140c10' },
)

const NO_EXTENSION_ICON = pixelIconUrl(
  [
    'RR...PP......',
    'RRR.PPPP.....',
    '.RRRPPPP.....',
    '..RRRPPPPPP..',
    '.PPRRRPPPPP..',
    '.PPPRRRPPPPPP',
    '.PPPPRRRPPPPP',
    '.PPPPPRRRPPPP',
    '.PPPPPPRRRP..',
    '.PPPPPPPRRR..',
    '.PPPPPPPPRRR.',
    '..........RRR',
    '...........RR',
  ],
  { P: '#7fd1ff', R: '#ff6b5e' },
)

// NOTE: shown once, over everything but never in the way: its own
// animation fades it out, and it takes no pointer. It sits at the root, so
// moving between screens never plays it again.
export const keyGrabToastView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  isKeyGrabToastShown(model)
    ? h.div(
        [h.Key('key-grab-toast'), h.Class('key-grab-toast'), h.Role('status')],
        [
          h.span(
            [h.Class('key-grab-icons'), h.AriaHidden(true)],
            [
              h.span([
                h.Class('key-grab-icon'),
                h.Style({ backgroundImage: KEYBOARD_ICON }),
              ]),
              h.span([
                h.Class('key-grab-icon'),
                h.Style({ backgroundImage: NO_EXTENSION_ICON }),
              ]),
            ],
          ),
          h.span(
            [h.Class('key-grab-text')],
            ['An extension is grabbing keys. Turn it off here.'],
          ),
        ],
      )
    : h.empty,
)
