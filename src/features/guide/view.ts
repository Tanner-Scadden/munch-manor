import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { backButtonView } from '../../app/dialogs'
import type { ShopGuideSection } from '../../shared/nameKeys'
import { SHOP_GUIDE_NAME } from '../../world/names'
import type { ShopArt } from '../shop/shopArt'
import { BAR_SEGMENTS } from '../shop/shopStats'
import type { ViewInputs } from './block'
import { GuideComposition, type GuideViewBuilder } from './composition'
import { Message } from './message'
import { type GuidePlacement, GuideStatus, type Model } from './model'
import {
  GUIDE_FOCUS_IDS,
  type GuideBar,
  type GuideChip,
  type GuideEntry,
  type LadderStep,
  SECTION_ORDER,
  STAT_NAMES,
  entriesOf,
  isEntryKnown,
  sectionName,
} from './shopGuide'
import { guideArtOf, sectionArtOf } from './shopGuideArt'

// NOTE: the guide's view, the same in Rattles' shop and on the Munchopedia's
// Shop page. Chunky bars, the item's art, one short line, and its upgrade
// ladder as icons. A fridge prize not pulled yet is a dark ??? card.

const UNKNOWN_NAME = '???'
const UNKNOWN_LINE = 'Pull the fridge to find out.'

// PICTURES

const artView = (art: ShopArt, className: string, h: GuideViewBuilder): Html =>
  h.span([
    h.Class(`sg-art ${className}`),
    h.AriaHidden(true),
    h.Style({
      backgroundImage: art.url,
      '--art-w': `${art.width}`,
      '--art-h': `${art.height}`,
    }),
  ])

// BARS

const barLabel = (bar: GuideBar): string =>
  `${STAT_NAMES[bar.stat]} ${bar.now} of ${BAR_SEGMENTS}${
    bar.best > bar.now ? `, ${bar.best} fully upgraded` : ''
  }`

const segmentView = (bar: GuideBar, index: number, h: GuideViewBuilder) =>
  h.span([
    h.Class(
      index < bar.now
        ? 'sg-seg is-on'
        : index < bar.best
          ? 'sg-seg is-next'
          : 'sg-seg',
    ),
  ])

const barView = (bar: GuideBar, h: GuideViewBuilder): Html =>
  h.li(
    [
      h.Class('sg-bar'),
      h.DataAttribute('stat', bar.stat),
      h.DataAttribute('now', `${bar.now}`),
      h.DataAttribute('best', `${bar.best}`),
      h.Role('img'),
      h.AriaLabel(barLabel(bar)),
    ],
    [
      h.span(
        [h.Class('sg-bar-name'), h.AriaHidden(true)],
        [STAT_NAMES[bar.stat]],
      ),
      h.span(
        [h.Class('sg-bar-segs'), h.AriaHidden(true)],
        Array.makeBy(BAR_SEGMENTS, index => segmentView(bar, index, h)),
      ),
    ],
  )

