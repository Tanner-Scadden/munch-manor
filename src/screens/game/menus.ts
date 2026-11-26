import { Array, Function, Option, Order, String, pipe } from 'effect'

import type { LobbyMember } from '@munch/netcode'

import type {
  ApplicationHtml,
  ApplicationMount,
  ApplicationViewBuilder,
} from '../../app/definition'
import type { Model } from '../../app/model'
import { pixelArtStyle } from '../../art/artSize'
import {
  CHECK_ICON,
  COOP_ICON,
  LEAVE_ICON,
  portraitOf,
} from '../../art/coopIcons'
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
  SHARE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
} from '../../art/icons'
import { callingOfMember, seatLookOf } from '../../art/seatLooks'
import { SoundMessage } from '../../audio/message'
import { type Room as CoopRoom, maybeRoomOf } from '../../domain/coopRoom'
import { runDifficultyOf } from '../../domain/onlineRun'
import { meIn, pickedModeOf } from '../../features/coop/roomState'
import { isOpen as isCoopOpen } from '../../features/coop/update'
import { shareUrlOf } from '../../features/end/beatRun'
import {
  isRunCardHeld,
  isShareCopied,
  sharedRunOf,
} from '../../features/end/endBeat'
import {
  END_LEAVE_ROOM_BUTTON_ID,
  END_LOBBY_BUTTON_ID,
  END_MENU_BUTTON_ID,
  END_RETRY_BUTTON_ID,
  END_SHARE_BUTTON_ID,
  endOffer,
} from '../../features/end/endOffer'
import { EndMessage } from '../../features/end/message'
import { shareText } from '../../features/end/share'
import { SHARE_TEXT_DATA, SHARE_URL_DATA } from '../../features/end/share'
import { HomeMessage } from '../../features/home/message'
import { OnboardingMessage } from '../../features/onboarding/message'
import { canSkipDebutCard } from '../../features/onboarding/onboarding'
import { RunButtonMessage } from '../../input/message'
import { DeviceMessage } from '../../platform/message'
import type { ZombieKind } from '../../world/schema/entitySchema'
import { DebutCard, Phase, RunMode } from '../../world/schema/worldSchema'
import { ZOMBIE_KINDS } from '../../world/zombies/zombies'
import { iconButtonView } from './touchControls'

// TEXT

// NOTE: the split keeps each sentence end with its spaces as its own part,
// so a part that starts with a letter starts a sentence.
const SENTENCE_END = /([.!?]\s+)/
const STARTS_LOWER = /^[a-z]/

export const toSentenceCase = (shouted: string): string =>
  pipe(
    String.toLowerCase(shouted),
    String.split(SENTENCE_END),
    Array.map(part =>
      STARTS_LOWER.test(part) ? String.capitalize(part) : part,
    ),
    Array.join(''),
  )

export const debutPitch = (kind: ZombieKind): string =>
  toSentenceCase(ZOMBIE_KINDS[kind].pitch)

// CORNER BUTTONS

const muteButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isMuted = model.settings.soundSetting === 'Muted'
  return iconButtonView(
    {
      className: 'corner-button mute-button',
      label: 'Mute sound',
      icon: isMuted ? SOUND_OFF_ICON : SOUND_ON_ICON,
      keys: 'M',
      message: SoundMessage.ClickedMuteButton(),
      maybePressed: isMuted,
    },
    h,
  )
}

const musicButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml => {
  const isOn = model.settings.musicSetting === 'On'
  return iconButtonView(
    {
      className: 'corner-button music-button',
      label: 'Music',
      icon: isOn ? MUSIC_ON_ICON : MUSIC_OFF_ICON,
      keys: 'N',
      message: SoundMessage.ClickedMusicButton(),
      maybePressed: isOn,
    },
    h,
  )
}

