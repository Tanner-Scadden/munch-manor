import { Array } from 'effect'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from './composition'
import { isOpen as isCoopOpen } from './coop/update'
import { sharePathOf, sharedRunOf } from './endBeat'
import {
  END_MENU_BUTTON_ID,
  END_RETRY_BUTTON_ID,
  END_SHARE_BUTTON_ID,
  endOffer,
} from './home'
import { pauseMenuButtonView } from './homeView'
import {
  ENDLESS_ICON,
  FULLSCREEN_ICON,
  GIFT_BOX_ICON,
  GIFT_LID_ICON,
  HOME_ICON,
  MUSIC_OFF_ICON,
  MUSIC_ON_ICON,
  PAUSE_ICON,
  RETRY_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
  X_LOGO_ICON,
} from './icons'
import { isProfileOpen } from './menuState'
import { Message } from './message'
import { DebutCard, type Model, Phase, RunMode, type ZombieKind } from './model'
import { canSkipDebutCard } from './onboarding'
import { runDifficultyOf } from './onlineRun'
import { shareUrl } from './share'
import { iconButtonView } from './touchControls'
import { FINAL_WAVE } from './wavePlans'
import { ZOMBIE_KINDS } from './zombies'

// TEXT

export const toSentenceCase = (shouted: string): string =>
  shouted
    .toLowerCase()
    .replace(
      /(^|[.!?]\s+)([a-z])/g,
      (_match, lead: string, letter: string) => lead + letter.toUpperCase(),
    )

export const debutPitch = (kind: ZombieKind): string =>
  toSentenceCase(ZOMBIE_KINDS[kind].pitch)

// CORNER BUTTONS

const muteButtonView = (model: Model, h: ApplicationViewBuilder): Html => {
  const isMuted = model.soundSetting === 'Muted'
  return iconButtonView(
    {
      className: 'corner-button mute-button',
      label: 'Mute sound',
      icon: isMuted ? SOUND_OFF_ICON : SOUND_ON_ICON,
      keys: 'M',
      message: Message.ClickedMuteButton(),
      maybePressed: isMuted,
    },
    h,
  )
}

const musicButtonView = (model: Model, h: ApplicationViewBuilder): Html => {
  const isOn = model.musicSetting === 'On'
  return iconButtonView(
    {
      className: 'corner-button music-button',
      label: 'Music',
      icon: isOn ? MUSIC_ON_ICON : MUSIC_OFF_ICON,
      keys: 'N',
      message: Message.ClickedMusicButton(),
      maybePressed: isOn,
    },
    h,
  )
}

const pauseButtonView = (h: ApplicationViewBuilder): Html =>
  iconButtonView(
    {
      className: 'corner-button pause-button',
      label: 'Pause',
      icon: PAUSE_ICON,
      keys: 'Escape',
      message: Message.ClickedPauseButton(),
    },
    h,
  )

const fullscreenButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  model.screenFit === 'Fullscreen'
    ? iconButtonView(
        {
          className: 'corner-button fullscreen-button',
          label: 'Full screen',
          icon: FULLSCREEN_ICON,
          message: Message.ClickedFullscreenButton(),
          maybePressed: model.fullscreen === 'On',
        },
        h,
      )
    : h.empty

