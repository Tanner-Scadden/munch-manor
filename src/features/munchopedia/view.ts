import { Array, Option } from 'effect'

import type { View } from '@effect/ui'
import type { Html } from '@effect/ui/html'

import { SHOP_TILE_ART } from '../../art/shopArt'
import { plinthElement } from '../../render/iso/plinthElement'
import { backButtonView } from '../../ui/cornerButtons'
import { SHOP_GUIDE_NAME } from '../../world/names'
import type { ZombieKind } from '../../world/schema/entitySchema'
import type { KillCounts } from '../../world/schema/worldSchema'
import { Guide } from '../guide/block'
import { GUIDE_FOCUS_IDS, isGuideOpen } from '../guide/model'
import { journalPageViews } from './journalView'
import { Message } from './message'
import { type Model, MunchopediaPage, type MunchopediaProps } from './model'
import {
  BADGES,
  type EntryFrame,
  MUNCHOPEDIA,
  type MunchopediaEntry,
  countLabel,
  entryName,
  entryOf,
  firstEntryFrame,
  isDiscovered,
  killsOf,
  plinthImageAt,
} from './munchopedia'

type H = Html.H<Message>
type Content = View.Content<Message>

const UNKNOWN_NAME = '???'

const isBoss = (kind: ZombieKind): boolean => kind === 'Boss'

const countText = (kind: ZombieKind, count: number): string =>
  isBoss(kind)
    ? `Beaten ${countLabel(count)} ${count === 1 ? 'time' : 'times'}`
    : `${countLabel(count)} splatted`

const lockedHint = (kind: ZombieKind): string =>
  isBoss(kind)
    ? 'Beat the boss at the end of the campaign to fill in this page.'
    : 'Splat one to fill in this page.'

const PICTURE_PX = 64

const pictureScale = (frame: EntryFrame): number =>
  Math.max(1, Math.floor(PICTURE_PX / frame.height))

const pictureView = (
  maybeFrame: Option.Option<EntryFrame>,
  isKnown: boolean,
  altText: string,
  className: string,
  h: H,
): Content =>
  Option.match(maybeFrame, {
    onNone: (): Content => h.span.class(className),
    onSome: (frame): Content =>
      h.img
        .class(className)
        .attrs({
          src: frame.src,
          alt: altText,
          'data-known': isKnown ? 'Known' : 'Unknown',
        })
        .style({
          '--art-w': `${frame.width}`,
          '--art-h': `${frame.height}`,
          '--art-scale': `${pictureScale(frame)}`,
        }),
  })

const pictureAlt = (kind: ZombieKind, isKnown: boolean): string =>
  isKnown
    ? `${entryName(kind)} shuffling along and falling apart`
    : 'A dark silhouette of a zombie you have not met yet'

const plinthView = (props: MunchopediaProps, kind: ZombieKind, h: H): Content =>
  h.div.class('munch-stage munch-stage-plinth').children(
    Option.match(plinthImageAt(kind, props.screenMs), {
      onNone: () => null,
      onSome: image =>
        plinthElement(h)
          .key(`plinth-${kind}`)
          .class('munch-plinth')
          .attrs({ role: 'img', 'aria-label': pictureAlt(kind, true) })
          .pose({
            image,
            clockMs: props.screenMs,
            light: isBoss(kind) ? 'Villain' : 'Candle',
          }),
    }),
  )

const tileView = (
  props: MunchopediaProps,
  entry: MunchopediaEntry,
  h: H,
): Content => {
  const count = killsOf(props.killsByKind, entry.kind)
  const isKnown = isDiscovered(props.killsByKind, entry.kind)
  const isNew = isKnown && !Array.contains(props.openedEntries, entry.kind)
  const name = isKnown ? entryName(entry.kind) : UNKNOWN_NAME
  return h.li.class('munch-tile-item').children(
    h.button
      .class('munch-tile')
      .attrs({
        type: 'button',
        'data-known': isKnown ? 'Known' : 'Unknown',
        'aria-label': isKnown
          ? `${name}, ${countText(entry.kind, count)}${isNew ? ', new entry' : ''}`
          : 'Unknown zombie, not found yet',
      })
      .on('click', Message.ClickedEntryButton({ kind: entry.kind }))
      .children(
        h.span
          .class('munch-tile-picture')
          .attr('aria-hidden', 'true')
          .children(
            pictureView(
              firstEntryFrame(entry.kind),
              isKnown,
              '',
              'munch-sprite',
              h,
            ),
          ),
        h.span.class('munch-tile-name').children(name),
        isKnown &&
          h.span.class('munch-tile-count').children(`×${countLabel(count)}`),
        isNew &&
          h.span
            .class('munch-tile-new')
            .attr('aria-hidden', 'true')
            .children('NEW'),
      ),
  )
}

