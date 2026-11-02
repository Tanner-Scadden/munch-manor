import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { ShopGuideSection } from './clientSchema'
import type { ApplicationViewBuilder } from './composition'
import { backButtonView } from './dialogs'
import { Message, type Message as MessageType } from './message'
import { SHOP_GUIDE_NAME } from './names'
import { type ShopArt } from './shopArt'
import {
  type GuideBar,
  type GuideChip,
  type GuideEntry,
  type LadderStep,
  SECTION_ORDER,
  SHOP_GUIDE_BACK_ID,
  SHOP_GUIDE_OPEN_ID,
  STAT_NAMES,
  entriesOf,
  isEntryKnown,
  sectionName,
} from './shopGuide'
import { guideArtOf, sectionArtOf } from './shopGuideArt'
import { BAR_SEGMENTS } from './shopStats'

// NOTE: the shop guide's view, shared by the Munchopedia's Shop page and the
// ? in Rattles' shop. Chunky bars, the item's art, one short line, and its
// upgrade ladder as icons. A fridge prize not pulled yet is a dark ??? card.

const UNKNOWN_NAME = '???'
const UNKNOWN_LINE = 'Pull the fridge to find out.'

// PICTURES

const artView = (
  art: ShopArt,
  className: string,
  h: ApplicationViewBuilder,
): Html =>
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

const segmentView = (bar: GuideBar, index: number, h: ApplicationViewBuilder) =>
  h.span([
    h.Class(
      index < bar.now
        ? 'sg-seg is-on'
        : index < bar.best
          ? 'sg-seg is-next'
          : 'sg-seg',
    ),
  ])

const barView = (bar: GuideBar, h: ApplicationViewBuilder): Html =>
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
  h: ApplicationViewBuilder,
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

const stepView = (step: LadderStep, h: ApplicationViewBuilder): Html =>
  h.li(
    [h.Class('sg-step')],
    [
      artView(guideArtOf(step.art), 'sg-step-art', h),
      h.span([h.Class('sg-step-price')], [priceTag(step.price)]),
    ],
  )

const ladderView = (
  ladder: ReadonlyArray<LadderStep>,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> =>
  Array.isReadonlyArrayNonEmpty(ladder)
    ? [
        h.ol(
          [h.Class('sg-ladder'), h.AriaLabel('Upgrades')],
          Array.map(ladder, step => stepView(step, h)),
        ),
      ]
    : []

const chipView = (chip: GuideChip, h: ApplicationViewBuilder): Html =>
  h.li(
    [h.Class('sg-chip-item')],
    [artView(guideArtOf(chip.art), 'sg-chip-art', h), chip.label],
  )

const chipsView = (
  chips: ReadonlyArray<GuideChip>,
  h: ApplicationViewBuilder,
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
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.p([h.Class('sg-line')], [entry.line]),
  ...barsView(entry.bars, h),
  ...ladderView(entry.ladder, h),
  ...chipsView(entry.chips, h),
]

const entryView = (
  entry: GuideEntry,
  seenUnlocks: ReadonlyArray<string>,
  h: ApplicationViewBuilder,
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
  sectionMessage: (section: ShopGuideSection) => MessageType,
  h: ApplicationViewBuilder,
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
          h.OnClick(sectionMessage(section), { propagation: 'Stop' }),
        ],
        [
          artView(sectionArtOf(section), 'sg-section-art', h),
          h.span([h.Class('sg-section-name')], [sectionName(section)]),
        ],
      ),
    ],
  )

// NOTE: the whole guide: the section buttons over the chosen section's cards.
export const shopGuideView = (
  seenUnlocks: ReadonlyArray<string>,
  section: ShopGuideSection,
  sectionMessage: (section: ShopGuideSection) => MessageType,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('sg'), h.AriaLabel(`${SHOP_GUIDE_NAME} guide`)],
    [
      h.ul(
        [h.Class('sg-sections'), h.AriaLabel('Shop guide sections')],
        Array.map(SECTION_ORDER, other =>
          sectionButtonView(other, section, sectionMessage, h),
        ),
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

// IN RATTLES' SHOP

// NOTE: the ? beside the shop's close button opens the guide on the tab the
// player was looking at. A real button, so Tab and Enter reach it.
export const shopHelpButtonView = (h: ApplicationViewBuilder): Html =>
  h.button(
    [
      h.Type('button'),
      h.Id(SHOP_GUIDE_OPEN_ID),
      h.Class('shop-help'),
      h.AriaLabel('Shop guide'),
      h.AriaKeyshortcuts('?'),
      h.OnClick(Message.ClickedShopGuideButton(), { propagation: 'Stop' }),
    ],
    ['?'],
  )

export const shopGuideDialogView = (
  seenUnlocks: ReadonlyArray<string>,
  section: ShopGuideSection,
  h: ApplicationViewBuilder,
): Html =>
  h.div(
    [h.Class('sg-shop')],
    [
      backButtonView(
        {
          attributes: [
            h.Id(SHOP_GUIDE_BACK_ID),
            h.OnClick(Message.ClickedShopGuideBackButton(), {
              propagation: 'Stop',
            }),
          ],
          className: 'sg-back',
          label: 'Back to the shop',
        },
        h,
      ),
      shopGuideView(
        seenUnlocks,
        section,
        next => Message.ClickedShopGuideSectionButton({ section: next }),
        h,
      ),
    ],
  )
