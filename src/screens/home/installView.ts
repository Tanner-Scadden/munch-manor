import { Array, Function } from 'effect'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import {
  ADD_TO_HOME_SCREEN_ICON,
  HOME_SCREEN_APP_ICON,
  INSTALL_ICON,
  SHARE_ICON,
} from '../../art/icons'
import { InstallMessage } from '../../platform/message'
import { closeButtonView } from '../../ui/cornerButtons'
import type { DialogParts } from '../../ui/dialog'
import { isInstallTileShown } from './home'

// TILE

const tileLabel = (model: Model): string =>
  model.release.installOffer === 'Ready'
    ? 'Install Munch Manor'
    : 'Add to Home Screen: show me how'

// NOTE: a phone with an arrow dropping onto it, beside the gear. It pulses
// until its first tap. Chrome shows its own install prompt; an iPhone gets
// the picture guide.
export const installTileView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isInstallTileShown(model)
      ? h.button
          .attr('type', 'button')
          .id('home-install')
          .class('home-corner-button home-install')
          .attr('data-tip', model.homeScreenTip)
          .attr('aria-label', tileLabel(model))
          .attr(
            'aria-haspopup',
            model.release.installOffer === 'Ready' ? undefined : 'dialog',
          )
          .on('click', InstallMessage.ClickedInstallButton())
          .children(
            h.span
              .class('home-corner-icon home-install-icon')
              .attr('aria-hidden', 'true')
              .style(pixelArtStyle(INSTALL_ICON)),
          )
      : null,
)

// GUIDE

type Step = Readonly<{ icon: string; word: string }>

const STEPS: ReadonlyArray<Step> = [
  { icon: SHARE_ICON, word: 'Share' },
  { icon: ADD_TO_HOME_SCREEN_ICON, word: 'Add' },
  { icon: HOME_SCREEN_APP_ICON, word: 'Play!' },
]

// NOTE: on newer iPhones Share hides behind the ••• by the address bar, so
// the first step wears a little ••• bubble.
const stepView = (
  { icon, word }: Step,
  index: number,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.li
    .class('install-step')
    .style({ '--step': `${index}` })
    .children(
      h.span
        .class('install-step-number')
        .attr('aria-hidden', 'true')
        .children(`${index + 1}`),
      h.span
        .class('install-step-face')
        .attr('aria-hidden', 'true')
        .children(
          h.span.class('install-step-icon').style(pixelArtStyle(icon)),
          ...(index === 0
            ? [h.span.class('install-step-more').children('•••')]
            : []),
        ),
      h.span
        .class('install-step-word')
        .attr('aria-hidden', 'true')
        .children(word),
    )

const guidePanelView = (
  parts: DialogParts,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => [
  parts.title(h.h2).class('panel-title').children('Home Screen'),
  parts
    .description(h.p)
    .class('sr-only')
    .children(
      'Tap Share (behind ••• by the address bar on newer iPhones), choose Add to Home Screen, then play Munch Manor full screen from your Home Screen.',
    ),
  h.ol
    .class('install-steps')
    .attr('aria-hidden', 'true')
    .children(Array.map(STEPS, (step, index) => stepView(step, index, h))),
  closeButtonView(
    {
      button: parts.initialFocus(parts.close(h.button)),
      className: 'panel-close',
      label: 'Close',
    },
    h,
  ),
]

// NOTE: the iPhone picture guide's insides, for the root's Dialog
// (src/app/dialogs.ts).
export const homeScreenGuideInsidesView: {
  (
    h: ApplicationViewBuilder,
  ): (parts: DialogParts) => ReadonlyArray<ApplicationHtml>
  (
    parts: DialogParts,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(2, guidePanelView)
