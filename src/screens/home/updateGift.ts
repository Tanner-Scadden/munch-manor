import { Array, Function, Option } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import {
  GIFT_BOX_ICON,
  GIFT_LID_ICON,
  GIFT_ZOMBIE_ICON,
  NEWS_ICON,
  SPARKLE_ICON,
} from '../../art/icons'
import { UpdateGift } from '../../domain/clientSchema'
import {
  type NewsBullet,
  maybeNewestNewsDay,
  newsHeadline,
} from '../../features/whatsNew/changelog'
import { VersionMessage } from '../../platform/message'
import { closeButtonView } from '../../ui/cornerButtons'
import type { DialogParts } from '../../ui/dialog'
import { isUpdateGiftShown } from './home'

const layerView = (
  className: string,
  icon: string,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.span.class(className).attr('aria-hidden', 'true').style(pixelArtStyle(icon))

const giftArtView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('gift-art')
    .attr('aria-hidden', 'true')
    .children(
      layerView('gift-sparkle', SPARKLE_ICON, h),
      layerView('gift-sparkle', SPARKLE_ICON, h),
      layerView('gift-zombie', GIFT_ZOMBIE_ICON, h),
      layerView('gift-box', GIFT_BOX_ICON, h),
      layerView('gift-lid', GIFT_LID_ICON, h),
    )

const UPDATE_GIFT_LABEL = 'Update ready: tap to get it'

export const updateGiftView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isUpdateGiftShown(model)
      ? h.button
          .attr('type', 'button')
          .id('home-gift')
          .class('home-corner-button home-gift')
          .attr('data-state', model.release.updateGift._tag)
          .attr('aria-label', UPDATE_GIFT_LABEL)
          .attr(
            'aria-busy',
            String(UpdateGift.$is('Unwrapping')(model.release.updateGift)),
          )
          .on('click', VersionMessage.ClickedUpdateButton())
          .children(
            giftArtView(h),
            h.span
              .class('gift-tag')
              .attr('aria-hidden', 'true')
              .children(h.span.class('gift-tag-text').children('NEW!')),
          )
      : null,
)

const CONFETTI_PIECES = 14
const GREETING_BULLETS = 3

const confettiView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.div
    .class('greeting-confetti')
    .attr('aria-hidden', 'true')
    .children(
      Array.makeBy(CONFETTI_PIECES, index =>
        h.span
          .class('greeting-confetti-piece')
          .style({ '--piece': `${index}` }),
      ),
    )

const openedGiftView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.div
    .class('greeting-gift')
    .attr('aria-hidden', 'true')
    .children(
      layerView('greeting-gift-lid', GIFT_LID_ICON, h),
      layerView('greeting-gift-zombie', GIFT_ZOMBIE_ICON, h),
      layerView('greeting-gift-box', GIFT_BOX_ICON, h),
    )

const bulletView = (
  bullet: NewsBullet,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.li
    .class('greeting-bullet')
    .children(
      h.span
        .class('greeting-bullet-emoji')
        .attr('aria-hidden', 'true')
        .children(bullet.emoji),
      h.span.class('greeting-bullet-text').children(newsHeadline(bullet.text)),
    )

const greetingBullets: ReadonlyArray<NewsBullet> = Option.match(
  maybeNewestNewsDay,
  {
    onNone: () => [],
    onSome: day => Array.take(day.bullets, GREETING_BULLETS),
  },
)

const greetingPanelView = (
  parts: DialogParts,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml | null> => [
  confettiView(h),
  openedGiftView(h),
  parts.title(h.h2).class('panel-title greeting-title').children('Updated!'),
  parts
    .description(h.p)
    .class('sr-only')
    .children(
      'You are on the newest version of Munch Manor. Here is what is new.',
    ),
  Array.match(greetingBullets, {
    onEmpty: () => null,
    onNonEmpty: bullets =>
      h.ul
        .class('greeting-bullets')
        .children(Array.map(bullets, bullet => bulletView(bullet, h))),
  }),
  h.div.class('panel-actions').children(
    parts
      .initialFocus(h.button)
      .attr('type', 'button')
      .class('panel-button greeting-news')
      .on('click', VersionMessage.ClickedUpdateGreetingNewsButton())
      .children(layerView('greeting-news-icon', NEWS_ICON, h), "WHAT'S NEW"),
  ),
  closeButtonView(
    { button: parts.close(h.button), className: 'panel-close', label: 'Close' },
    h,
  ),
]

export const updateGreetingInsidesView: {
  (
    h: ApplicationViewBuilder,
  ): (parts: DialogParts) => ReadonlyArray<ApplicationHtml | null>
  (
    parts: DialogParts,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml | null>
} = Function.dual(2, greetingPanelView)
