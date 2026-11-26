import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { ApplicationHtml, ApplicationViewBuilder } from '../app/definition'
import type { Model } from '../app/model'
import { pixelArtStyle } from '../art/artSize'
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
  UiStruct.evolve(model, {
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
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isKeyGrabToastShown(model)
      ? h.div
          .key('key-grab-toast')
          .class('key-grab-toast')
          .attr('role', 'status')
          .children(
            h.span
              .class('key-grab-icons')
              .attr('aria-hidden', 'true')
              .children(
                h.span
                  .class('key-grab-icon')
                  .style(pixelArtStyle(KEYBOARD_ICON)),
                h.span
                  .class('key-grab-icon')
                  .style(pixelArtStyle(NO_EXTENSION_ICON)),
              ),
            h.span
              .class('key-grab-text')
              .children('An extension is grabbing keys. Turn it off here.'),
          )
      : null,
)
