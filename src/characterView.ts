import { Array, Option } from 'effect'
import { Canvas } from 'foldkit'
import type { Html } from 'foldkit/html'

import type { RadioGroup } from '@foldkit/ui'

import {
  BODIES,
  HAIR_COLORS,
  HAIR_SHADES,
  HAIR_STYLES,
  OUTFITS,
  PRINTS,
  RAINBOW_STRIPES,
  SHIRT_COLORS,
  SHIRT_SHADES,
  SKIN_SHADES,
  SKIN_TONES,
  STRIPE_WHITE,
  appearanceKey,
  hatHeadRows,
  playerPalette,
  playerPixels,
  playerSprites,
  printSwatchRows,
} from './appearance'
import { startingGunKind } from './calling'
import {
  CharacterComposition,
  type CharacterViewBuilder,
  Message,
  PART_BINDINGS,
  SECTION_PARTS,
  SECTION_TOGGLES,
  SectionsBinding,
  chooseLook,
  flipLook,
  gearOf,
  isToggleOn,
  partGroupOf,
} from './character'
import { type Standing, canAfford, priceOf, standingOf } from './closet'
import {
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  SHADOW_COLOR,
} from './constants'
import { DICE_ICON, pixelIconUrl } from './icons'
import {
  buyPillView,
  cueAttributes,
  gearNote,
  gearTagView,
  newBadgeView,
} from './lookGearView'
import {
  type Appearance,
  type CharacterPicker,
  type ClosetCueKind,
  type LookPart,
  LookSection,
  type LookToggle,
  type Print,
  type ProfileFx,
} from './model'
import { HAT_NAMES, hatNameOf } from './names'
import {
  type Calling,
  type CosmeticKind,
  GunSkin,
  Hat,
  type SavedBoughtCosmetics,
  type SavedRank,
} from './playerData'
import { GUN_HOLD_PX } from './playerView'
import { rankOf, totalPointsOf } from './rank'
import { type Facing, frameAt, group } from './sprite'
import { gunPictureOf, gunSprite } from './sprites/guns'
import { lookUnlockId } from './unlocks'

// PARTS

// NOTE: how an option shows: the character in it (the whole figure, or the
// head and shoulders), or a swatch of its color or print.
type OptionLook = 'Figure' | 'Head' | 'Swatch' | 'Flag' | 'Hat' | 'Gun'

type PartView = Readonly<{
  label: string
  ariaLabel: string
  options: Array.NonEmptyReadonlyArray<string>
  selected: (appearance: Appearance) => string
  look: OptionLook
  swatch: (value: string, appearance: Appearance) => string
}>

const noSwatch = (): string => 'none'

const isPrint = (value: string): value is Print =>
  Array.some(PRINTS, print => print === value)

const isSkin = (value: string): value is GunSkin =>
  Array.some(GunSkin.literals, skin => skin === value)

const FLAG_WIDTH = 30
const FLAG_HEIGHT = 20

const stripesUrl = (colors: ReadonlyArray<string>): string => {
  const height = FLAG_HEIGHT / colors.length
  const rects = Array.join(
    Array.map(
      colors,
      (color, index) =>
        `<rect x="0" y="${index * height}" width="${FLAG_WIDTH}" height="${height + 0.5}" fill="${color}"/>`,
    ),
    '',
  )
  return `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${FLAG_WIDTH} ${FLAG_HEIGHT}" shape-rendering="crispEdges">${rects}</svg>`,
  )}")`
}

const RAINBOW_SWATCH = stripesUrl(RAINBOW_STRIPES)

const swatchCache = new Map<string, string>()