const cornerButtons = (
  model: Model,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => {
  const audioButtons = [musicButtonView(model, h), muteButtonView(model, h)]
  // NOTE: a co-op room has no pause (decided 7); its LEAVE takes the
  // corner instead (src/coop/view.ts).
  const pause = isCoopOpen(model.coop) ? [] : [pauseButtonView(h)]
  return Phase.match(model.phase, {
    Ready: () => [],
    Preparation: () => pause,
    Wave: () => pause,
    Paused: () => [
      pauseMenuButtonView(model, h),
      fullscreenButtonView(model, h),
      ...audioButtons,
    ],
    Victory: () => audioButtons,
    GameOver: () => audioButtons,
  })
}

export const cornerButtonsView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html =>
  isProfileOpen(model)
    ? h.empty
    : h.div([h.Class('corner-buttons')], cornerButtons(model, h))

// END BUTTONS

// NOTE: a newer build waits on the menu, so the end screens offer only MENU,
// and it carries a little gift that bobs on its corner, the same one the
// menu shows.
const updateGiftBadgeView = (h: ApplicationViewBuilder): Html =>
  h.span([
    h.Class('mode-button-gift'),
    h.AriaHidden(true),
    h.Style({ backgroundImage: `${GIFT_LID_ICON}, ${GIFT_BOX_ICON}` }),
  ])

const menuOnlyView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [h.Class('mode-choice is-update-waiting')],
    [
      h.button(
        [
          h.Type('button'),
          h.Id(END_MENU_BUTTON_ID),
          h.Class('mode-button menu-button is-primary'),
          h.AriaLabel('Menu: back home, where a new version is waiting'),
          h.AriaKeyshortcuts('Enter H'),
          h.OnClick(Message.ClickedMenuButton(), {
            focusSelector: '.game-surface',
            propagation: 'Stop',
          }),
        ],
        [
          h.span([h.Class('mode-button-label')], ['MENU']),
          h.span([h.Class('mode-button-detail')], ['BACK HOME']),
          updateGiftBadgeView(h),
          ...(model.lastDevice === 'KeyboardMouse'
            ? [
                h.span(
                  [h.Class('mode-button-key'), h.AriaHidden(true)],
                  ['ENTER'],
                ),
              ]
            : []),
        ],
      ),
    ],
  )

// NOTE: the end card's buttons, icon first: HOME, then the big RETRY (on
// Victory AGAIN, with KEEP GOING beside it), then SHARE to X. Each pops in
// a beat after the one before it.
type EndButton = Readonly<{
  id: string
  look: 'Home' | 'Retry' | 'KeepGoing' | 'Share'
  icon: string
  label: string
  key: string
  keyName: string
  ariaLabel: string
  message: Message
}>

const HOME_BUTTON: EndButton = {
  id: END_MENU_BUTTON_ID,
  look: 'Home',
  icon: HOME_ICON,
  label: 'HOME',
  key: 'H',
  keyName: 'H',
  ariaLabel: 'Menu: back to the home screen',
  message: Message.ClickedMenuButton(),
}

const retryButton = (model: Model): EndButton => ({
  id: END_RETRY_BUTTON_ID,
  look: 'Retry',
  icon: RETRY_ICON,
  label: Phase.isAnyOf(['Victory'])(model.phase) ? 'AGAIN' : 'RETRY',
  key: 'ENTER',
  keyName: 'Enter',
  ariaLabel: RunMode.match(model.mode, {
    Campaign: () => `Retry: a new campaign of ${FINAL_WAVE} waves`,
    Endless: () => 'Retry: a new endless run',
  }),
  message: Message.ClickedRetryButton(),
})

const KEEP_GOING_BUTTON: EndButton = {
  id: 'end-keep-going-button',
  look: 'KeepGoing',
  icon: ENDLESS_ICON,
  label: 'KEEP GOING',
  key: 'K',
  keyName: 'K',
  ariaLabel: `Keep going: carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps`,
  message: Message.ClickedKeepGoingButton(),
}

const SHARE_BUTTON: EndButton = {
  id: END_SHARE_BUTTON_ID,
  look: 'Share',
  icon: X_LOGO_ICON,
  label: 'SHARE',
  key: 'X',
  keyName: 'X',
  ariaLabel: 'Share your run on X. Opens in a new tab',
  message: Message.ClickedShareButton(),
}

const END_BUTTON_STAGGER_MS = 70

const endButtonFace = (
  model: Model,
  button: EndButton,
  h: ApplicationViewBuilder,
): ReadonlyArray<Html> => [
  h.span([
    h.Class('end-button-icon'),
    h.AriaHidden(true),
    h.Style({ backgroundImage: button.icon }),
  ]),
  h.span([h.Class('end-button-label'), h.AriaHidden(true)], [button.label]),
  ...(model.lastDevice === 'KeyboardMouse'
    ? [h.span([h.Class('end-button-key'), h.AriaHidden(true)], [button.key])]
    : []),
]

// NOTE: X's post intent for this run, the room's difficulty in an online
// co-op run. The words are src/share.ts's.
export const shareHrefOf = (model: Model): string =>
  shareUrl(sharedRunOf(model, runDifficultyOf(model)))

