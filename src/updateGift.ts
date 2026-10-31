import { Array, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { UpdateGreetingBinding } from './bindings'
import { type NewsBullet, maybeNewestNewsDay, newsHeadline } from './changelog'
import type { ApplicationViewBuilder } from './composition'
import { closeButtonView, dialogShell } from './dialogs'
import { isUpdateGiftShown } from './home'
import {
  GIFT_BOX_ICON,
  GIFT_LID_ICON,
  GIFT_ZOMBIE_ICON,
  NEWS_ICON,
  SPARKLE_ICON,
} from './icons'
import { Message } from './message'
import type { Model } from './model'

// ART

const layerView = (
  className: string,
  icon: string,
  h: ApplicationViewBuilder,
): Html =>
  h.span([
    h.Class(className),
    h.AriaHidden(true),
    h.Style({ backgroundImage: icon }),
  ])

// NOTE: the Groaner hides in the box, under the lid, until the unwrap pops
// it out. Two sparkles twinkle around it while it waits.
const giftArtView = (h: ApplicationViewBuilder): Html =>
  h.span(
    [h.Class('gift-art'), h.AriaHidden(true)],
    [
      layerView('gift-sparkle', SPARKLE_ICON, h),
      layerView('gift-sparkle', SPARKLE_ICON, h),
      layerView('gift-zombie', GIFT_ZOMBIE_ICON, h),
      layerView('gift-box', GIFT_BOX_ICON, h),
      layerView('gift-lid', GIFT_LID_ICON, h),
    ],
  )

// GIFT

const UPDATE_GIFT_LABEL = 'Update ready: tap to get it'

// NOTE: a wrapped present under the gear on the home menu, with a little
// paper NEW! tag on a string tied to its bow. It rattles now and then, the tag
// swinging with it; a tap unwraps it and reloads onto the new build.
export const updateGiftView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  isUpdateGiftShown(model)
    ? h.button(
        [
          h.Type('button'),
          h.Id('home-gift'),
          h.Class('home-corner-button home-gift'),
          h.DataAttribute('state', model.updateGift),
          h.AriaLabel(UPDATE_GIFT_LABEL),
          h.AriaBusy(model.updateGift === 'Unwrapping'),
          h.OnClick(Message.ClickedUpdateButton(), { propagation: 'Stop' }),
        ],
        [
          giftArtView(h),
          h.span(
            [h.Class('gift-tag'), h.AriaHidden(true)],
            [h.span([h.Class('gift-tag-text')], ['NEW!'])],
          ),
        ],
      )
    : h.empty

// GREETING

const CONFETTI_PIECES = 14
const GREETING_BULLETS = 3

const confettiView = (h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('greeting-confetti'), h.AriaHidden(true)],
    Array.makeBy(CONFETTI_PIECES, index =>
      h.span([
        h.Class('greeting-confetti-piece'),
        h.Style({ '--piece': `${index}` }),
      ]),
    ),
  )

const openedGiftView = (h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('greeting-gift'), h.AriaHidden(true)],
    [
      layerView('greeting-gift-lid', GIFT_LID_ICON, h),
      layerView('greeting-gift-zombie', GIFT_ZOMBIE_ICON, h),
      layerView('greeting-gift-box', GIFT_BOX_ICON, h),
    ],
  )

const bulletView = (bullet: NewsBullet, h: ApplicationViewBuilder): Html =>
  h.li(
    [h.Class('greeting-bullet')],
    [
      h.span(
        [h.Class('greeting-bullet-emoji'), h.AriaHidden(true)],
        [bullet.emoji],
      ),
      h.span([h.Class('greeting-bullet-text')], [newsHeadline(bullet.text)]),
    ],
  )

const greetingBullets: ReadonlyArray<NewsBullet> = Option.match(
  maybeNewestNewsDay,
  {
    onNone: () => [],
    onSome: day => Array.take(day.bullets, GREETING_BULLETS),
  },
)

const greetingPanelView = (
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  confettiView(h),
  openedGiftView(h),
  h.h2([...title, h.Class('panel-title greeting-title')], ['Updated!']),
  h.p(
    [...description, h.Class('sr-only')],
    ['You are on the newest version of Munch Manor. Here is what is new.'],
  ),
  Array.match(greetingBullets, {
    onEmpty: () => h.empty,
    onNonEmpty: bullets =>
      h.ul(
        [h.Class('greeting-bullets')],
        Array.map(bullets, bullet => bulletView(bullet, h)),
      ),
  }),
  h.div(
    [h.Class('panel-actions')],
    [
      h.button(
        [
          ...initialFocus,
          h.Type('button'),
          h.Class('panel-button greeting-news'),
          h.OnClick(Message.ClickedUpdateGreetingNewsButton(), {
            propagation: 'Stop',
          }),
        ],
        [layerView('greeting-news-icon', NEWS_ICON, h), "WHAT'S NEW"],
      ),
    ],
  ),
  closeButtonView(
    { attributes: closeButton, className: 'panel-close', label: 'Close' },
    h,
  ),
]

export const updateGreetingView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  dialogShell(
    {
      dialog: model.updateGreeting,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel greeting-panel',
      dialogAttributes: [h.DataAttribute('panel', 'Updated')],
      panelView: renderInfo => greetingPanelView(renderInfo, h),
      binding: UpdateGreetingBinding,
    },
    h,
  )
