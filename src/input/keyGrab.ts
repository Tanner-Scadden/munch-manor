import { Function } from 'effect'

import { UiStruct } from '@effect/ui'

import type { ApplicationHtml, ApplicationViewBuilder } from '../app/definition'
import type { Model } from '../app/model'
import { pixelArtStyle } from '../art/artSize'
import { pixelIconUrl } from '../art/icons'

const LETTER_KEY = /^Key[A-Z]$/

export const isLetterKeyCode = (code: string): boolean => LETTER_KEY.test(code)

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

const MISSES_TO_WARN = 2

export const noteMissedKeyDown = (model: Model): Model =>
  UiStruct.evolve(model, {
    missedKeyDowns: missed => Math.min(missed + 1, MISSES_TO_WARN),
  })

export const isKeyGrabToastShown = (model: Model): boolean =>
  model.missedKeyDowns >= MISSES_TO_WARN

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
