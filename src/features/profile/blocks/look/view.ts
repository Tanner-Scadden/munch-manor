import { Array, Function, Match, Option, String } from 'effect'

import type { View } from '@effect/ui'
import { RadioGroup } from '@effect/ui-kit'
import type { Html } from '@effect/ui/html'

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
} from '#art/appearance.ts'
import { pixelArtStyle } from '#art/icons/artSize.ts'
import { DICE_ICON, pixelIconUrl } from '#art/icons/icons.ts'
import { type Facing, frameAt, group, standaloneSource } from '#art/sprite.ts'
import { gunPictureOf, gunSprite } from '#art/sprites/guns.ts'
import {
  type Standing,
  canAfford,
  priceOf,
  standingOf,
} from '#domain/closet.ts'
import { type LookPart, chooseLook } from '#domain/looks.ts'
import { lookUnlockId } from '#domain/unlocks.ts'
import { GUN_HOLD_PX } from '#render/bodies/playerView.ts'
import * as Draw from '#render/draw.ts'
import { type Leaf, flatten } from '#render/iso/flatten.ts'
import {
  PLAYER_FOOT_OFFSET,
  PLAYER_WALK_FRAME_MS,
  SHADOW_COLOR,
} from '#shared/constants.ts'
import {
  type Appearance,
  type Calling,
  type CosmeticKind,
  GunSkin,
  Hat,
  type Print,
} from '#shared/records/playerData.ts'
import { newBadgeView } from '#ui/menuParts.ts'
import { startingGunKind } from '#world/heroes/calling.ts'
import { rankOf, totalPointsOf } from '#world/heroes/rank.ts'
import { HAT_NAMES, hatNameOf } from '#world/names.ts'

import { buyPillView, cueAttrs, gearNote, gearTagView } from './lookGearView.ts'
import { LookSection, type LookToggle } from './lookSchema.ts'
import { Message } from './message.ts'
import {
  type CharacterProps,
  type Model,
  SECTION_PARTS,
  SECTION_TOGGLES,
  flipLook,
  gearOf,
  isToggleOn,
} from './model.ts'

type H = Html.H<Message>
type Content = View.Content<Message>
type MaybeContent = Content | null

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
const FLAG_HEIGHT = 18

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
  String.toLowerCase(
    Array.join(
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
        ...(appearance.gunSkin === 'Stock'
          ? []
          : [`${appearance.gunSkin} gun`]),
      ],
      ', ',
    ),
  )

const ICON_CACHE_LIMIT = 400
const HEAD_ROWS = { from: 1, to: 9 }

const iconCache = new Map<string, string>()

