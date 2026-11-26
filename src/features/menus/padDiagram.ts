import { Array } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import { pixelIconUrl } from '../../art/icons'
import { iconView } from '../../ui/menuParts'
import { KNIFE_NAME } from '../../world/names'

// THE CONTROLLER DIAGRAM

// NOTE: How to play with a controller in hand shows the pad itself, each
// button a run uses named beside it, the left side's on the left and the
// right side's on the right (owner, 2026-11-12: "we should have a diagram
// with which button does which"). The buttons are the ones
// src/input/keyActions.ts and src/input/gamepad.ts read; the face buttons
// wear the standard layout's colors, so a chip matches its button on the pad.

const PAD_PIXELS: ReadonlyArray<string> = [
  '....OTTTTTTTTO............OTTTTTTTTO....',
  '....OTTTTTTTTO............OTTTTTTTTO....',
  '....OTTTTTTTTO............OTTTTTTTTO....',
  '...OLLLLLLLLLLO..........OLLLLLLLLLLO...',
  '...OLLLLLLLLLLOOOOOOOOOOOOLLLLLLLLLLO...',
  '..OBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBO..',
  '..OBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBO..',
  '.OBBBBBBOOOBBBBBBBBBBBBBBBBBBBYYBBBBBBO.',
  '.OBBBBBOOSOOBBBBBWWBBWWBBBBBBBBBBBBBBBO.',
  '.OBBBBBOSSSOBBBBBBBBBBBBBBBBXXBBRRBBBBO.',
  '.OBBBBBOOSOOBBBOBBBBBBBBBBBBBBBBBBBBBBO.',
  '.OBBBBBBOOOBBBBOBBBBBBBBOOOBBBAABBBBBBO.',
  '.OBBBBBBBBBBBOOOOOBBBBBOOSOOBBBBBBBBBBO.',
  '.OBBBBBBBBBBBBBOBBBBBBBOSSSOBBBBBBBBBBO.',
  '..OBBBBBBBBBBBBOBBBBBBBOOSOOBBBBBBBBBO..',
  '..OBBBBBBBBBBBOOOOOOOOOOOOOBBBBBBBBBBO..',
  '..OBBBBBBBBBBBO..........OBBBBBBBBBBBO..',
  '..OBBBBBBBBBBBO..........OBBBBBBBBBBBO..',
  '...OBBBBBBBBBO............OBBBBBBBBBO...',
  '....OBBBBBBBO..............OBBBBBBBO....',
  '.....OBBBBBO................OBBBBBO.....',
  '......OOOOO..................OOOOO......',
]

type FaceColor = 'Green' | 'Red' | 'Blue' | 'Yellow'

const FACE_COLORS: Readonly<Record<FaceColor, string>> = {
  Green: '#6fcf5a',
  Red: '#ff6b5e',
  Blue: '#5aa9ff',
  Yellow: '#ffd25a',
}

const PAD_ICON = pixelIconUrl(PAD_PIXELS, {
  O: '#140c10',
  T: '#3d3848',
  L: '#4a4558',
  B: '#5a5568',
  S: '#2a2632',
  W: '#f4f1de',
  A: FACE_COLORS.Green,
  R: FACE_COLORS.Red,
  X: FACE_COLORS.Blue,
  Y: FACE_COLORS.Yellow,
})

type PadButton = Readonly<{
  glyph: string
  action: string
  face: 'Plain' | FaceColor
}>

const button = (
  glyph: string,
  action: string,
  face: 'Plain' | FaceColor = 'Plain',
): PadButton => ({ glyph, action, face })

// NOTE: top to bottom as they sit on the pad.
const LEFT_BUTTONS: Array.NonEmptyReadonlyArray<PadButton> = [
  button('LT', 'trap'),
  button('LB', 'next trap'),
  button('L', 'walk'),
  button('View', 'your list'),
  button('Menu', 'pause'),
]

const RIGHT_BUTTONS: Array.NonEmptyReadonlyArray<PadButton> = [
  button('RT', 'shoot'),
  button('Y', 'next weapon', 'Yellow'),
  button('X', 'reload', 'Blue'),
  button('B', KNIFE_NAME, 'Red'),
  button('A', 'ready, hold to buy', 'Green'),
  button('R', 'aim'),
]

type Side = 'Left' | 'Right'

const buttonView = (
  side: Side,
  { glyph, action, face }: PadButton,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const glyphView = h.kbd
    .class('pad-glyph')
    .attr('data-face', face)
    .style(face === 'Plain' ? {} : { background: FACE_COLORS[face] })
    .children(glyph)
  const actionView = h.span.class('pad-action').children(action)
  const leader = h.span.class('pad-leader').attr('aria-hidden', 'true')
  return h.li
    .class('pad-button')
    .children(
      side === 'Left'
        ? [actionView, glyphView, leader]
        : [leader, glyphView, actionView],
    )
}

const sideView = (
  side: Side,
  buttons: ReadonlyArray<PadButton>,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.ul
    .class('pad-side')
    .attr('data-side', side)
    .children(Array.map(buttons, padButton => buttonView(side, padButton, h)))

export const padDiagramView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.section
    .class('pad-diagram')
    .attr('aria-label', 'Controller buttons')
    .children(
      sideView('Left', LEFT_BUTTONS, h),
      iconView('pad-picture', PAD_ICON, h),
      sideView('Right', RIGHT_BUTTONS, h),
    )
