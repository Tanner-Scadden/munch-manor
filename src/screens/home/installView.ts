import { Array, Function } from 'effect'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import type { Model } from '#app/model.ts'
import { pixelArtStyle } from '#art/icons/artSize.ts'
import {
  ADD_TO_HOME_SCREEN_ICON,
  HOME_SCREEN_APP_ICON,
  INSTALL_ICON,
  SHARE_ICON,
} from '#art/icons/icons.ts'
import { InstallMessage } from '#platform/message.ts'
import { closeButtonView } from '#ui/cornerButtons.ts'
import type { DialogParts } from '#ui/dialog.ts'

import { isInstallTileShown } from './home.ts'

const tileLabel = (model: Model): string =>
  model.release.installOffer === 'Ready'
    ? 'Install Munch Manor'
    : 'Add to Home Screen: show me how'

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

type Step = Readonly<{ icon: string; word: string }>

const STEPS: ReadonlyArray<Step> = [
  { icon: SHARE_ICON, word: 'Share' },
  { icon: ADD_TO_HOME_SCREEN_ICON, word: 'Add' },
  { icon: HOME_SCREEN_APP_ICON, word: 'Play!' },
]

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

export const homeScreenGuideInsidesView: {
  (
    h: ApplicationViewBuilder,
  ): (parts: DialogParts) => ReadonlyArray<ApplicationHtml>
  (
    parts: DialogParts,
    h: ApplicationViewBuilder,
  ): ReadonlyArray<ApplicationHtml>
} = Function.dual(2, guidePanelView)