const partIconOf = (worn: Appearance, crop: 'Figure' | 'Head'): string => {
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

const PREVIEW_SIZE = 20
const PREVIEW_FOOT_Y = 18
const PREVIEW_TURN_MS = 2400

const previewFacing = (screenMs: number): Facing =>
  Math.floor(screenMs / PREVIEW_TURN_MS) % 2 === 0 ? 'Right' : 'Left'

const previewShapes = (
  appearance: Appearance,
  calling: Calling,
  screenMs: number,
): ReadonlyArray<Draw.Shape> => {
  const facing = previewFacing(screenMs)
  const direction = facing === 'Right' ? 1 : -1
  const centerX = PREVIEW_SIZE / 2
  return [
    Draw.Rect({
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

type Box = Readonly<{ x: number; y: number; width: number; height: number }>

const placed = ({ matrix, alpha }: Leaf, box: Box) => ({
  width: `${box.width}px`,
  height: `${box.height}px`,
  opacity: `${alpha}`,
  transform: `matrix(${matrix.a}, ${matrix.b}, ${matrix.c}, ${matrix.d}, ${
    matrix.a * box.x + matrix.c * box.y + matrix.e
  }, ${matrix.b * box.x + matrix.d * box.y + matrix.f})`,
})

const leafView = (leaf: Leaf, h: H): MaybeContent =>
  Match.value(leaf.shape).pipe(
    Match.tag('Image', image =>
      h.span.class('look-preview-leaf').style({
        ...placed(leaf, image),
        backgroundImage: `url("${standaloneSource(image)}")`,
      }),
    ),
    Match.tag('Rect', rect =>
      h.span.class('look-preview-leaf').style({
        ...placed(leaf, rect),
        backgroundColor: rect.fill ?? 'transparent',
      }),
    ),
    Match.orElse((): MaybeContent => null),
  )

const previewView = (
  appearance: Appearance,
  calling: Calling,
  screenMs: number,
  h: H,
): Content =>
  h.div
    .class('look-preview')
    .attrs({
      role: 'img',
      'aria-label': `Preview: ${lookDescription(appearance)}`,
    })
    .children(
      h.span
        .class('look-preview-art')
        .attr('aria-hidden', 'true')
        .children(
          Array.map(
            flatten(previewShapes(appearance, calling, screenMs)),
            leaf => leafView(leaf, h),
          ),
        ),
    )

const shownLookOf = (props: CharacterProps): Appearance =>
  Option.match(props.maybePreview, {
    onNone: () => props.appearance,
    onSome: ({ part, value }) => chooseLook(props.appearance, part, value),
  })

const buyPillOf = (props: CharacterProps, h: H): MaybeContent =>
  Option.match(props.maybePreview, {
    onNone: (): MaybeContent => null,
    onSome: ({ part, value }) =>
      Option.match(
        Option.flatMap(gearOf(part), ({ kind }) =>
          Option.map(priceOf(kind, value), price => ({ kind, price })),
        ),
        {
          onNone: (): MaybeContent => null,
          onSome: ({ kind, price }) =>
            buyPillView(
              {
                price,
                isShort: !canAfford(props.rank, kind, value),
                onClick: Message.ClickedBuyButton({ part, value }),
              },
              h,
            ),
        },
      ),
  })

const stageView = (props: CharacterProps, h: H): Content =>
  h.div
    .key(`look-stage-${props.fxCount % 2}`)
    .class('look-stage')
    .attr('data-fx', props.fx)
    .children(
      h.span.class('look-spotlight').attr('aria-hidden', 'true'),
      h.span.class('look-floor').attr('aria-hidden', 'true'),
      h.div
        .class('look-bounce')
        .children(
          previewView(shownLookOf(props), props.calling, props.screenMs, h),
        ),
      buyPillOf(props, h),
      h.span.class('look-poof').attr('aria-hidden', 'true'),
      h.button
        .attrs({ type: 'button', 'aria-label': 'Roll a random look' })
        .class('profile-dice look-dice')
        .on('click', Message.ClickedDiceButton())
        .children(
          h.span
            .class('profile-dice-icon')
            .attr('aria-hidden', 'true')
            .style(pixelArtStyle(DICE_ICON)),
        ),
    )

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

const hasNewLook = (
  section: LookSection,
  fresh: ReadonlyArray<string>,
): boolean =>
  Array.some(SECTION_PARTS[section], part =>
    Option.exists(gearOf(part), ({ kind }) =>
      Array.some(fresh, id =>
        String.startsWith(`${String.toLowerCase(kind)}:`)(id),
      ),
    ),
  )

const SECTION_ITEMS = Array.map(LookSection.literals, value => ({ value }))

const sectionsView = (
  section: LookSection,
  fresh: ReadonlyArray<string>,
  h: H,
): Content =>
  RadioGroup(h, {
    key: 'look-sections',
    props: { value: section, items: SECTION_ITEMS },
    onEmit: { Picked: ({ value }) => Message.PickedSection({ value }) },
    view: radioGroup =>
      radioGroup
        .root(h.div.class('look-sections').attr('aria-label', 'Parts'))
        .children(
          Array.map(LookSection.literals, value =>
            radioGroup
              .radio({
                element: h.button
                  .key(value)
                  .class('look-section')
                  .attrs({
                    'data-section': value,
                    'data-new': hasNewLook(value, fresh) ? 'true' : undefined,
                  }),
                value,
              })
              .children(
                h.span
                  .class('look-section-icon')
                  .attr('aria-hidden', 'true')
                  .style(pixelArtStyle(SECTION_LOOKS[value].icon)),
                h.span
                  .class('look-section-word')
                  .children(SECTION_LOOKS[value].word),
              ),
          ),
        ),
  })

const MOST_COLUMNS = 7
const MOST_NARROW_COLUMNS = 6

const balancedColumns = (count: number, most: number): number => {
  const lines = Math.ceil(count / most)
  return Math.ceil(count / Math.max(1, lines))
}

const optionFace = (
  part: LookPart,
  value: string,
  appearance: Appearance,
  h: H,
): Content => {
  const partView = PART_VIEWS[part]
  if (partView.look === 'Hat') {
    return h.span
      .class('look-hat-icon')
      .attr('aria-hidden', 'true')
      .style(pixelArtStyle(hatIconOf(chooseLook(appearance, part, value))))
  }
  if (partView.look === 'Gun') {
    return h.span
      .class('look-gun-icon')
      .attr('aria-hidden', 'true')
      .style(pixelArtStyle(partView.swatch(value, appearance)))
  }
  if (partView.look === 'Figure' || partView.look === 'Head') {
    return h.span
      .class(partView.look === 'Figure' ? 'look-figure-icon' : 'look-head-icon')
      .attr('aria-hidden', 'true')
      .style(
        pixelArtStyle(
          partIconOf(chooseLook(appearance, part, value), partView.look),
        ),
      )
  }
  return h.span
    .class(partView.look === 'Flag' ? 'look-swatch look-flag' : 'look-swatch')
    .attr('aria-hidden', 'true')
    .style(
      partView.look === 'Flag'
        ? { backgroundImage: partView.swatch(value, appearance) }
        : { background: partView.swatch(value, appearance) },
    )
}

type GearOption = Readonly<{
  kind: CosmeticKind
  standing: Standing
  isNew: boolean
}>

const noteIdOf = (part: LookPart, value: string): string =>
  `look-note-${part}-${value}`

type RadioParts = Parameters<
  NonNullable<Parameters<typeof RadioGroup>[1]['view']>
>[0]

const optionView = (
  radioGroup: RadioParts,
  part: LookPart,
  value: string,
  props: CharacterProps,
  maybeGear: Option.Option<GearOption>,
  h: H,
): Content => {
  const partView = PART_VIEWS[part]
  const face = optionFace(part, value, props.appearance, h)
  const element = h.button
    .key(value)
    .class(`look-option look-${String.toLowerCase(partView.look)}-option`)
  return Option.match(maybeGear, {
    onNone: () =>
      radioGroup
        .radio({ element, value })
        .children(face, h.span.class('sr-only').children(value)),
    onSome: ({ kind, standing, isNew }) => {
      const isCued = props.cue.part === part && props.cue.value === value
      const isPreviewed = Option.exists(
        props.maybePreview,
        preview => preview.part === part && preview.value === value,
      )
      return radioGroup
        .radio({
          element: element
            .attrs({
              'data-standing': standing,
              'data-look-option': `${part}.${value}`,
              'data-previewed': isPreviewed ? 'true' : undefined,
              'data-new': isNew ? 'true' : undefined,
              'aria-describedby': noteIdOf(part, value),
              ...(isCued ? cueAttrs(props.cue) : {}),
            })
            .on('click', Message.ClickedGearOption({ part, value })),
          value,
        })
        .children(
          face,
          Option.getOrNull(gearTagView(kind, value, standing, h)),
          isNew && newBadgeView(h),
          h.span
            .class('sr-only')
            .children(part === 'Hat' ? hatNameOf(value) : value),
          h.span
            .id(noteIdOf(part, value))
            .class('sr-only')
            .children(gearNote(kind, value, standing, isNew)),
        )
    },
  })
}

const lookRowView = (part: LookPart, props: CharacterProps, h: H): Content => {
  const { appearance } = props
  const partView = PART_VIEWS[part]
  const selected = partView.selected(appearance)
  const maybeKind = Option.map(gearOf(part), ({ kind }) => kind)
  const rankNumber = rankOf(totalPointsOf(props.rank))
  const gearOption = (value: string): Option.Option<GearOption> =>
    Option.map(maybeKind, kind => ({
      kind,
      standing: standingOf(kind, value, selected, props.bought, rankNumber),
      isNew: Array.contains(props.fresh, lookUnlockId(kind, value)),
    }))
  return h.div
    .class('look-row')
    .key(part)
    .children(
      h.div
        .class('look-row-heading')
        .attr('aria-hidden', 'true')
        .children(
          h.span.class('look-row-label').children(partView.label),
          h.span
            .class('look-row-value')
            .children(part === 'Hat' ? hatNameOf(selected) : selected),
        ),
      RadioGroup(h, {
        key: `look-${part}`,
        props: {
          value: selected,
          items: Array.map(partView.options, value => ({ value })),
          readOnly: Option.isSome(maybeKind),
        },
        onEmit: {
          Picked: ({ value }) => Message.PickedPart({ part, value }),
        },
        view: radioGroup =>
          radioGroup
            .root(
              h.div
                .class('look-options')
                .attr('aria-label', partView.ariaLabel)
                .style({
                  '--look-columns': `${balancedColumns(partView.options.length, MOST_COLUMNS)}`,
                  '--look-narrow-columns': `${balancedColumns(partView.options.length, MOST_NARROW_COLUMNS)}`,
                }),
            )
            .children(
              Array.map(partView.options, value =>
                optionView(
                  radioGroup,
                  part,
                  value,
                  props,
                  gearOption(value),
                  h,
                ),
              ),
            ),
      }),
    )
}

const TOGGLE_LABELS: Readonly<Record<LookToggle, string>> = {
  Beard: 'Beard',
  Glasses: 'Glasses',
}

const toggleView = (
  toggle: LookToggle,
  appearance: Appearance,
  h: H,
): Content => {
  const isOn = isToggleOn(appearance, toggle)
  const shown = isOn ? appearance : flipLook(appearance, toggle)
  return h.button
    .key(toggle)
    .attrs({
      type: 'button',
      'aria-pressed': isOn ? 'true' : 'false',
      'aria-label': TOGGLE_LABELS[toggle],
    })
    .class('look-option look-head-option look-toggle')
    .on('click', Message.ClickedToggle({ toggle }))
    .children(
      h.span
        .class('look-head-icon')
        .attr('aria-hidden', 'true')
        .style(pixelArtStyle(partIconOf(shown, 'Head'))),
    )
}

const togglesView = (
  toggles: ReadonlyArray<LookToggle>,
  appearance: Appearance,
  h: H,
): MaybeContent =>
  Array.match(toggles, {
    onEmpty: (): MaybeContent => null,
    onNonEmpty: shown =>
      h.div
        .class('look-row')
        .key('toggles')
        .children(
          h.div
            .class('look-row-heading')
            .attr('aria-hidden', 'true')
            .children(h.span.class('look-row-label').children('Face')),
          h.div
            .class('look-options look-toggles')
            .children(
              Array.map(shown, toggle => toggleView(toggle, appearance, h)),
            ),
        ),
  })

export const lookTabView: {
  (props: CharacterProps, h: H): (model: Model) => Content
  (model: Model, props: CharacterProps, h: H): Content
} = Function.dual(3, (model: Model, props: CharacterProps, h: H): Content =>
  h.div.class('look-tab').children(
    stageView(props, h),
    h.div.class('look-controls').children(
      sectionsView(model.section, props.fresh, h),
      h.div
        .class('look-rows')
        .key(model.section)
        .attr('data-section', model.section)
        .children(
          Array.map(SECTION_PARTS[model.section], part =>
            lookRowView(part, props, h),
          ),
          togglesView(SECTION_TOGGLES[model.section], props.appearance, h),
        ),
    ),
  ),
)