const pauseButtonView = (h: ApplicationViewBuilder): ApplicationHtml =>
  iconButtonView(
    {
      className: 'corner-button pause-button',
      label: 'Pause',
      icon: PAUSE_ICON,
      keys: 'Escape',
      message: RunButtonMessage.ClickedPauseButton(),
    },
    h,
  )

const fullscreenButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  model.settings.screenFit === 'Fullscreen'
    ? iconButtonView(
        {
          className: 'corner-button fullscreen-button',
          label: 'Full screen',
          icon: FULLSCREEN_ICON,
          message: DeviceMessage.ClickedFullscreenButton(),
          maybePressed: model.settings.fullscreen === 'On',
        },
        h,
      )
    : null

const cornerButtons = (
  model: Model,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml | null> => {
  const audioButtons = [musicButtonView(model, h), muteButtonView(model, h)]
  // NOTE: a co-op room has no pause (decided 7); its LEAVE takes the
  // corner instead (src/features/coop/view.ts).
  const pause = isCoopOpen(model.coop) ? [] : [pauseButtonView(h)]
  return Phase.match(model.phase, {
    Ready: () => [],
    Arriving: () => [],
    Preparation: () => pause,
    Wave: () => pause,
    Paused: () => [
      pauseMenuButtonView(model, h),
      fullscreenButtonView(model, h),
      ...audioButtons,
    ],
    Escaped: () => audioButtons,
    LeftEarly: () => audioButtons,
    GameOver: () => audioButtons,
  })
}

export const cornerButtonsView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml =>
    h.div.class('corner-buttons').children(cornerButtons(model, h)),
)

// PAUSE MENU BUTTON

const pauseMenuButtonView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    Phase.isAnyOf(['Paused'])(model.phase)
      ? h.button
          .attr('type', 'button')
          .class('pause-menu-button')
          .attr('aria-label', 'Menu: leave this run')
          .attr('aria-keyshortcuts', 'H')
          .attr('aria-haspopup', 'dialog')
          .on('click', HomeMessage.ClickedMenuButton())
          .children(
            'MENU',
            ...(model.lastDevice === 'KeyboardMouse'
              ? [
                  h.span
                    .class('home-button-key')
                    .attr('aria-hidden', 'true')
                    .children('H'),
                ]
              : []),
          )
      : null,
)

// END BUTTONS

// NOTE: a newer build waits on the menu, so the end screens offer only MENU,
// and it carries a little gift that bobs on its corner, the same one the
// menu shows.
const updateGiftBadgeView = (h: ApplicationViewBuilder): ApplicationHtml =>
  h.span
    .class('mode-button-gift')
    .attr('aria-hidden', 'true')
    .style({ backgroundImage: `${GIFT_LID_ICON}, ${GIFT_BOX_ICON}` })

const menuOnlyView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div.class('mode-choice is-update-waiting').children(
    h.button
      .attr('type', 'button')
      .id(END_MENU_BUTTON_ID)
      .class('mode-button menu-button is-primary')
      .attr('aria-label', 'Menu: back home, where a new version is waiting')
      .attr('aria-keyshortcuts', 'Enter H')
      .on('click', HomeMessage.ClickedMenuButton())
      .children(
        h.span.class('mode-button-label').children('MENU'),
        h.span.class('mode-button-detail').children('BACK HOME'),
        updateGiftBadgeView(h),
        ...(model.lastDevice === 'KeyboardMouse'
          ? [
              h.span
                .class('mode-button-key')
                .attr('aria-hidden', 'true')
                .children('ENTER'),
            ]
          : []),
      ),
  )

// NOTE: the end card's buttons, icon first and all one size: HOME, then
// RETRY (AGAIN after an escape), then SHARE. Nobody goes back in after an
// escape: Endless is its own mode. Each
// pops in a beat after the one before it. SHARE has no key: the share
// sheet and the clipboard want a tap or a click.
//
// NOTE: `heads` is PLAY AGAIN's crew, each lit once they are in.
type CrewHead = Readonly<{ slot: number; portrait: string; isIn: boolean }>