const barsView = (
  bars: ReadonlyArray<GuideBar>,
  h: GuideViewBuilder,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(bars)
    ? [
        h.ul(
          [h.Class('sg-bars')],
          Array.map(bars, bar => barView(bar, h)),
        ),
      ]
    : []

// LADDER AND CHIPS

const priceTag = (price: number): string => `$${price}`

const stepView = (step: LadderStep, h: GuideViewBuilder): Html =>
  h.li(
    [h.Class('sg-step')],
    [
      artView(guideArtOf(step.art), 'sg-step-art', h),
      h.span([h.Class('sg-step-price')], [priceTag(step.price)]),
    ],
  )

const ladderView = (
  ladder: ReadonlyArray<LadderStep>,
  h: GuideViewBuilder,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(ladder)
    ? [
        h.ol(
          [h.Class('sg-ladder'), h.AriaLabel('Upgrades')],
          Array.map(ladder, step => stepView(step, h)),
        ),
      ]
    : []

const chipView = (chip: GuideChip, h: GuideViewBuilder): Html =>
  h.li(
    [h.Class('sg-chip-item')],
    [artView(guideArtOf(chip.art), 'sg-chip-art', h), chip.label],
  )

const chipsView = (
  chips: ReadonlyArray<GuideChip>,
  h: GuideViewBuilder,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(chips)
    ? [
        h.ul(
          [h.Class('sg-chips')],
          Array.map(chips, chip => chipView(chip, h)),
        ),
      ]
    : []

// ENTRIES

const knownFacts = (
  entry: GuideEntry,
  h: GuideViewBuilder,
): ReadonlyArray<Html> => [
  h.p([h.Class('sg-line')], [entry.line]),
  ...barsView(entry.bars, h),
  ...ladderView(entry.ladder, h),
  ...chipsView(entry.chips, h),
]

const entryView = (
  entry: GuideEntry,
  seenUnlocks: ReadonlyArray<string>,
  h: GuideViewBuilder,
): Html => {
  const isKnown = isEntryKnown(seenUnlocks, entry)
  return h.li(
    [
      h.Class('sg-entry'),
      h.DataAttribute('entry', entry.id),
      h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
    ],
    [
      h.span(
        [h.Class('sg-picture')],
        isKnown
          ? [artView(guideArtOf(entry.art), 'sg-picture-art', h)]
          : [h.span([h.Class('sg-mystery'), h.AriaHidden(true)], ['?'])],
      ),
      h.div(
        [h.Class('sg-facts')],
        [
          h.h4(
            [h.Class('sg-name')],
            [
              h.span([], [isKnown ? entry.name : UNKNOWN_NAME]),
              ...(isKnown
                ? Option.match(entry.price, {
                    onNone: () => [],
                    onSome: price => [
                      h.span([h.Class('sg-price')], [priceTag(price)]),
                    ],
                  })
                : []),
            ],
          ),
          ...(isKnown
            ? knownFacts(entry, h)
            : [h.p([h.Class('sg-line')], [UNKNOWN_LINE])]),
        ],
      ),
    ],
  )
}

// SECTIONS

const sectionButtonView = (
  section: ShopGuideSection,
  chosen: ShopGuideSection,
  h: GuideViewBuilder,
): Html =>
  h.li(
    [h.Class('sg-section-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('sg-section'),
          h.DataAttribute('section', section),
          h.AriaPressed(section === chosen ? 'true' : 'false'),
          h.OnClick(Message.ClickedSectionButton({ section }), {
            propagation: 'Stop',
          }),
        ],
        [
          artView(sectionArtOf(section), 'sg-section-art', h),
          h.span([h.Class('sg-section-name')], [sectionName(section)]),
        ],
      ),
    ],
  )

// NOTE: the whole guide: the section buttons over the chosen section's cards.
const sectionsView = (
  seenUnlocks: ReadonlyArray<string>,
  section: ShopGuideSection,
  h: GuideViewBuilder,
): Html =>
  h.div(
    [h.Class('sg'), h.AriaLabel(`${SHOP_GUIDE_NAME} guide`)],
    [
      h.ul(
        [h.Class('sg-sections'), h.AriaLabel('Shop guide sections')],
        Array.map(SECTION_ORDER, other => sectionButtonView(other, section, h)),
      ),
      h.ul(
        [
          h.Class('sg-entries'),
          h.DataAttribute('section', section),
          h.AriaLabel(sectionName(section)),
        ],
        Array.map(entriesOf(section), entry =>
          entryView(entry, seenUnlocks, h),
        ),
      ),
    ],
  )

// WHERE IT STANDS

const BACK_LABELS: Readonly<Record<GuidePlacement, string>> = {
  Shop: 'Back to the shop',
  Munchopedia: 'Back to the Munchopedia',
}

const backView = (placement: GuidePlacement, h: GuideViewBuilder): Html =>
  backButtonView(
    {
      attributes: [
        h.Id(GUIDE_FOCUS_IDS[placement].back),
        h.OnClick(Message.ClickedBackButton(), { propagation: 'Stop' }),
      ],
      className: placement === 'Shop' ? 'sg-back' : 'munch-back',
      label: BACK_LABELS[placement],
    },
    h,
  )

// NOTE: in the shop dialog's body, BACK over the guide. On the Munchopedia's
// panel, the guide over the panel's actions row: BACK, then the panel's own
// Done. Its box takes no room of its own, so the panel lays them out as the
// rest of its pages.
const openView = (
  model: Model,
  section: ShopGuideSection,
  inputs: ViewInputs,
  h: GuideViewBuilder,
): Html =>
  model.placement === 'Shop'
    ? h.div(
        [h.Class('sg-shop')],
        [
          backView(model.placement, h),
          sectionsView(inputs.seenUnlocks, section, h),
        ],
      )
    : h.div(
        [h.Class('sg-panel')],
        [
          sectionsView(inputs.seenUnlocks, section, h),
          h.div(
            [h.Class('panel-actions')],
            [backView(model.placement, h), ...inputs.trailingActions()],
          ),
        ],
      )

const view = GuideComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) =>
    GuideStatus.match(model.status, {
      Closed: () => h.empty,
      Open: ({ section }) => openView(model, section, inputs, h),
    }),
)

// NOTE: the guide's view, gathered here so it is not exported alone: a
// view is a function of three arguments with no pipeable form, and Foldkit
// knows a view by its identity. src/features/guide/layer.ts completes it.
export const guideImplementation = { view }
