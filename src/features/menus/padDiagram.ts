import { Array } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
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
): Html => {
  const glyphView = h.kbd(
    [
      h.Class('pad-glyph'),
      h.DataAttribute('face', face),
      ...(face === 'Plain' ? [] : [h.Style({ background: FACE_COLORS[face] })]),
    ],
    [glyph],
  )
  const actionView = h.span([h.Class('pad-action')], [action])
  const leader = h.span([h.Class('pad-leader'), h.AriaHidden(true)])
  return h.li(
    [h.Class('pad-button')],
    side === 'Left'
      ? [actionView, glyphView, leader]
      : [leader, glyphView, actionView],
  )
}

const sideView = (
  side: Side,
  buttons: ReadonlyArray<PadButton>,
  h: ApplicationViewBuilder,
): Html =>
  h.ul(
    [h.Class('pad-side'), h.DataAttribute('side', side)],
    Array.map(buttons, padButton => buttonView(side, padButton, h)),
  )

export const padDiagramView = (h: ApplicationViewBuilder): Html =>
  h.section(
    [h.Class('pad-diagram'), h.AriaLabel('Controller buttons')],
    [
      sideView('Left', LEFT_BUTTONS, h),
      iconView('pad-picture', PAD_ICON, h),
      sideView('Right', RIGHT_BUTTONS, h),
    ],
  )