type EndButton = Readonly<{
  id: string
  look: 'Home' | 'Retry' | 'KeepGoing' | 'Share' | 'Lobby' | 'Leave'
  icon: string
  label: string
  maybeKey: Option.Option<Readonly<{ cap: string; name: string }>>
  ariaLabel: string
  message: HomeMessage | EndMessage
  maybePressed: Option.Option<boolean>
  heads: ReadonlyArray<CrewHead>
}>

const HOME_BUTTON: EndButton = {
  id: END_MENU_BUTTON_ID,
  look: 'Home',
  icon: HOME_ICON,
  label: 'HOME',
  maybeKey: Option.some({ cap: 'H', name: 'H' }),
  ariaLabel: 'Menu: back to the home screen',
  message: HomeMessage.ClickedMenuButton(),
  maybePressed: Option.none(),
  heads: [],
}

const retryButton = (model: Model): EndButton => ({
  id: END_RETRY_BUTTON_ID,
  look: 'Retry',
  icon: RETRY_ICON,
  label: Phase.isAnyOf(['Escaped'])(model.phase) ? 'AGAIN' : 'RETRY',
  maybeKey: Option.some({ cap: 'ENTER', name: 'Enter' }),
  ariaLabel: RunMode.match(model.mode, {
    Campaign: () => 'Retry: a new dare',
    Endless: () => 'Retry: a new endless run',
  }),
  message: EndMessage.ClickedRetryButton(),
  maybePressed: Option.none(),
  heads: [],
})

// NOTE: a post that went to the clipboard flashes COPIED! with a tick.
const shareButton = (model: Model): EndButton => {
  const isCopied = isShareCopied(model)
  return {
    id: END_SHARE_BUTTON_ID,
    look: 'Share',
    icon: isCopied ? CHECK_ICON : SHARE_ICON,
    label: isCopied ? 'COPIED!' : 'SHARE',
    maybeKey: Option.none(),
    ariaLabel: isCopied ? 'Share: copied' : 'Share your run',
    message: EndMessage.ClickedShareButton(),
    maybePressed: Option.none(),
    heads: [],
  }
}

const END_BUTTON_STAGGER_MS = 70

const endButtonFace = (
  model: Model,
  button: EndButton,
  h: ApplicationViewBuilder,
): ReadonlyArray<ApplicationHtml> => [
  h.span
    .class('end-button-icon')
    .attr('aria-hidden', 'true')
    .style(pixelArtStyle(button.icon)),
  h.span
    .class('end-button-label')
    .attr('aria-hidden', 'true')
    .children(button.label),
  ...(Array.isReadonlyArrayNonEmpty(button.heads)
    ? [
        h.span
          .class('end-button-heads')
          .attr('aria-hidden', 'true')
          .children(
            Array.map(button.heads, head =>
              h.span
                .key(`head-${head.slot}`)
                .class('end-button-head')
                .attr('data-in', head.isIn ? 'In' : 'Out')
                .style(pixelArtStyle(head.portrait)),
            ),
          ),
      ]
    : []),
  ...(model.lastDevice === 'KeyboardMouse'
    ? Option.match(button.maybeKey, {
        onNone: () => [],
        onSome: ({ cap }) => [
          h.span
            .class('end-button-key')
            .attr('aria-hidden', 'true')
            .children(cap),
        ],
      })
    : []),
]

// NOTE: this run's post, the room's difficulty in an online co-op run. The
// words are src/features/end/share.ts's.
export const shareTextOf = (model: Model): string =>
  shareText(sharedRunOf(model, runDifficultyOf(model)))

// NOTE: the root's ShareFromClick Mount (src/app/mount.ts), handed in by
// the root's view, since a screen imports nothing of `app/`.
type ShareMount = ApplicationMount

