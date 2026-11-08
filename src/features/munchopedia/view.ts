import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import { backButtonView } from '../../app/dialogs'
import { SHOP_GUIDE_NAME } from '../../world/names'
import type { KillCounts, ZombieKind } from '../../world/schema/worldSchema'
import { isGuideOpen } from '../guide/model'
import { GUIDE_FOCUS_IDS } from '../guide/shopGuide'
import { SHOP_TILE_ART } from '../guide/shopGuideArt'
import { GuideBinding } from './bindings'
import type { ViewInputs } from './block'
import {
  MunchopediaComposition,
  type MunchopediaViewBuilder,
} from './composition'
import { Message } from './message'
import { type Model, MunchopediaPage } from './model'
import {
  BADGES,
  type EntryFrame,
  MUNCHOPEDIA,
  type MunchopediaEntry,
  countLabel,
  entryFrameAt,
  entryName,
  entryOf,
  firstEntryFrame,
  isDiscovered,
  killsOf,
} from './munchopedia'

// TEXT

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

// PICTURE

const PICTURE_PX = 64

const pictureScale = (frame: EntryFrame): number =>
  Math.max(1, Math.floor(PICTURE_PX / frame.height))

const pictureView = (
  maybeFrame: Option.Option<EntryFrame>,
  isKnown: boolean,
  altText: string,
  className: string,
  h: MunchopediaViewBuilder,
): Html =>
  Option.match(maybeFrame, {
    onNone: () => h.span([h.Class(className)]),
    onSome: frame =>
      h.img([
        h.Class(className),
        h.Src(frame.src),
        h.Alt(altText),
        h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
        h.Style({
          width: `${frame.width * pictureScale(frame)}px`,
          height: `${frame.height * pictureScale(frame)}px`,
        }),
      ]),
  })

const pictureAlt = (kind: ZombieKind, isKnown: boolean): string =>
  isKnown
    ? `${entryName(kind)} shuffling along and falling apart`
    : 'A dark silhouette of a zombie you have not met yet'

// LIST

const tileView = (
  inputs: ViewInputs,
  entry: MunchopediaEntry,
  h: MunchopediaViewBuilder,
): Html => {
  const count = killsOf(inputs.killsByKind, entry.kind)
  const isKnown = isDiscovered(inputs.killsByKind, entry.kind)
  const isNew = isKnown && !Array.contains(inputs.openedEntries, entry.kind)
  const name = isKnown ? entryName(entry.kind) : UNKNOWN_NAME
  return h.li(
    [h.Class('munch-tile-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('munch-tile'),
          h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
          h.AriaLabel(
            isKnown
              ? `${name}, ${countText(entry.kind, count)}${isNew ? ', new entry' : ''}`
              : 'Unknown zombie, not found yet',
          ),
          h.OnClick(Message.ClickedEntryButton({ kind: entry.kind }), {
            propagation: 'Stop',
          }),
        ],
        [
          h.span(
            [h.Class('munch-tile-picture'), h.AriaHidden(true)],
            [
              pictureView(
                firstEntryFrame(entry.kind),
                isKnown,
                '',
                'munch-sprite',
                h,
              ),
            ],
          ),
          h.span([h.Class('munch-tile-name')], [name]),
          ...(isKnown
            ? [h.span([h.Class('munch-tile-count')], [`×${countLabel(count)}`])]
            : []),
          ...(isNew
            ? [h.span([h.Class('munch-tile-new'), h.AriaHidden(true)], ['NEW'])]
            : []),
        ],
      ),
    ],
  )
}

// NOTE: the Shop tile beside the zombies opens the shop guide
// (src/features/guide/), which gives it focus back when it closes. It wears
// Rattles' face and is always known.
const shopTileView = (h: MunchopediaViewBuilder): Html =>
  h.li(
    [h.Class('munch-tile-item')],
    [
      h.button(
        [
          h.Type('button'),
          h.Id(GUIDE_FOCUS_IDS.Munchopedia.opener),
          h.Class('munch-tile munch-tile-shop'),
          h.DataAttribute('known', 'Known'),
          h.AriaLabel(`${SHOP_GUIDE_NAME}, what Rattles sells`),
          h.OnClick(Message.ClickedShopButton(), {
            propagation: 'Stop',
          }),
        ],
        [
          h.span(
            [h.Class('munch-tile-picture'), h.AriaHidden(true)],
            [
              h.span([
                h.Class('sg-art munch-shop-art'),
                h.Style({
                  backgroundImage: SHOP_TILE_ART.url,
                  '--art-w': `${SHOP_TILE_ART.width}`,
                  '--art-h': `${SHOP_TILE_ART.height}`,
                }),
              ]),
            ],
          ),
          h.span([h.Class('munch-tile-name')], [SHOP_GUIDE_NAME]),
        ],
      ),
    ],
  )

const listView = (inputs: ViewInputs, h: MunchopediaViewBuilder): Html =>
  h.ul(
    [h.Class('munch-list'), h.AriaLabel('Zombies')],
    [
      ...Array.map(MUNCHOPEDIA, entry => tileView(inputs, entry, h)),
      shopTileView(h),
    ],
  )