// NOTE: on a keyboard, a mouse, or a phone without a share sheet, SHARE is
// a real link, so the browser opens X on the click itself and no popup
// blocker can stop it; its click still sends its Message, which counts the
// share and never prevents the link. On a touch screen with a share sheet it
// is a button, and its Message opens the sheet (src/update/end.ts).
const endButtonView =
  (model: Model, h: ApplicationViewBuilder) =>
  (button: EndButton, index: number): Html => {
    const shared = [
      h.Id(button.id),
      h.Class('end-button'),
      h.DataAttribute('look', button.look),
      h.Style({ animationDelay: `${index * END_BUTTON_STAGGER_MS}ms` }),
      h.AriaLabel(button.ariaLabel),
      h.AriaKeyshortcuts(button.keyName),
      h.OnClick(button.message, {
        focusSelector: '.game-surface',
        propagation: 'Stop',
      }),
    ]
    return button.look === 'Share' && sharePathOf(model) === 'Link'
      ? h.keyed('a')(
          button.id,
          [
            ...shared,
            h.Href(shareHrefOf(model)),
            h.Target('_blank'),
            h.Rel('noopener noreferrer'),
          ],
          endButtonFace(model, button, h),
        )
      : h.keyed('button')(
          button.id,
          [h.Type('button'), ...shared],
          endButtonFace(model, button, h),
        )
  }

// NOTE: in an online co-op run the room's lobby comes next, so the card
// offers only SHARE until the lobby takes over.
const endButtonsOf = (model: Model): ReadonlyArray<EndButton> => {
  if (isCoopOpen(model.coop)) {
    return [SHARE_BUTTON]
  } else if (Phase.isAnyOf(['Victory'])(model.phase)) {
    return [HOME_BUTTON, retryButton(model), KEEP_GOING_BUTTON, SHARE_BUTTON]
  } else {
    return [HOME_BUTTON, retryButton(model), SHARE_BUTTON]
  }
}

const endActionsView = (model: Model, h: ApplicationViewBuilder): Html =>
  h.div(
    [
      h.Class('mode-choice end-actions'),
      h.Role('group'),
      h.AriaLabel('What next'),
    ],
    Array.map(endButtonsOf(model), endButtonView(model, h)),
  )

export const modeChoiceView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html => {
  const offer = endOffer(model)
  if (offer === 'MenuOnly') {
    return menuOnlyView(model, h)
  } else if (offer === 'MenuAndModes') {
    return endActionsView(model, h)
  } else {
    return h.empty
  }
}

// DEBUT CARD

const DEBUT_TITLE_ID = 'debut-title'
const DEBUT_BODY_ID = 'debut-body'

const debutCardButtonView = (model: Model, h: ApplicationViewBuilder): Html =>
  canSkipDebutCard(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('debut-card-button'),
          h.DataAttribute('device', model.lastDevice),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(Message.ClickedDebutCardButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        model.lastDevice === 'Touch'
          ? ['TAP TO CONTINUE']
          : [
              'CONTINUE',
              h.kbd([h.Class('debut-card-key'), h.AriaHidden(true)], ['ENTER']),
            ],
      )
    : h.empty

export const debutCardView = (model: Model, h: ApplicationViewBuilder): Html =>
  !Phase.isAnyOf(['Wave'])(model.phase)
    ? h.empty
    : DebutCard.match(model.debutCard, {
        Hidden: () => h.empty,
        Showing: ({ kind }) =>
          h.div(
            [
              h.Class('debut-card'),
              h.Role('group'),
              h.AriaLabelledBy(DEBUT_TITLE_ID),
              h.AriaDescribedBy(DEBUT_BODY_ID),
            ],
            [
              h.h2(
                [h.Id(DEBUT_TITLE_ID), h.Class('sr-only')],
                [`New zombie: ${ZOMBIE_KINDS[kind].name}`],
              ),
              h.p(
                [h.Id(DEBUT_BODY_ID), h.Class('sr-only')],
                [debutPitch(kind)],
              ),
              debutCardButtonView(model, h),
            ],
          ),
      })
