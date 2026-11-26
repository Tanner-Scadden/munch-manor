import { Array, Function, Option, String } from 'effect'

import type {
  ApplicationHtml,
  ApplicationMount,
  ApplicationViewBuilder,
} from '../../app/definition'
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

const HELP_TITLE_ID = 'pause-help-title'

type Frame = Readonly<{
  src: string
  x: number
  y: number
  width: number
  height: number
}>

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

const movingView = (
  sprites: HintIconSprites,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const frames = framesOf(sprites)
  return h.span
    .class('help-card-picture')
    .attr('aria-hidden', 'true')
    .style({
      '--pic-w': `${sprites.width}`,
      '--pic-h': `${sprites.height}`,
      '--frames': `${frames.length}`,
      '--frame-ms': `${sprites.frameMs}ms`,
    })
    .children(
      Array.map(frames, (frame, index) =>
        h.img
          .class('help-card-frame')
          .attr('src', frame.src)
          .attr('alt', '')
          .attr('data-frames', `${frames.length}`)
          .attr('data-frame', `${index}`)
          .style({
            left: percent(frame.x, sprites.width),
            top: percent(frame.y, sprites.height),
            width: percent(frame.width, sprites.width),
            height: percent(frame.height, sprites.height),
            '--frame': `${index}`,
          }),
      ),
    )
}

export type HelpCards = 'Interactive' | 'Static'

const cardFaceView = (
  card: ControlCard,
  device: InputDevice,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => {
  const { sprites, line } = inputOf(card, device)
  return [
    movingView(sprites, h),
    h.span.class('help-card-action').children(card.action),
    h.span
      .id(helpLineElementId(card.id))
      .class('help-card-line')
      .children(line),
  ]
}

const interactiveCardView = (
  card: ControlCard,
  device: InputDevice,
  maybeOpen: Option.Option<HelpCard>,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isOpen = Option.contains(maybeOpen, card.id)
  return h.li
    .key(card.id)
    .class('help-card-slot')
    .children(
      h.button
        .attr('type', 'button')
        .id(helpCardElementId(card.id))
        .class('help-card')
        .attr('data-open', isOpen ? 'true' : 'false')
        .attr('aria-expanded', isOpen ? 'true' : 'false')
        .attr('aria-describedby', helpLineElementId(card.id))
        .on('focus', HelpMessage.FocusedHelpCard({ card: card.id }))
        .on('click', HelpMessage.ClickedHelpCard({ card: card.id }))
        .children(cardFaceView(card, device, h)),
    )
}

const staticCardView = (
  card: ControlCard,
  device: InputDevice,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.li
    .key(card.id)
    .class('help-card')
    .attr('data-open', 'false')
    .attr('aria-label', `${card.action}: ${inputOf(card, device).line}`)
    .children(cardFaceView(card, device, h))

const extraKeysView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.ul
    .class('help-extra')
    .attr('aria-label', 'More keys')
    .children(
      Array.map(EXTRA_KEYS, ({ key, action }) =>
        h.li
          .class('help-extra-item')
          .children(h.kbd.class('menu-key').children(key), ` ${action}`),
      ),
    )

export const helpLabel = (device: InputDevice): string => DEVICE_LABELS[device]

export const howToPlayView: {
  (
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<ApplicationHtml>,
  ): (model: Model) => ReadonlyArray<ApplicationHtml>
  (
    model: Model,
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<ApplicationHtml>,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(
  4,
  (
    model: Model,
    cards: HelpCards,
    h: ApplicationViewBuilder,
    maybeUnder: Option.Option<ApplicationHtml>,
  ): ReadonlyArray<ApplicationHtml> => [
    h.ul
      .class('help-cards')
      .attr('data-cards', cards)
      .attr('aria-label', 'Controls')
      .children(
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

type PressSurface = ApplicationMount

export const pauseHelpView: {
  (
    pressSurface: PressSurface,
    h: ApplicationViewBuilder,
  ): (model: Model) => ApplicationHtml | null
  (
    model: Model,
    pressSurface: PressSurface,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null
} = Function.dual(
  3,
  (
    model: Model,
    pressSurface: PressSurface,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null => {
    if (!isPauseHelpUp(model)) {
      return null
    }

    return h.div.class('pause-help-frame').children(
      h.section
        .onMount(pressSurface)
        .class('pause-help')
        .attr('data-device', model.lastDevice)
        .attr('aria-labelledby', HELP_TITLE_ID)
        .children(
          pauseProgressView(model, h),
          h.h2
            .id(HELP_TITLE_ID)
            .class('pause-help-title')
            .children(
              'How to play',
              h.span
                .class('sr-only')
                .children(` with ${helpLabel(model.lastDevice)}`),
            ),
          ...howToPlayView(model, 'Static', h, Option.none()),
        ),
    )
  },
)
