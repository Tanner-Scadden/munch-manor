import { Array, Function, Option, String } from 'effect'
import type { Html } from 'foldkit/html'

import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from './composition'
import {
  HELP_DEMO_SPRITES,
  HINT_ICON_SPRITES,
  type HintIconSprites,
  keyIcon,
} from './hintIcons'
import { Message } from './message'
import { type HelpCard, type InputDevice, type Model, Phase } from './model'
import { GUN_NAMES, KNIFE_NAME } from './names'
import { standaloneSource } from './sprite'

// CONTROLS

// NOTE: the one list of things a new player needs to do. The home menu's HOW
// TO PLAY and the pause screen both draw it as a grid of small cards: a
// moving picture for the last device used and a word or two. Each card also
// has one line of how to do it, from a playtester who found a picture and a
// word ("Leftovers", "Charge") taught nothing. On the home menu a card is a
// button that shows its line when focused, tapped, or hovered; on the pause
// screen, where a tap resumes, the line shows on hover and is read out.
type Input = Readonly<{ line: string; sprites: HintIconSprites }>

type ControlCard = Readonly<{
  id: HelpCard
  action: string
  keyboard: Input
  touch: Input
}>

const input = (line: string, sprites: HintIconSprites): Input => ({
  line,
  sprites,
})

const onBoth = (
  line: string,
  sprites: HintIconSprites,
): Readonly<{ keyboard: Input; touch: Input }> => ({
  keyboard: input(line, sprites),
  touch: input(line, sprites),
})

const KEY_R = keyIcon('R')

export const CONTROL_CARDS: Array.NonEmptyReadonlyArray<ControlCard> = [
  {
    id: 'Move',
    action: 'Move',
    keyboard: input(
      'Walk with WASD. They are slow, so keep moving.',
      HINT_ICON_SPRITES.Wasd,
    ),
    touch: input(
      'Drag a thumb on the left half. They are slow, so keep moving.',
      HINT_ICON_SPRITES.MoveStick,
    ),
  },
  {
    id: 'Aim',
    action: 'Aim + shoot',
    keyboard: input(
      'Point with the mouse. Hold the button to keep firing.',
      HINT_ICON_SPRITES.Mouse,
    ),
    touch: input(
      'Drag a thumb on the right half toward a zombie. It fires as you drag.',
      HINT_ICON_SPRITES.AimStick,
    ),
  },
  {
    id: 'Reload',
    action: 'Reload',
    keyboard: input(
      'Press R for a fresh magazine. An empty gun gets one by itself.',
      KEY_R,
    ),
    touch: input(
      'Tap the gun you hold for a fresh magazine.',
      HINT_ICON_SPRITES.Tap,
    ),
  },
  {
    id: 'Swap',
    action: 'Swap',
    keyboard: input(
      `Q switches guns. Only the ${GUN_NAMES.Pistol} never runs dry.`,
      HINT_ICON_SPRITES.KeyQ,
    ),
    touch: input(
      `Tap your other gun. Only the ${GUN_NAMES.Pistol} never runs dry.`,
      HINT_ICON_SPRITES.Guns,
    ),
  },
  {
    id: 'Knife',
    action: KNIFE_NAME,
    keyboard: input(
      'Press F to draw it, then fire to stab. No ammo needed.',
      HELP_DEMO_SPRITES.Knife,
    ),
    touch: input(
      'Tap its slot by your guns, then fire to stab. No ammo needed.',
      HELP_DEMO_SPRITES.Knife,
    ),
  },
  {
    id: 'Shop',
    action: 'Shop',
    ...onBoth(
      "Between waves, walk into Rattles' stall for ammo, guns, and hearts.",
      HINT_ICON_SPRITES.Stall,
    ),
  },
  {
    id: 'Traps',
    action: 'Traps',
    keyboard: input(
      'Buy them from Rattles, then press T in a doorway.',
      HINT_ICON_SPRITES.PlankDoor,
    ),
    touch: input(
      'Buy them from Rattles, then tap the trap button in a doorway.',
      HINT_ICON_SPRITES.PlankDoor,
    ),
  },
  {
    id: 'Goodies',
    action: 'Goodies',
    ...onBoth(
      'Zombies drop hearts and boosts. Walk over them before they fade.',
      HINT_ICON_SPRITES.Goodie,
    ),
  },
  {
    id: 'Leftovers',
    action: 'Leftovers',
    keyboard: input(
      'Hold Enter at the kitchen fridge to pay for a surprise weapon.',
      HELP_DEMO_SPRITES.Fridge,
    ),
    touch: input(
      'Hold the fridge button in the kitchen to pay for a surprise weapon.',
      HELP_DEMO_SPRITES.Fridge,
    ),
  },
  {
    id: 'Charge',
    action: 'Charge',
    keyboard: input(
      `${GUN_NAMES.Cooker}: hold click to build pressure, let go to throw.`,
      HELP_DEMO_SPRITES.Charge,
    ),
    touch: input(
      `${GUN_NAMES.Cooker}: hold your aim thumb, lift it to throw.`,
      HELP_DEMO_SPRITES.Charge,
    ),
  },
]