// NOTE: a print as its swatch, in the shirt's own color: plain, a white
// band across it, or the rainbow flag as it is flown.
const printSwatch = (print: Print, appearance: Appearance): string => {
  if (print === 'Rainbow') {
    return RAINBOW_SWATCH
  }
  const shirt = SHIRT_SHADES[appearance.shirtColor].base
  const key = `${print}.${shirt}`
  return Option.getOrElse(Option.fromNullishOr(swatchCache.get(key)), () => {
    const url =
      print === 'Plain' || print === 'Stripes'
        ? stripesUrl(print === 'Plain' ? [shirt] : [shirt, STRIPE_WHITE, shirt])
        : pixelIconUrl(
            printSwatchRows(print),
            playerPalette(appearance),
            'Stretch',
          )
    swatchCache.set(key, url)
    return url
  })
}

const swatchOf =
  <A extends string>(options: ReadonlyArray<A>, color: (option: A) => string) =>
  (value: string): string =>
    Option.getOrElse(
      Option.map(
        Array.findFirst(options, option => option === value),
        color,
      ),
      () => 'none',
    )

// NOTE: the Pop Pistol held large, in a skin: what a gun skin option shows.
const gunOptionUrl = (skin: GunSkin): string => {
  const { rows, palette } = gunPictureOf('Pistol', skin)
  return pixelIconUrl(rows, palette)
}

const PART_VIEWS: Readonly<Record<LookPart, PartView>> = {
  Body: {
    label: 'Shape',
    ariaLabel: 'Body shape',
    options: BODIES,
    selected: appearance => appearance.body,
    look: 'Figure',
    swatch: noSwatch,
  },
  SkinTone: {
    label: 'Skin',
    ariaLabel: 'Skin',
    options: SKIN_TONES,
    selected: appearance => appearance.skinTone,
    look: 'Swatch',
    swatch: swatchOf(SKIN_TONES, tone => SKIN_SHADES[tone].skin),
  },
  HairStyle: {
    label: 'Style',
    ariaLabel: 'Hair',
    options: HAIR_STYLES,
    selected: appearance => appearance.hairStyle,
    look: 'Head',
    swatch: noSwatch,
  },
  HairColor: {
    label: 'Color',
    ariaLabel: 'Hair color',
    options: HAIR_COLORS,
    selected: appearance => appearance.hairColor,
    look: 'Swatch',
    swatch: swatchOf(HAIR_COLORS, color => HAIR_SHADES[color].base),
  },
  Outfit: {
    label: 'Outfit',
    ariaLabel: 'Outfit',
    options: OUTFITS,
    selected: appearance => appearance.outfit,
    look: 'Figure',
    swatch: noSwatch,
  },
  ShirtColor: {
    label: 'Color',
    ariaLabel: 'Outfit color',
    options: SHIRT_COLORS,
    selected: appearance => appearance.shirtColor,
    look: 'Swatch',
    swatch: swatchOf(SHIRT_COLORS, color => SHIRT_SHADES[color].base),
  },
  Print: {
    label: 'Print',
    ariaLabel: 'Print',
    options: PRINTS,
    selected: appearance => appearance.print,
    look: 'Flag',
    swatch: (value, appearance) =>
      isPrint(value) ? printSwatch(value, appearance) : 'none',
  },
  Hat: {
    label: 'Hat',
    ariaLabel: 'Hat',
    options: Hat.literals,
    selected: appearance => appearance.hat,
    look: 'Hat',
    swatch: noSwatch,
  },
  GunSkin: {
    label: 'Gun',
    ariaLabel: 'Gun skin',
    options: GunSkin.literals,
    selected: appearance => appearance.gunSkin,
    look: 'Gun',
    swatch: value => (isSkin(value) ? gunOptionUrl(value) : 'none'),
  },
}

