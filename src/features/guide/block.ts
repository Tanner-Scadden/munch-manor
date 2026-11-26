import { Array, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { BAR_SEGMENTS, type ShopArt } from '../../art/shopArt'
import type { ShopGuideSection } from '../../shared/nameKeys'
import { backButtonView } from '../../ui/cornerButtons'
import { SHOP_GUIDE_NAME } from '../../world/names'
import { GUIDE_FOCUS_IDS, GuideStatus } from './model'
import {
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

// The guide to the house's finds, on the Munchopedia's Shop page: chunky
// bars, the item's art, one short line, and its upgrade ladder as icons. A
// fridge prize not pulled yet is a dark ??? card.
//
// NOTE: a view function, not a component: its one piece of state, shut or
// open on a section, is its parent's (`GuideStatus`), since the parent
// draws the guide in place of its own pages while it is open, and the
// parent's Done stands in the guide's actions row. Its buttons send the
// parent's Messages, handed in as `onSection` and `onBack`.

const UNKNOWN_NAME = '???'
const UNKNOWN_LINE = 'Pull the fridge to find out.'

// PICTURES

const artView = <M>(art: ShopArt, className: string, h: Html.H<M>) =>
  h.span
    .class(`sg-art ${className}`)
    .attr('aria-hidden', 'true')
    .style({
      backgroundImage: art.url,
      '--art-w': `${art.width}`,
      '--art-h': `${art.height}`,
    })

// BARS

const barLabel = (bar: GuideBar): string =>
  `${STAT_NAMES[bar.stat]} ${bar.now} of ${BAR_SEGMENTS}${
    bar.best > bar.now ? `, ${bar.best} at its top tier` : ''
  }`

const segmentView = <M>(bar: GuideBar, index: number, h: Html.H<M>) =>
  h.span.class(
    index < bar.now
      ? 'sg-seg is-on'
      : index < bar.best
        ? 'sg-seg is-next'
        : 'sg-seg',
  )

const barView = <M>(bar: GuideBar, h: Html.H<M>) =>
  h.li
    .class('sg-bar')
    .attrs({
      'data-stat': bar.stat,
      'data-now': `${bar.now}`,
      'data-best': `${bar.best}`,
      role: 'img',
      'aria-label': barLabel(bar),
    })
    .children(
      h.span
        .class('sg-bar-name')
        .attr('aria-hidden', 'true')
        .children(STAT_NAMES[bar.stat]),
      h.span
        .class('sg-bar-segs')
        .attr('aria-hidden', 'true')
        .children(
          Array.makeBy(BAR_SEGMENTS, index => segmentView(bar, index, h)),
        ),
    )

const barsView = <M>(bars: ReadonlyArray<GuideBar>, h: Html.H<M>) =>
  Array.isReadonlyArrayNonEmpty(bars) &&
  h.ul.class('sg-bars').children(Array.map(bars, bar => barView(bar, h)))

// LADDER AND CHIPS

// NOTE: a price is in skeleton keys (src/world/keys/keys.ts).
const priceTag = (price: number): string =>
  `${price} ${price === 1 ? 'key' : 'keys'}`

// NOTE: a tier is earned by kills with the gun, so a step shows the kills
// it takes.
const stepView = <M>(step: LadderStep, h: Html.H<M>) =>
  h.li
    .class('sg-step')
    .children(
      artView(guideArtOf(step.art), 'sg-step-art', h),
      h.span.class('sg-step-price').children(`${step.kills} kills`),
    )

const ladderView = <M>(ladder: ReadonlyArray<LadderStep>, h: Html.H<M>) =>
  Array.isReadonlyArrayNonEmpty(ladder) &&
  h.ol
    .class('sg-ladder')
    .attr('aria-label', 'Levels')
    .children(Array.map(ladder, step => stepView(step, h)))

const chipView = <M>(chip: GuideChip, h: Html.H<M>) =>
  h.li
    .class('sg-chip-item')
    .children(artView(guideArtOf(chip.art), 'sg-chip-art', h), chip.label)

const chipsView = <M>(chips: ReadonlyArray<GuideChip>, h: Html.H<M>) =>
  Array.isReadonlyArrayNonEmpty(chips) &&
  h.ul.class('sg-chips').children(Array.map(chips, chip => chipView(chip, h)))

// ENTRIES

const priceView = <M>(entry: GuideEntry, h: Html.H<M>) =>
  Option.match(entry.price, {
    onNone: () => null,
    onSome: price => h.span.class('sg-price').children(priceTag(price)),
  })

const entryView = <M>(
  entry: GuideEntry,
  seenUnlocks: ReadonlyArray<string>,
  h: Html.H<M>,
) => {
  const isKnown = isEntryKnown(seenUnlocks, entry)
  return h.li
    .class('sg-entry')
    .attrs({
      'data-entry': entry.id,
      'data-known': isKnown ? 'Known' : 'Unknown',
    })
    .children(
      h.span
        .class('sg-picture')
        .children(
          isKnown
            ? artView(guideArtOf(entry.art), 'sg-picture-art', h)
            : h.span
                .class('sg-mystery')
                .attr('aria-hidden', 'true')
                .children('?'),
        ),
      h.div
        .class('sg-facts')
        .children(
          h.h4
            .class('sg-name')
            .children(
              h.span.children(isKnown ? entry.name : UNKNOWN_NAME),
              isKnown && priceView(entry, h),
            ),
          isKnown
            ? h.p.class('sg-line').children(entry.line)
            : h.p.class('sg-line').children(UNKNOWN_LINE),
          isKnown && barsView(entry.bars, h),
          isKnown && ladderView(entry.ladder, h),
          isKnown && chipsView(entry.chips, h),
        ),
    )
}

// SECTIONS

const sectionButtonView = <M>(
  section: ShopGuideSection,
  chosen: ShopGuideSection,
  onSection: (section: ShopGuideSection) => M,
  h: Html.H<M>,
) =>
  h.li.class('sg-section-item').children(
    h.button
      .attrs({
        type: 'button',
        'data-section': section,
        'aria-pressed': section === chosen ? 'true' : 'false',
      })
      .class('sg-section')
      .on('click', onSection(section))
      .children(
        artView(sectionArtOf(section), 'sg-section-art', h),
        h.span.class('sg-section-name').children(sectionName(section)),
      ),
  )

// NOTE: the whole guide: the section buttons over the chosen section's cards.
const sectionsView = <M>(
  seenUnlocks: ReadonlyArray<string>,
  section: ShopGuideSection,
  onSection: (section: ShopGuideSection) => M,
  h: Html.H<M>,
) =>
  h.div
    .class('sg')
    .attr('aria-label', `${SHOP_GUIDE_NAME} guide`)
    .children(
      h.ul
        .class('sg-sections')
        .attr('aria-label', 'Shop guide sections')
        .children(
          Array.map(SECTION_ORDER, other =>
            sectionButtonView(other, section, onSection, h),
          ),
        ),
      h.ul
        .class('sg-entries')
        .attrs({ 'data-section': section, 'aria-label': sectionName(section) })
        .children(
          Array.map(entriesOf(section), entry =>
            entryView(entry, seenUnlocks, h),
          ),
        ),
    )

// THE GUIDE

export type GuideOptions<M, A extends View.Input<M>> = Readonly<{
  status: GuideStatus
  // NOTE: the unlocks seen: a fridge prize is ??? until it is pulled.
  seenUnlocks: ReadonlyArray<string>
  onSection: (section: ShopGuideSection) => M
  onBack: M
  // NOTE: what stands after BACK in the actions row: the panel's Done.
  actions: A
}>

// NOTE: the guide over the panel's actions row: BACK, then the parent's
// actions. Its box takes no room of its own, so the panel lays them out as
// the rest of its pages. Shut, it draws nothing. A view function takes the
// parent's `h` first, as a component call does (Effect UI's "Reusing view
// functions"), so it has no data-last form.
// @effect-diagnostics-next-line missingPipeableSignature:off
export const Guide = <M, A extends View.Input<M>>(
  h: Html.H<M>,
  options: GuideOptions<M, A>,
) =>
  GuideStatus.match(options.status, {
    Closed: () => null,
    Open: ({ section }) =>
      h.div.class('sg-panel').children(
        sectionsView(options.seenUnlocks, section, options.onSection, h),
        h.div.class('panel-actions').children(
          backButtonView(
            {
              button: h.button
                .id(GUIDE_FOCUS_IDS.back)
                .on('click', options.onBack),
              className: 'munch-back',
              label: 'Back to the journal',
            },
            h,
          ),
          options.actions,
        ),
      ),
  })