const shopTileView = (h: H): Content =>
  h.li.class('munch-tile-item').children(
    h.button
      .id(GUIDE_FOCUS_IDS.opener)
      .class('munch-tile munch-tile-shop')
      .attrs({
        type: 'button',
        'data-known': 'Known',
        'aria-label': `${SHOP_GUIDE_NAME}, what the house holds`,
      })
      .on('click', Message.ClickedShopButton())
      .children(
        h.span
          .class('munch-tile-picture')
          .attr('aria-hidden', 'true')
          .children(
            h.span.class('sg-art munch-shop-art').style({
              backgroundImage: SHOP_TILE_ART.url,
              '--art-w': `${SHOP_TILE_ART.width}`,
              '--art-h': `${SHOP_TILE_ART.height}`,
            }),
          ),
        h.span.class('munch-tile-name').children(SHOP_GUIDE_NAME),
      ),
  )

const listView = (props: MunchopediaProps, h: H): Content =>
  h.ul
    .class('munch-list')
    .attr('aria-label', 'Zombies')
    .children(
      Array.map(MUNCHOPEDIA, entry => tileView(props, entry, h)),
      shopTileView(h),
    )

const ENTRY_NAME_ID = 'munch-entry-name'

const badgeView = (count: number, h: H): ReadonlyArray<Content> =>
  Array.map(BADGES, badge => {
    const isEarned = count >= badge.threshold
    return h.li
      .class('munch-badge')
      .attrs({
        'data-badge': badge.name,
        'data-earned': isEarned ? 'Earned' : 'Unearned',
      })
      .children(
        h.span.class('munch-badge-count').children(countLabel(badge.threshold)),
        h.span
          .class('sr-only')
          .children(
            isEarned ? ` ${badge.name}, earned` : ` ${badge.name}, not yet`,
          ),
      )
  })

const knownEntryView = (
  killsByKind: KillCounts,
  entry: MunchopediaEntry,
  h: H,
): ReadonlyArray<Content> => {
  const count = killsOf(killsByKind, entry.kind)
  return [
    h.p.class('munch-bio').children(entry.bio),
    h.h4.class('munch-heading').children('What it does'),
    h.p.class('munch-text').children(entry.behavior),
    h.h4.class('munch-heading').children('How to beat it'),
    h.p.class('munch-text').children(entry.howToBeat),
    h.div
      .class('munch-count-row')
      .children(
        h.p.class('munch-count').children(countText(entry.kind, count)),
        h.ul
          .class('munch-badges')
          .attr('aria-label', 'Badges')
          .children(badgeView(count, h)),
      ),
  ]
}

const entryView = (
  props: MunchopediaProps,
  kind: ZombieKind,
  h: H,
): Content => {
  const entry = entryOf(kind)
  const isKnown = isDiscovered(props.killsByKind, kind)
  return h.article
    .class('munch-entry')
    .attrs({
      'data-known': isKnown ? 'Known' : 'Unknown',
      'aria-labelledby': ENTRY_NAME_ID,
    })
    .children(
      isKnown
        ? plinthView(props, kind, h)
        : h.div
            .class('munch-stage')
            .children(
              pictureView(
                firstEntryFrame(kind),
                false,
                pictureAlt(kind, false),
                'munch-sprite',
                h,
              ),
            ),
      h.div.class('munch-facts').children(
        h.h3
          .id(ENTRY_NAME_ID)
          .class('munch-name')
          .children(isKnown ? entryName(kind) : UNKNOWN_NAME),
        isKnown
          ? knownEntryView(props.killsByKind, entry, h)
          : h.p.class('munch-bio').children(lockedHint(kind)),
      ),
    )
}

const entryActionsView = (done: View.Outlet, h: H): Content =>
  h.div.class('panel-actions').children(
    backButtonView(
      {
        button: h.button.on('click', Message.ClickedListButton()),
        className: 'munch-back',
        label: 'Back to every zombie',
      },
      h,
    ),
    done,
  )

const doneRowView = (done: View.Outlet, h: H): Content =>
  h.div.class('panel-actions').children(done)

const pagesView = (
  props: MunchopediaProps,
  done: View.Outlet,
  h: H,
): ReadonlyArray<Content> => [
  journalPageViews.tabs(props, h),
  ...MunchopediaPage.match(props.page, {
    List: () => [listView(props, h), doneRowView(done, h)],
    Entry: ({ kind }) => [entryView(props, kind, h), entryActionsView(done, h)],
    Things: () => [journalPageViews.things(props, h), doneRowView(done, h)],
    Rooms: () => [journalPageViews.rooms(props, h), doneRowView(done, h)],
    Story: ({ page }) => [
      journalPageViews.story(props, page, h),
      doneRowView(done, h),
    ],
    Heroes: () => [journalPageViews.heroes(props, h), doneRowView(done, h)],
  }),
]

export const munchopediaView = ({
  h,
  model,
  props,
  done,
}: Readonly<{
  h: H
  model: Model
  props: MunchopediaProps
  done: View.Outlet
}>): Content =>
  h.div.class('munch-body').children(
    isGuideOpen(model.guide)
      ? Guide(h, {
          status: model.guide,
          seenUnlocks: props.seenUnlocks,
          onSection: section => Message.ClickedGuideSectionButton({ section }),
          onBack: Message.ClickedGuideBackButton(),
          actions: done,
        })
      : pagesView(props, done, h),
  )
