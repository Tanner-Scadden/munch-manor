import { Array } from 'effect'
import type { Html } from 'foldkit/html'

import type { Dialog } from '@foldkit/ui'

import { HomeScreenStepsBinding } from './bindings'
import type { ApplicationViewBuilder } from './composition'
import { closeButtonView, dialogShell } from './dialogs'
import { isInstallTileShown } from './home'
import {
  ADD_TO_HOME_SCREEN_ICON,
  HOME_SCREEN_APP_ICON,
  INSTALL_ICON,
  SHARE_ICON,
} from './icons'
import { Message } from './message'
import type { Model } from './model'

// TILE

const tileLabel = (model: Model): string =>
  model.installOffer === 'Ready'
    ? 'Install Munch Manor'
    : 'Add to Home Screen: show me how'

// NOTE: a phone with an arrow dropping onto it, beside the gear. It pulses
// until its first tap. Chrome shows its own install prompt; an iPhone gets
// the picture guide.
export const installTileView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  isInstallTileShown(model)
    ? h.button(
        [
          h.Type('button'),
          h.Id('home-install'),
          h.Class('home-corner-button home-install'),
          h.DataAttribute('tip', model.homeScreenTip),
          h.AriaLabel(tileLabel(model)),
          ...(model.installOffer === 'Ready' ? [] : [h.AriaHasPopup('dialog')]),
          h.OnClick(Message.ClickedInstallButton(), { propagation: 'Stop' }),
        ],
        [
          h.span([
            h.Class('home-corner-icon home-install-icon'),
            h.AriaHidden(true),
            h.Style({ backgroundImage: INSTALL_ICON }),
          ]),
        ],
      )
    : h.empty

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
): Html =>
  h.li(
    [h.Class('install-step'), h.Style({ '--step': `${index}` })],
    [
      h.span(
        [h.Class('install-step-number'), h.AriaHidden(true)],
        [`${index + 1}`],
      ),
      h.span(
        [h.Class('install-step-face'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('install-step-icon'),
            h.Style({ backgroundImage: icon }),
          ]),
          ...(index === 0
            ? [h.span([h.Class('install-step-more')], ['•••'])]
            : []),
        ],
      ),
      h.span([h.Class('install-step-word'), h.AriaHidden(true)], [word]),
    ],
  )

const guidePanelView = (
  { title, description, closeButton, initialFocus }: Dialog.RenderInfo,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.h2([...title, h.Class('panel-title')], ['Home Screen']),
  h.p(
    [...description, h.Class('sr-only')],
    [
      'Tap Share (behind ••• by the address bar on newer iPhones), choose Add to Home Screen, then play Munch Manor full screen from your Home Screen.',
    ],
  ),
  h.ol(
    [h.Class('install-steps'), h.AriaHidden(true)],
    Array.map(STEPS, (step, index) => stepView(step, index, h)),
  ),
  closeButtonView(
    {
      attributes: [...closeButton, ...initialFocus],
      className: 'panel-close',
      label: 'Close',
    },
    h,
  ),
]

export const homeScreenGuideView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  dialogShell(
    {
      dialog: model.homeScreenSteps,
      dialogClass: 'panel-dialog',
      backdropClass: 'panel-backdrop',
      panelClass: 'panel install-guide',
      dialogAttributes: [h.DataAttribute('panel', 'HomeScreen')],
      panelView: renderInfo => guidePanelView(renderInfo, h),
      binding: HomeScreenStepsBinding,
    },
    h,
  )