// ENTRY

const ENTRY_NAME_ID = 'munch-entry-name'

const badgeView = (count: number, h: MunchopediaViewBuilder) =>
  Array.map(BADGES, badge => {
    const isEarned = count >= badge.threshold
    return h.li(
      [
        h.Class('munch-badge'),
        h.DataAttribute('badge', badge.name),
        h.DataAttribute('earned', isEarned ? 'Earned' : 'Unearned'),
      ],
      [
        h.span([h.Class('munch-badge-count')], [countLabel(badge.threshold)]),
        h.span(
          [h.Class('sr-only')],
          [isEarned ? ` ${badge.name}, earned` : ` ${badge.name}, not yet`],
        ),
      ],
    )
  })

const knownEntryView = (
  killsByKind: KillCounts,
  entry: MunchopediaEntry,
  h: MunchopediaViewBuilder,
): ReadonlyArray<Html> => {
  const count = killsOf(killsByKind, entry.kind)
  return [
    h.p([h.Class('munch-bio')], [entry.bio]),
    h.h4([h.Class('munch-heading')], ['What it does']),
    h.p([h.Class('munch-text')], [entry.behavior]),
    h.h4([h.Class('munch-heading')], ['How to beat it']),
    h.p([h.Class('munch-text')], [entry.howToBeat]),
    h.div(
      [h.Class('munch-count-row')],
      [
        h.p([h.Class('munch-count')], [countText(entry.kind, count)]),
        h.ul(
          [h.Class('munch-badges'), h.AriaLabel('Badges')],
          badgeView(count, h),
        ),
      ],
    ),
  ]
}

const entryView = (
  inputs: ViewInputs,
  kind: ZombieKind,
  h: MunchopediaViewBuilder,
): Html => {
  const entry = entryOf(kind)
  const isKnown = isDiscovered(inputs.killsByKind, kind)
  return h.article(
    [
      h.Class('munch-entry'),
      h.DataAttribute('known', isKnown ? 'Known' : 'Unknown'),
      h.AriaLabelledBy(ENTRY_NAME_ID),
    ],
    [
      h.div(
        [h.Class('munch-stage')],
        [
          pictureView(
            isKnown
              ? entryFrameAt(kind, inputs.screenMs)
              : firstEntryFrame(kind),
            isKnown,
            pictureAlt(kind, isKnown),
            'munch-sprite',
            h,
          ),
        ],
      ),
      h.div(
        [h.Class('munch-facts')],
        [
          h.h3(
            [h.Id(ENTRY_NAME_ID), h.Class('munch-name')],
            [isKnown ? entryName(kind) : UNKNOWN_NAME],
          ),
          ...(isKnown
            ? knownEntryView(inputs.killsByKind, entry, h)
            : [h.p([h.Class('munch-bio')], [lockedHint(kind)])]),
        ],
      ),
    ],
  )
}

// BODY

const entryActionsView = (
  inputs: ViewInputs,
  h: MunchopediaViewBuilder,
): Html =>
  h.div(
    [h.Class('panel-actions')],
    [
      backButtonView(
        {
          attributes: [
            h.OnClick(Message.ClickedListButton(), { propagation: 'Stop' }),
          ],
          className: 'munch-back',
          label: 'Back to every zombie',
        },
        h,
      ),
      inputs.doneButton(),
    ],
  )

// NOTE: the shop guide stands over the zombies while it is open, with its
// own BACK and the panel's Done.
const guideView = (
  model: Model,
  inputs: ViewInputs,
  h: MunchopediaViewBuilder,
): Html =>
  h.block(
    GuideBinding.embedView({
      slotId: 'munch-guide',
      model: model.guide,
      viewInputs: {
        seenUnlocks: inputs.seenUnlocks,
        trailingActions: () => [inputs.doneButton()],
      },
    }),
  )

const pageView = (
  model: Model,
  inputs: ViewInputs,
  h: MunchopediaViewBuilder,
): ReadonlyArray<Html> =>
  isGuideOpen(model.guide)
    ? [guideView(model, inputs, h)]
    : MunchopediaPage.match(model.page, {
        List: () => [
          listView(inputs, h),
          h.div([h.Class('panel-actions')], [inputs.doneButton()]),
        ],
        Entry: ({ kind }) => [
          entryView(inputs, kind, h),
          entryActionsView(inputs, h),
        ],
      })

// NOTE: the panel's body under the title the root's menu panel draws. Its
// box takes no room of its own, so the panel lays out the page and its
// actions row as its own children.
const view = MunchopediaComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) =>
    h.div([h.Class('munch-body')], pageView(model, inputs, h)),
)

// NOTE: the Munchopedia's view, gathered here so it is not exported alone:
// a view is a function of three arguments with no pipeable form, and
// Foldkit knows a view by its identity. src/features/munchopedia/layer.ts
// completes it.
export const munchopediaImplementation = { view }