type ExtraKey = Readonly<{ key: string; action: string }>

// NOTE: the rest of the keyboard's keys, one short line under the cards, so
// every key still has a home on the screen that teaches the controls.
const EXTRA_KEYS: Array.NonEmptyReadonlyArray<ExtraKey> = [
  { key: 'G', action: 'next trap' },
  { key: 'Enter', action: 'start' },
  { key: 'Esc', action: 'pause' },
  { key: 'H', action: 'menu' },
  { key: 'M', action: 'sound' },
  { key: 'N', action: 'music' },
]

const DEVICE_LABELS: Readonly<Record<InputDevice, string>> = {
  KeyboardMouse: 'keyboard and mouse',
  Touch: 'touch',
}

const inputOf = (card: ControlCard, device: InputDevice): Input =>
  device === 'KeyboardMouse' ? card.keyboard : card.touch

export const helpLineOf: {
  (device: InputDevice): (card: HelpCard) => string
  (card: HelpCard, device: InputDevice): string
} = Function.dual(2, (card: HelpCard, device: InputDevice): string =>
  Option.match(
    Array.findFirst(CONTROL_CARDS, ({ id }) => id === card),
    {
      onNone: () => '',
      onSome: found => inputOf(found, device).line,
    },
  ),
)

export const helpCardElementId = (card: HelpCard): string =>
  `help-card-${String.toLowerCase(card)}`

export const helpLineElementId = (card: HelpCard): string =>
  `${helpCardElementId(card)}-line`

// VIEW

const HELP_TITLE_ID = 'pause-help-title'

type Frame = Readonly<{
  src: string
  x: number
  y: number
  width: number
  height: number
}>

// NOTE: each frame of a hint icon is one baked image. Where none was baked
// (a test without a canvas) the card shows no picture. A built game draws it
// from a region of the sprite atlas, which an <img> cannot crop, so each
// frame takes an image of its own.
const framesOf = (sprites: HintIconSprites): ReadonlyArray<Frame> =>
  Array.flatMap(sprites.frames, frame =>
    Array.flatMap(frame, (shape): ReadonlyArray<Frame> =>
      shape._tag === 'Image'
        ? [
            {
              src: standaloneSource(shape),
              x: shape.x,
              y: shape.y,
              width: shape.width,
              height: shape.height,
            },
          ]
        : [],
    ),
  )

const percent = (part: number, whole: number): string =>
  `${(part / whole) * 100}%`

// NOTE: the frames stack in one box and a CSS animation shows each in
// turn, so the picture moves with no work in the game's frame.
const movingView = (
  sprites: HintIconSprites,
  h: ApplicationViewBuilder,
): Html => {
  const frames = framesOf(sprites)
  return h.span(
    [
      h.Class('help-card-picture'),
      h.AriaHidden(true),
      h.Style({
        '--pic-w': `${sprites.width}`,
        '--pic-h': `${sprites.height}`,
        '--frames': `${frames.length}`,
        '--frame-ms': `${sprites.frameMs}ms`,
      }),
    ],
    Array.map(frames, (frame, index) =>
      h.img([
        h.Class('help-card-frame'),
        h.Src(frame.src),
        h.Alt(''),
        h.DataAttribute('frames', `${frames.length}`),
        h.DataAttribute('frame', `${index}`),
        h.Style({
          left: percent(frame.x, sprites.width),
          top: percent(frame.y, sprites.height),
          width: percent(frame.width, sprites.width),
          height: percent(frame.height, sprites.height),
          '--frame': `${index}`,
        }),
      ]),
    ),
  )
}

// NOTE: How to play on the home menu lets a card show its line; the pause
// screen, where a press resumes the game, only shows it on hover.
export type HelpCards = 'Interactive' | 'Static'

