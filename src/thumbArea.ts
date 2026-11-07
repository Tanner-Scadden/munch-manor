import { Function, Option } from 'effect'
import type { Html } from 'foldkit/html'
import { createLazy } from 'foldkit/html'

import type { ApplicationViewBuilder } from './composition'
import { percentOf } from './menuParts'
import { type Screen, thumbAreaTop } from './screen'
import { type Palette, spriteDataUrl } from './sprite'

// ART

// NOTE: the thumb area under a portrait world window is dressed as the
// manor's wainscot, in the wall's own purples, so the wall at the bottom of
// the room reads as running on down behind the sticks and the guns. A chair
// rail along the top, then a row of sunken panels. It is two small PNG tiles
// repeated by CSS, drawn once, so it costs nothing per frame. It stays dark,
// so the gun slots and the sticks drawn over it keep their contrast.
const WAINSCOT_PALETTE: Palette = {
  T: '#5a4668',
  F: '#3b2d46',
  E: '#2f2439',
  S: '#0f0a12',
  B: '#1b1420',
  H: '#251c2c',
  P: '#1d1624',
  D: '#130e17',
}

const RAIL_PIXELS: ReadonlyArray<string> = ['T', 'F', 'F', 'E', 'S', 'S']

const PANEL_PIXELS: ReadonlyArray<string> = [
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBD',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBD',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBD',
  'BBBHHHHHHHHHHHHHHHHHHHHHHHDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBHPPPPPPPPPPPPPPPPPPPPPPDBBD',
  'BBBDDDDDDDDDDDDDDDDDDDDDDDDBBD',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBD',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBD',
]

const PANEL_WIDTH = PANEL_PIXELS[0]?.length ?? 1
const PANEL_HEIGHT = PANEL_PIXELS.length
const RAIL_HEIGHT = RAIL_PIXELS.length

const cssUrl = (pixels: ReadonlyArray<string>): string =>
  Option.match(spriteDataUrl(pixels, WAINSCOT_PALETTE), {
    onNone: () => 'none',
    onSome: url => `url("${url}")`,
  })

const RAIL_URL = cssUrl(RAIL_PIXELS)
const PANEL_URL = cssUrl(PANEL_PIXELS)

// VIEW

const thumbAreaBoxView = (
  width: number,
  top: number,
  height: number,
  screenHeight: number,
  h: ApplicationViewBuilder,
): Html =>
  h.div([
    h.Key('thumb-area'),
    h.Class('thumb-area'),
    h.AriaHidden(true),
    h.Style({
      top: percentOf(top, screenHeight),
      height: percentOf(height, screenHeight),
      backgroundImage: `${RAIL_URL}, ${PANEL_URL}`,
      backgroundRepeat: 'repeat-x, repeat',
      backgroundPosition: `0 0, 0 ${percentOf(RAIL_HEIGHT, height - PANEL_HEIGHT)}`,
      backgroundSize: `${percentOf(1, width)} ${percentOf(RAIL_HEIGHT, height)}, ${percentOf(PANEL_WIDTH, width)} ${percentOf(PANEL_HEIGHT, height)}`,
    }),
  ])

const lazyThumbArea = createLazy()

export const thumbAreaView: {
  (h: ApplicationViewBuilder): (screen: Screen) => Html
  (screen: Screen, h: ApplicationViewBuilder): Html
} = Function.dual(2, (screen: Screen, h: ApplicationViewBuilder): Html => {
  if (screen.layout === 'Landscape') {
    return h.empty
  }
  const top = thumbAreaTop(screen)
  return lazyThumbArea(thumbAreaBoxView, [
    screen.width,
    top,
    screen.height - top,
    screen.height,
    h,
  ])
})