// NOTE: SHARE carries its post and the ShareFromClick Mount, which opens
// the share sheet (or copies the post) in the click itself; its click
// counts the share (src/app/update/end.ts).
const sharePostButton = (
  h: ApplicationViewBuilder,
  model: Model,
  shareMount: ShareMount,
) =>
  h.button
    .onMount(shareMount)
    .attr(`data-${SHARE_TEXT_DATA}`, shareTextOf(model))
    .attr(`data-${SHARE_URL_DATA}`, shareUrlOf(model))

const endButtonView =
  (model: Model, shareMount: ShareMount, h: ApplicationViewBuilder) =>
  (button: EndButton, index: number): ApplicationHtml =>
    (button.look === 'Share' ? sharePostButton(h, model, shareMount) : h.button)
      .key(button.id)
      .attr('type', 'button')
      .id(button.id)
      .class('end-button')
      .attr('data-look', button.look)
      .style({ animationDelay: `${index * END_BUTTON_STAGGER_MS}ms` })
      .attr('aria-label', button.ariaLabel)
      .attr(
        'aria-pressed',
        Option.getOrUndefined(
          Option.map(button.maybePressed, isPressed =>
            isPressed ? 'true' : 'false',
          ),
        ),
      )
      .attr(
        'aria-keyshortcuts',
        Option.getOrUndefined(Option.map(button.maybeKey, ({ name }) => name)),
      )
      .on('click', button.message)
      .children(endButtonFace(model, button, h))

// AN ONLINE ROOM'S CARD

const LEAVE_ROOM_BUTTON: EndButton = {
  id: END_LEAVE_ROOM_BUTTON_ID,
  look: 'Leave',
  icon: LEAVE_ICON,
  label: 'LEAVE',
  maybeKey: Option.some({ cap: 'H', name: 'H' }),
  ariaLabel: 'Leave the room',
  message: EndMessage.ClickedLeaveRoomButton(),
  maybePressed: Option.none(),
  heads: [],
}

const ROOM_LOBBY_BUTTON: EndButton = {
  id: END_LOBBY_BUTTON_ID,
  look: 'Lobby',
  icon: COOP_ICON,
  label: 'LOBBY',
  maybeKey: Option.some({ cap: 'L', name: 'L' }),
  ariaLabel: "Lobby: the room's seats and picks",
  message: EndMessage.ClickedRoomLobbyButton(),
  maybePressed: Option.none(),
  heads: [],
}

const crewHeadsOf = (model: Model, room: CoopRoom): ReadonlyArray<CrewHead> =>
  Option.match(room.maybeLobby, {
    onNone: () => [],
    onSome: lobby =>
      Array.map(
        Array.sort(
          lobby.members,
          Order.mapInput(Order.Number, (member: LobbyMember) => member.slot),
        ),
        member => ({
          slot: member.slot,
          portrait: portraitOf(
            seatLookOf(
              model.appearance,
              room.slot,
              member.slot,
              room.maybeLobby,
            ),
            callingOfMember(member),
          ),
          isIn: member.ready,
        }),
      ),
  })

// NOTE: PLAY AGAIN is this player's READY in the room's lobby, so the same
// crew plays the room's next pick (KEEP GOING after a win) once everyone is
// in. Its heads light as each player says yes.
const playAgainButton = (model: Model, room: CoopRoom): EndButton => {
  const heads = crewHeadsOf(model, room)
  const isKeepGoing = Option.exists(
    room.maybeLobby,
    lobby => pickedModeOf(lobby) === 'KeepGoing',
  )
  const inCount = Array.filter(heads, head => head.isIn).length
  return {
    id: END_RETRY_BUTTON_ID,
    look: isKeepGoing ? 'KeepGoing' : 'Retry',
    icon: isKeepGoing ? ENDLESS_ICON : RETRY_ICON,
    label: isKeepGoing ? 'KEEP GOING' : 'PLAY AGAIN',
    maybeKey: Option.some({ cap: 'ENTER', name: 'Enter' }),
    ariaLabel: `${isKeepGoing ? 'Keep going' : 'Play again'} with this crew: ${inCount} of ${heads.length} in`,
    message: EndMessage.ClickedPlayAgainButton(),
    maybePressed: Option.some(Option.exists(meIn(room), me => me.ready)),
    heads,
  }
}