const cardFaceView = (
  card: ControlCard,
  device: InputDevice,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => {
  const { sprites, line } = inputOf(card, device)
  return [
    movingView(sprites, h),
    h.span([h.Class('help-card-action')], [card.action]),
    h.span(
      [h.Id(helpLineElementId(card.id)), h.Class('help-card-line')],
      [line],
    ),
  ]
}

const interactiveCardView = (
  card: ControlCard,
  device: InputDevice,
  maybeOpen: Option.Option<HelpCard>,
  h: ApplicationViewBuilder,
): Html => {
  const isOpen = Option.contains(maybeOpen, card.id)
  return h.keyed('li')(
    card.id,
    [h.Class('help-card-slot')],
    [
      h.button(
        [
          h.Type('button'),
          h.Id(helpCardElementId(card.id)),
          h.Class('help-card'),
          h.DataAttribute('open', isOpen ? 'true' : 'false'),
          h.AriaExpanded(isOpen),
          h.AriaDescribedBy(helpLineElementId(card.id)),
          h.OnFocus(Message.FocusedHelpCard({ card: card.id })),
          h.OnClick(Message.ClickedHelpCard({ card: card.id })),
        ],
        cardFaceView(card, device, h),
      ),
    ],
  )
}

const staticCardView = (
  card: ControlCard,
  device: InputDevice,
  h: ApplicationViewBuilder,
): Html =>
  h.keyed('li')(
    card.id,
    [
      h.Class('help-card'),
      h.DataAttribute('open', 'false'),
      h.AriaLabel(`${card.action}: ${inputOf(card, device).line}`),
    ],
    cardFaceView(card, device, h),
  )

const extraKeysView = (h: ApplicationViewBuilder): Html =>
  h.ul(
    [h.Class('help-extra'), h.AriaLabel('More keys')],
    Array.map(EXTRA_KEYS, ({ key, action }) =>
      h.li(
        [h.Class('help-extra-item')],
        [h.kbd([h.Class('menu-key')], [key]), ` ${action}`],
      ),
    ),
  )

export const helpLabel = (device: InputDevice): string => DEVICE_LABELS[device]

// NOTE: the home menu's HOW TO PLAY adds its own keys under the cards on a
// keyboard.
export const howToPlayView: {
  (
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<Html>,
  ): (model: Model) => ReadonlyArray<Html>
  (
    model: Model,
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<Html>,
  ): ReadonlyArray<Html>
} = Function.dual(
  4,
  (
    model: Model,
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<Html>,
  ): ReadonlyArray<Html> => [
    h.ul(
      [
        h.Class('help-cards'),
        h.DataAttribute('cards', cards),
        h.AriaLabel('Controls'),
      ],
      Array.map(CONTROL_CARDS, card =>
        cards === 'Interactive'
          ? interactiveCardView(
              card,
              model.lastDevice,
              model.maybeOpenHelpCard,
              h,
            )
          : staticCardView(card, model.lastDevice, h),
      ),
    ),
    ...(model.lastDevice === 'KeyboardMouse' ? [extraKeysView(h)] : []),
    ...Option.toArray(maybeUnder),
  ],
)

const isPauseHelpUp = (model: Model): boolean =>
  Phase.isAnyOf(['Paused'])(model.phase)

export const pauseHelpView: {
  (
    pressSurface: ApplicationAttribute,
    h: ApplicationViewBuilder,
  ): (model: Model) => Html
  (
    model: Model,
    pressSurface: ApplicationAttribute,
    h: ApplicationViewBuilder,
  ): Html
} = Function.dual(
  3,
  (
    model: Model,
    pressSurface: ApplicationAttribute,
    h: ApplicationViewBuilder,
  ): Html => {
    if (!isPauseHelpUp(model)) {
      return h.empty
    }

    return h.div(
      [h.Class('pause-help-frame')],
      [
        h.section(
          [
            h.Class('pause-help'),
            h.DataAttribute('device', model.lastDevice),
            h.AriaLabelledBy(HELP_TITLE_ID),
            pressSurface,
          ],
          [
            h.h2(
              [h.Id(HELP_TITLE_ID), h.Class('pause-help-title')],
              [
                'How to play',
                h.span(
                  [h.Class('sr-only')],
                  [` with ${helpLabel(model.lastDevice)}`],
                ),
              ],
            ),
            ...howToPlayView(model, 'Static', h, Option.none()),
          ],
        ),
      ],
    )
  },
)