const lookDescription = (appearance: Appearance): string =>
  [
    `${appearance.body} build`,
    `${appearance.skinTone} skin`,
    appearance.hairStyle === 'Bald'
      ? 'bald'
      : `${appearance.hairColor} ${appearance.hairStyle} hair`,
    ...(appearance.beard ? ['beard'] : []),
    ...(appearance.glasses ? ['glasses'] : []),
    `${appearance.shirtColor} ${appearance.outfit}`,
    ...(appearance.print === 'Plain' ? [] : [`${appearance.print} print`]),
    ...(appearance.hat === 'None' ? [] : [HAT_NAMES[appearance.hat]]),
    ...(appearance.gunSkin === 'Stock' ? [] : [`${appearance.gunSkin} gun`]),
  ]
    .join(', ')
    .toLowerCase()

// PART ICONS

// NOTE: the option's own pixels: the standing frame of the look with that
// option in it, the whole figure or the head and shoulders. Each is drawn
// once, and the cache is emptied when it grows past a few hundred, as the
// dice can try a great many looks.
const ICON_CACHE_LIMIT = 400
const HEAD_ROWS = { from: 1, to: 9 }

const iconCache = new Map<string, string>()

const partIconOf = (worn: Appearance, crop: 'Figure' | 'Head'): string => {
  // NOTE: the options are drawn bare headed: a hat changes the rows the
  // crop counts, and the Look tab is not about hats (the closet is).
  const look: Appearance = { ...worn, hat: 'None' }
  const key = `${crop}.${appearanceKey(look)}`
  return Option.getOrElse(Option.fromNullishOr(iconCache.get(key)), () => {
    const rows = Array.headNonEmpty(playerPixels(look).idle)
    const url = pixelIconUrl(
      crop === 'Head' ? rows.slice(HEAD_ROWS.from, HEAD_ROWS.to) : rows,
      playerPalette(look),
    )
    if (iconCache.size >= ICON_CACHE_LIMIT) {
      iconCache.clear()
    }
    iconCache.set(key, url)
    return url
  })
}

// NOTE: a hat option's picture: the head under that hat, drawn the same way.
const hatIconOf = (worn: Appearance): string => {
  const key = `Hat.${appearanceKey(worn)}`
  return Option.getOrElse(Option.fromNullishOr(iconCache.get(key)), () => {
    const url = pixelIconUrl(hatHeadRows(worn), playerPalette(worn))
    if (iconCache.size >= ICON_CACHE_LIMIT) {
      iconCache.clear()
    }
    iconCache.set(key, url)
    return url
  })
}

// PREVIEW

const PREVIEW_SIZE = 20
const PREVIEW_FOOT_Y = 18
const PREVIEW_TURN_MS = 2400

const previewFacing = (screenMs: number): Facing =>
  Math.floor(screenMs / PREVIEW_TURN_MS) % 2 === 0 ? 'Right' : 'Left'

const previewShapes = (
  appearance: Appearance,
  calling: Calling,
  screenMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const facing = previewFacing(screenMs)
  const direction = facing === 'Right' ? 1 : -1
  const centerX = PREVIEW_SIZE / 2
  return [
    Canvas.Rect({
      x: centerX - 3,
      y: PREVIEW_FOOT_Y - 1,
      width: 7,
      height: 2,
      fill: SHADOW_COLOR,
    }),
    group({
      translate: { x: centerX, y: PREVIEW_FOOT_Y },
      shapes: frameAt(
        playerSprites(appearance, calling).walk,
        Math.floor(screenMs / PLAYER_WALK_FRAME_MS),
      ).Normal[facing],
    }),
    group({
      translate: {
        x: centerX + direction * GUN_HOLD_PX,
        y: PREVIEW_FOOT_Y - PLAYER_FOOT_OFFSET,
      },
      shapes: gunSprite(
        startingGunKind(calling),
        0,
        facing === 'Right' ? 0 : Math.PI,
        appearance.gunSkin,
      ),
    }),
  ]
}