// NOTE: in an online co-op run the room's lobby comes next, so the card
// offers the room's choices (src/app/update/end.ts): LEAVE, PLAY AGAIN, LOBBY,
// and SHARE.
const endButtonsOf = (model: Model): ReadonlyArray<EndButton> => {
  const maybeRoom = maybeRoomOf(model.coop)
  if (Option.isSome(maybeRoom)) {
    return [
      LEAVE_ROOM_BUTTON,
      playAgainButton(model, maybeRoom.value),
      ROOM_LOBBY_BUTTON,
      shareButton(model),
    ]
  } else {
    return [HOME_BUTTON, retryButton(model), shareButton(model)]
  }
}

const endActionsView = (
  model: Model,
  shareMount: ShareMount,
  h: ApplicationViewBuilder,
): ApplicationHtml =>
  h.div
    .class('mode-choice end-actions')
    .attr('role', 'group')
    .attr('aria-label', 'What next')
    .children(
      Array.map(endButtonsOf(model), endButtonView(model, shareMount, h)),
    )

// NOTE: `shareMount` makes the root's ShareFromClick Mount (src/app/mount.ts),
// which SHARE carries, only when SHARE is drawn.
export const modeChoiceView: {
  (
    shareMount: ShareMount,
    h: ApplicationViewBuilder,
  ): (model: Model) => ApplicationHtml
  (
    model: Model,
    shareMount: ShareMount,
    h: ApplicationViewBuilder,
  ): ApplicationHtml
} = Function.dual(
  3,
  (
    model: Model,
    shareMount: ShareMount,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null => {
    const offer = endOffer(model)
    if (offer === 'Nothing') {
      return null
    } else if (isCoopOpen(model.coop)) {
      // NOTE: an online room's card offers the room's choices, with or without
      // a newer build waiting, until LOBBY lets the lobby in.
      return isRunCardHeld(model) ? endActionsView(model, shareMount, h) : null
    } else if (offer === 'MenuOnly') {
      return menuOnlyView(model, h)
    } else {
      return endActionsView(model, shareMount, h)
    }
  },
)

// DEBUT CARD

const DEBUT_TITLE_ID = 'debut-title'
const DEBUT_BODY_ID = 'debut-body'

const debutCardButtonView = (
  model: Model,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  canSkipDebutCard(model)
    ? h.button
        .attr('type', 'button')
        .class('debut-card-button')
        .attr('data-device', model.lastDevice)
        .attr('aria-keyshortcuts', 'Enter')
        .on('click', OnboardingMessage.ClickedDebutCardButton())
        .children(
          model.lastDevice === 'Touch'
            ? ['TAP TO CONTINUE']
            : [
                'CONTINUE',
                h.kbd
                  .class('debut-card-key')
                  .attr('aria-hidden', 'true')
                  .children('ENTER'),
              ],
        )
    : null

export const debutCardView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    !Phase.isAnyOf(['Wave'])(model.phase)
      ? null
      : DebutCard.match(model.debutCard, {
          Hidden: () => null,
          Showing: ({ kind }) =>
            h.div
              .class('debut-card')
              .attr('role', 'group')
              .attr('aria-labelledby', DEBUT_TITLE_ID)
              .attr('aria-describedby', DEBUT_BODY_ID)
              .children(
                h.h2
                  .id(DEBUT_TITLE_ID)
                  .class('sr-only')
                  .children(`New zombie: ${ZOMBIE_KINDS[kind].name}`),
                h.p
                  .id(DEBUT_BODY_ID)
                  .class('sr-only')
                  .children(debutPitch(kind)),
                debutCardButtonView(model, h),
              ),
        }),
)
