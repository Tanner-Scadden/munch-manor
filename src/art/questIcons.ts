import { pixelIconUrl } from './icons'
import type { Palette } from './sprite'

// The guided first break's pixel icons, apart from the rest so each file
// stays one job.

const LIGHT = '#f4f1de'
const SHADE = '#140c10'

// NOTE: the guided first break's tracker (src/features/onboarding/questView.ts):
// a skeleton key, a padlock, a display case with a gun behind its glass,
// and the dare card with its row of things.
const QUEST_PALETTE: Palette = {
  o: SHADE,
  r: '#ff4a4f',
  w: LIGHT,
  R: '#a8302a',
  f: '#6b4426',
  d: '#21140c',
  Y: '#c9a227',
  y: '#ffe066',
  P: '#c98a4a',
  L: '#8a5a2b',
  g: '#9fd8e6',
  G: '#5b8fa3',
  m: '#b8c0cc',
  n: '#f4ead2',
  k: '#3a3340',
}

export const QUEST_KEY_ICON = pixelIconUrl(
  [
    '.ooo.......',
    'oyyyo......',
    'oy.Yooooooo',
    'oy.Yyyyyyyo',
    'oyyyooyoyoo',
    '.ooo..o.o..',
  ],
  QUEST_PALETTE,
)

export const QUEST_LOCK_ICON = pixelIconUrl(
  [
    '...ooooo...',
    '..om...mo..',
    '..om...mo..',
    '..om...mo..',
    '.ooooooooo.',
    '.oyyyyyyyo.',
    '.oyYYoYYyo.',
    '.oyYYoYYyo.',
    '.oyyyyyyyo.',
    '.ooooooooo.',
  ],
  QUEST_PALETTE,
)

export const QUEST_CASE_ICON = pixelIconUrl(
  [
    'fffffffffff',
    'fgggggggggf',
    'fgGgggggggf',
    'fgkkkkkmggf',
    'fggkkgggggf',
    'fgggkggggGf',
    'fgggggggggf',
    'fffffffffff',
    'fdddddddddf',
    'ff.......ff',
  ],
  QUEST_PALETTE,
)

export const QUEST_CARD_ICON = pixelIconUrl(
  [
    'ooooooooooo',
    'onnnnnnnnno',
    'onkkn.nrrno',
    'onkkn.nrrno',
    'onnnnnnnnno',
    'onYYnyynLLo',
    'onYYnyynLLo',
    'onnnnnnnnno',
    'ooooooooooo',
  ],
  QUEST_PALETTE,
)

// NOTE: START WAVE, the tour's last step: the gold button with a go mark.
export const QUEST_START_ICON = pixelIconUrl(
  [
    '.ooooooooo.',
    'oyyyyyyyyyo',
    'oyyyoyyyyyo',
    'oyyyooyyyyo',
    'oyyyoooyyyo',
    'oyyyooyyyyo',
    'oyyyoyyyyyo',
    'oyyyyyyyyyo',
    '.ooooooooo.',
  ],
  QUEST_PALETTE,
)

// NOTE: the big gold arrow that bobs over START WAVE on the tour's last
// step, the same arrow as the tours' edge arrow, pointing down.
export const QUEST_START_ARROW_ICON = pixelIconUrl(
  [
    '..ooooo..',
    '..oyyyo..',
    '..oyyyo..',
    'oooyyyooo',
    'oyyyyyyyo',
    '.oyyyyyo.',
    '..oyyyo..',
    '...oyo...',
    '....o....',
  ],
  QUEST_PALETTE,
)