const previewView = (
  appearance: Appearance,
  calling: Calling,
  screenMs: number,
  h: CharacterViewBuilder,
): Html =>
  h.div(
    [
      h.Class('look-preview'),
      h.Role('img'),
      h.AriaLabel(`Preview: ${lookDescription(appearance)}`),
    ],
    [
      Canvas.view(
        {
          width: PREVIEW_SIZE,
          height: PREVIEW_SIZE,
          shapes: previewShapes(appearance, calling, screenMs),
          className: 'look-preview-canvas',
        },
        h,
      ),
    ],
  )

// STAGE

// NOTE: the character walks on the spot in a spotlight with a little idle
// bounce, all CSS. A new part puffs a poof, and the dice spins the stage
// like a slot machine.
// NOTE: the look on the figure: the worn one, or with the look being tried
// on (src/update/character.ts) over it. The worn look never changes.
const shownLookOf = (inputs: ViewInputs): Appearance =>
  Option.match(inputs.maybePreview, {
    onNone: () => inputs.appearance,
    onSome: ({ part, value }) => chooseLook(inputs.appearance, part, value),
  })

// NOTE: the BUY pill with the price, while a look for sale is tried on. Short
// of Bones it stays, red, and shakes when pressed.
const buyPillOf = (
  inputs: ViewInputs,
  h: CharacterViewBuilder,
): ReadonlyArray<Html> =>
  Option.match(inputs.maybePreview, {
    onNone: () => [],
    onSome: ({ part, value }) =>
      Option.match(gearOf(part), {
        onNone: () => [],
        onSome: ({ kind }) =>
          Option.match(priceOf(kind, value), {
            onNone: () => [],
            onSome: price => [
              buyPillView(
                {
                  price,
                  isShort: !canAfford(inputs.rank, kind, value),
                  onClick: Message.ClickedBuyButton(),
                },
                h,
              ),
            ],
          }),
      }),
  })

