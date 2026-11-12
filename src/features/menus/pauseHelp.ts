import { Array, Function, Option, String } from 'effect'
import type { Html } from 'foldkit/html'

import type {
  ApplicationAttribute,
  ApplicationViewBuilder,
} from '../../app/composition'
import type { Model } from '../../app/model'
import {
  HELP_DEMO_SPRITES,
  HINT_ICON_SPRITES,
  type HintIconSprites,
} from '../../art/hintIcons'
import { standaloneSource } from '../../art/sprite'
import type { InputDevice } from '../../input/inputSchema'
import { KNIFE_NAME } from '../../world/names'
import { Phase } from '../../world/schema/worldSchema'
import { type HelpCard, HelpMessage } from './message'
import { pauseProgressView } from './pauseProgress'

// CONTROLS

// NOTE: the one list of things a new player needs to do. The home menu's HOW
// TO PLAY and the pause screen both draw it as a grid of small cards: a
// moving picture for the last device used and a word or two. Each card also
// has one line of how to do it, from a playtester who found a picture and a
// word taught nothing. On the home menu a card is a
// button that shows its line when focused, tapped, or hovered; on the pause
// screen, where a tap resumes, the line shows on hover and is read out. The
// top row is the controls and the bottom row the dare: keys, rooms, cases,
// the list, and the way out (the escape the manor update, 2026-11-10), with
// gun levels and the stove beside the cases (owner, 2026-11-10: "I am also
// very confused on how I do the upgrades for the weapon now.").
type Input = Readonly<{ line: string; sprites: HintIconSprites }>

type ControlCard = Readonly<{
  id: HelpCard
  action: string
  keyboard: Input
  touch: Input
  pad: Input
}>

const input = (line: string, sprites: HintIconSprites): Input => ({
  line,
  sprites,
})

const onEvery = (
  line: string,
  sprites: HintIconSprites,
): Readonly<{ keyboard: Input; touch: Input; pad: Input }> => ({
  keyboard: input(line, sprites),
  touch: input(line, sprites),
  pad: input(line, sprites),
})

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
    pad: input(
      'Walk with the left stick. They are slow, so keep moving.',
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
    pad: input(
      'Aim with the right stick. Pull the right trigger to fire.',
      HINT_ICON_SPRITES.AimStick,
    ),
  },
  {
    id: 'Swap',
    action: 'Swap',
    keyboard: input(
      'Q switches guns, 1 and 2 pick one, R reloads. Ammo never runs out.',
      HINT_ICON_SPRITES.KeyQ,
    ),
    touch: input(
      'Tap your other gun. Tap the one in hand to reload.',
      HINT_ICON_SPRITES.Guns,
    ),
    pad: input(
      'Y steps gun, gun, knife. X reloads. Ammo never runs out.',
      HINT_ICON_SPRITES.Guns,
    ),
  },
  {
    id: 'Knife',
    action: KNIFE_NAME,
    keyboard: input(
      'Press F or 3 to draw it, then fire to stab.',
      HELP_DEMO_SPRITES.Knife,
    ),
    touch: input(
      'Tap its slot by your guns, then fire to stab.',
      HELP_DEMO_SPRITES.Knife,
    ),
    pad: input(
      'Press B to draw it, then fire to stab.',
      HELP_DEMO_SPRITES.Knife,
    ),
  },
  {
    id: 'Traps',
    action: 'Traps',
    keyboard: input(
      'Grab them from a crate, then press T in a doorway.',
      HINT_ICON_SPRITES.PlankDoor,
    ),
    touch: input(
      'Grab them from a crate, then tap the trap button in a doorway.',
      HINT_ICON_SPRITES.PlankDoor,
    ),
    pad: input(
      'Grab them from a crate, then pull the left trigger in a doorway.',
      HINT_ICON_SPRITES.PlankDoor,
    ),
  },
  {
    id: 'Keys',
    action: 'Keys',
    ...onEvery(
      'Zombies drop them. Walk over them to fill your ring.',
      HELP_DEMO_SPRITES.Keys,
    ),
  },
  {
    id: 'Rooms',
    action: 'Rooms',
    keyboard: input(
      'Hold Enter at a padlock to spend keys. Each hides a thing.',
      HELP_DEMO_SPRITES.Rooms,
    ),
    touch: input(
      'Hold the button at a padlock to spend keys. Each hides a thing.',
      HELP_DEMO_SPRITES.Rooms,
    ),
    pad: input(
      'Hold A at a padlock to spend keys. Each hides a thing.',
      HELP_DEMO_SPRITES.Rooms,
    ),
  },
  {
    id: 'Cases',
    action: 'Cases',
    ...onEvery(
      'Do the deed on the lock. What is inside is yours.',
      HELP_DEMO_SPRITES.Case,
    ),
  },
  {
    id: 'Guns',
    action: 'Guns',
    ...onEvery(
      'Kills level up the gun that made them. Its bar fills under it.',
      HINT_ICON_SPRITES.GunLevel,
    ),
  },
  {
    id: 'Stove',
    action: 'Stove',
    ...onEvery(
      'In the kitchen, cook a perk onto the gun in your hand.',
      HELP_DEMO_SPRITES.Stove,
    ),
  },
  {
    id: 'List',
    action: 'Your list',
    ...onEvery(
      'Up top: what the dare asks for. Find every thing.',
      HELP_DEMO_SPRITES.List,
    ),
  },
  {
    id: 'Exit',
    action: 'Get out',
    ...onEvery(
      'All found? Beat Uncle Chunk. His key opens the front door.',
      HELP_DEMO_SPRITES.Exit,
    ),
  },
]

type ExtraKey = Readonly<{ key: string; action: string }>

// NOTE: the rest of the keyboard's keys, one short line under the cards, so
// every key still has a home on the screen that teaches the controls.
const EXTRA_KEYS: Array.NonEmptyReadonlyArray<ExtraKey> = [
  { key: 'R', action: 'reload' },
  { key: '1 2 3', action: 'pick a slot' },
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
  Gamepad: 'a controller',
}

const inputOf = (card: ControlCard, device: InputDevice): Input =>
  ({ KeyboardMouse: card.keyboard, Touch: card.touch, Gamepad: card.pad })[
    device
  ]

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
          h.OnFocus(HelpMessage.FocusedHelpCard({ card: card.id })),
          h.OnClick(HelpMessage.ClickedHelpCard({ card: card.id })),
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
            pauseProgressView(model, h),
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