const stageChildren = (
  inputs: ViewInputs,
  h: CharacterViewBuilder,
): ReadonlyArray<Html> => [
  h.span([h.Class('look-spotlight'), h.AriaHidden(true)]),
  h.span([h.Class('look-floor'), h.AriaHidden(true)]),
  h.div(
    [h.Class('look-bounce')],
    [previewView(shownLookOf(inputs), inputs.calling, inputs.screenMs, h)],
  ),
  ...buyPillOf(inputs, h),
  h.span([h.Class('look-poof'), h.AriaHidden(true)]),
  h.button(
    [
      h.Type('button'),
      h.Class('profile-dice look-dice'),
      h.AriaLabel('Roll a random look'),
      h.OnClick(Message.ClickedDiceButton()),
    ],
    [
      h.span([
        h.Class('profile-dice-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: DICE_ICON }),
      ]),
    ],
  ),
]

const evenStageView = (inputs: ViewInputs, h: CharacterViewBuilder): Html =>
  h.div(
    [h.Class('look-stage'), h.DataAttribute('fx', inputs.fx)],
    stageChildren(inputs, h),
  )

const oddStageView = (inputs: ViewInputs, h: CharacterViewBuilder): Html =>
  h.div(
    [h.Class('look-stage'), h.DataAttribute('fx', inputs.fx)],
    stageChildren(inputs, h),
  )

const stageView = (inputs: ViewInputs, h: CharacterViewBuilder): Html =>
  inputs.fxCount % 2 === 0 ? evenStageView(inputs, h) : oddStageView(inputs, h)

// SECTIONS

const SECTION_ICON_PALETTE = { X: '#f4f1de', O: '#140c10' }

type SectionLook = Readonly<{ word: string; icon: string }>

const SECTION_LOOKS: Readonly<Record<LookSection, SectionLook>> = {
  Body: {
    word: 'Body',
    icon: pixelIconUrl(
      [
        '...XXX...',
        '...XXX...',
        '.XXXXXXX.',
        'X.XXXXX.X',
        'X.XXXXX.X',
        '..XX.XX..',
        '..XX.XX..',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Hair: {
    word: 'Hair',
    icon: pixelIconUrl(
      [
        '..XXXXX..',
        '.XXXXXXX.',
        'XXX...XXX',
        'XX.....XX',
        'XX.....XX',
        'X.......X',
        'X.......X',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Gear: {
    word: 'Gear',
    icon: pixelIconUrl(
      [
        '...XXX...',
        '..XXXXX..',
        '..XXXXX..',
        'XXXXXXXXX',
        '.........',
        'XXXX.....',
        'X..XXXXXX',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
  Outfit: {
    word: 'Outfit',
    icon: pixelIconUrl(
      [
        '.XXX.XXX.',
        'XXXXXXXXX',
        'XXXXXXXXX',
        '..XXXXX..',
        '..XXXXX..',
        '..XXXXX..',
        '..XXXXX..',
      ],
      SECTION_ICON_PALETTE,
    ),
  },
}

// NOTE: a little tab wears a dot while a look inside it is new, so the
// player knows which tab to open.
const hasNewLook = (
  section: LookSection,
  fresh: ReadonlyArray<string>,
): boolean =>
  Array.some(SECTION_PARTS[section], part =>
    Option.exists(gearOf(part), ({ kind }) =>
      Array.some(fresh, id => id.startsWith(`${kind.toLowerCase()}:`)),
    ),
  )

const sectionsView = (
  picker: CharacterPicker,
  fresh: ReadonlyArray<string>,
  h: CharacterViewBuilder,
): Html =>
  h.block(
    SectionsBinding.embedView({
      slotId: picker.sections.id,
      model: picker.sections,
      viewInputs: {
        options: LookSection.literals,
        selectedValue: Option.some(picker.section),
        ariaLabel: 'Parts',
        orientation: 'Horizontal',
        toView: ({ group: groupAttributes, options }) =>
          h.div(
            [...groupAttributes, h.Class('look-sections')],
            Array.map(options, option =>
              h.button(
                [
                  ...option.option,
                  h.Key(option.value),
                  h.Class('look-section'),
                  h.DataAttribute('section', option.value),
                  ...(hasNewLook(option.value, fresh)
                    ? [h.DataAttribute('new', 'true')]
                    : []),
                ],
                [
                  h.span([
                    h.Class('look-section-icon'),
                    h.AriaHidden(true),
                    h.Style({
                      backgroundImage: SECTION_LOOKS[option.value].icon,
                    }),
                  ]),
                  h.span(
                    [...option.label, h.Class('look-section-word')],
                    [SECTION_LOOKS[option.value].word],
                  ),
                ],
              ),
            ),
          ),
      },
    }),
  )

// ROWS

// NOTE: seven small options fit across the narrowest phone, so a longer list takes
// as few lines as it needs, filled as evenly as it can be.
const MOST_COLUMNS = 7

const balancedColumns = (count: number): number => {
  const lines = Math.ceil(count / MOST_COLUMNS)
  return Math.ceil(count / Math.max(1, lines))
}

const optionFace = (
  part: LookPart,
  value: string,
  appearance: Appearance,
  h: CharacterViewBuilder,
): Html => {
  const partView = PART_VIEWS[part]
  if (partView.look === 'Hat') {
    return h.span([
      h.Class('look-hat-icon'),
      h.AriaHidden(true),
      h.Style({
        backgroundImage: hatIconOf(chooseLook(appearance, part, value)),
      }),
    ])
  }
  if (partView.look === 'Gun') {
    return h.span([
      h.Class('look-gun-icon'),
      h.AriaHidden(true),
      h.Style({ backgroundImage: partView.swatch(value, appearance) }),
    ])
  }
  if (partView.look === 'Figure' || partView.look === 'Head') {
    return h.span([
      h.Class(
        partView.look === 'Figure' ? 'look-figure-icon' : 'look-head-icon',
      ),
      h.AriaHidden(true),
      h.Style({
        backgroundImage: partIconOf(
          chooseLook(appearance, part, value),
          partView.look,
        ),
      }),
    ])
  }
  return h.span([
    h.Class(partView.look === 'Flag' ? 'look-swatch look-flag' : 'look-swatch'),
    h.AriaHidden(true),
    h.Style(
      partView.look === 'Flag'
        ? { backgroundImage: partView.swatch(value, appearance) }
        : { background: partView.swatch(value, appearance) },
    ),
  ])
}

// NOTE: what an option of an earned part is, for the standing it shows.
type GearOption = Readonly<{
  kind: CosmeticKind
  standing: Standing
  isNew: boolean
}>

const optionView = (
  part: LookPart,
  appearance: Appearance,
  option: RadioGroup.OptionInfo,
  maybeGear: Option.Option<GearOption>,
  cue: ViewInputs['cue'],
  isPreviewed: boolean,
  h: CharacterViewBuilder,
): Html => {
  const partView = PART_VIEWS[part]
  const face = optionFace(part, option.value, appearance, h)
  return Option.match(maybeGear, {
    onNone: () =>
      h.button(
        [
          ...option.option,
          h.Key(option.value),
          h.Class(`look-option look-${partView.look.toLowerCase()}-option`),
        ],
        [face, h.span([...option.label, h.Class('sr-only')], [option.value])],
      ),
    onSome: ({ kind, standing, isNew }) => {
      const shown = part === 'Hat' ? hatNameOf(option.value) : option.value
      const isCued = cue.part === part && cue.value === option.value
      return h.button(
        [
          ...option.option,
          h.Key(option.value),
          h.Class(`look-option look-${partView.look.toLowerCase()}-option`),
          h.DataAttribute('standing', standing),
          h.DataAttribute('look-option', `${part}.${option.value}`),
          ...(isPreviewed ? [h.DataAttribute('previewed', 'true')] : []),
          ...(isNew ? [h.DataAttribute('new', 'true')] : []),
          ...(isCued ? cueAttributes(cue, h) : []),
          h.OnClick(Message.ClickedGearOption({ part, value: option.value })),
        ],
        [
          face,
          ...Option.match(gearTagView(kind, option.value, standing, h), {
            onNone: () => [],
            onSome: tag => [tag],
          }),
          ...(isNew ? [newBadgeView(h)] : []),
          h.span([...option.label, h.Class('sr-only')], [shown]),
          h.span(
            [...option.description, h.Class('sr-only')],
            [gearNote(kind, option.value, standing, isNew)],
          ),
        ],
      )
    },
  })
}

const lookRowView = (
  picker: CharacterPicker,
  part: LookPart,
  inputs: ViewInputs,
  h: CharacterViewBuilder,
): Html => {
  const { appearance } = inputs
  const partView = PART_VIEWS[part]
  const groupModel = partGroupOf(picker, part)
  const selected = partView.selected(appearance)
  const maybeKind = Option.map(gearOf(part), ({ kind }) => kind)
  const rankNumber = rankOf(totalPointsOf(inputs.rank))
  const gearOption = (value: string): Option.Option<GearOption> =>
    Option.map(maybeKind, kind => ({
      kind,
      standing: standingOf(kind, value, selected, inputs.bought, rankNumber),
      isNew: Array.contains(inputs.fresh, lookUnlockId(kind, value)),
    }))
  return h.div(
    [h.Class('look-row'), h.Key(part)],
    [
      h.div(
        [h.Class('look-row-heading'), h.AriaHidden(true)],
        [
          h.span([h.Class('look-row-label')], [partView.label]),
          h.span(
            [h.Class('look-row-value')],
            [part === 'Hat' ? hatNameOf(selected) : selected],
          ),
        ],
      ),
      h.block(
        PART_BINDINGS[part].embedView({
          slotId: groupModel.id,
          model: groupModel,
          viewInputs: {
            options: partView.options,
            selectedValue: Option.some(selected),
            ariaLabel: partView.ariaLabel,
            orientation: 'Horizontal',
            isReadOnly: Option.isSome(maybeKind),
            hasOptionDescription: () => Option.isSome(maybeKind),
            toView: ({ group: groupAttributes, options }) =>
              h.div(
                [
                  ...groupAttributes,
                  h.Class('look-options'),
                  h.Style({
                    '--look-columns': `${balancedColumns(partView.options.length)}`,
                  }),
                ],
                Array.map(options, option =>
                  optionView(
                    part,
                    appearance,
                    option,
                    gearOption(option.value),
                    inputs.cue,
                    Option.exists(
                      inputs.maybePreview,
                      preview =>
                        preview.part === part && preview.value === option.value,
                    ),
                    h,
                  ),
                ),
              ),
          },
        }),
      ),
    ],
  )
}

// TOGGLES

const TOGGLE_LABELS: Readonly<Record<LookToggle, string>> = {
  Beard: 'Beard',
  Glasses: 'Glasses',
}

// NOTE: an on and off part is one button showing the head with it on,
// pressed while it is worn.
const toggleView = (
  toggle: LookToggle,
  appearance: Appearance,
  h: CharacterViewBuilder,
): Html => {
  const isOn = isToggleOn(appearance, toggle)
  const shown = isOn ? appearance : flipLook(appearance, toggle)
  return h.button(
    [
      h.Type('button'),
      h.Key(toggle),
      h.Class('look-option look-head-option look-toggle'),
      h.AriaPressed(isOn ? 'true' : 'false'),
      h.AriaLabel(TOGGLE_LABELS[toggle]),
      h.OnClick(Message.ClickedToggle({ toggle })),
    ],
    [
      h.span([
        h.Class('look-head-icon'),
        h.AriaHidden(true),
        h.Style({ backgroundImage: partIconOf(shown, 'Head') }),
      ]),
    ],
  )
}

const togglesView = (
  toggles: ReadonlyArray<LookToggle>,
  appearance: Appearance,
  h: CharacterViewBuilder,
): ReadonlyArray<Html> =>
  Array.match(toggles, {
    onEmpty: () => [],
    onNonEmpty: shown => [
      h.div(
        [h.Class('look-row'), h.Key('toggles')],
        [
          h.div(
            [h.Class('look-row-heading'), h.AriaHidden(true)],
            [h.span([h.Class('look-row-label')], ['Face'])],
          ),
          h.div(
            [h.Class('look-options look-toggles')],
            Array.map(shown, toggle => toggleView(toggle, appearance, h)),
          ),
        ],
      ),
    ],
  })

// LOOK TAB

type ViewInputs = Readonly<{
  appearance: Appearance
  calling: Calling
  screenMs: number
  fx: ProfileFx
  fxCount: number
  bought: SavedBoughtCosmetics
  rank: SavedRank
  fresh: ReadonlyArray<string>
  maybePreview: Option.Option<Readonly<{ part: LookPart; value: string }>>
  cue: Readonly<{
    part: LookPart
    value: string
    kind: ClosetCueKind
    count: number
  }>
}>

export const view = CharacterComposition.makeView.withInputs<ViewInputs>(
  (picker, inputs, h) =>
    h.div(
      [h.Class('look-tab')],
      [
        stageView(inputs, h),
        h.div(
          [h.Class('look-controls')],
          [
            sectionsView(picker, inputs.fresh, h),
            h.div(
              [
                h.Class('look-rows'),
                h.Key(picker.section),
                h.DataAttribute('section', picker.section),
              ],
              [
                ...Array.map(SECTION_PARTS[picker.section], part =>
                  lookRowView(picker, part, inputs, h),
                ),
                ...togglesView(
                  SECTION_TOGGLES[picker.section],
                  inputs.appearance,
                  h,
                ),
              ],
            ),
          ],
        ),
      ],
    ),
)
