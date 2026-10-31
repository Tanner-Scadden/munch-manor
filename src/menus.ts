import { Array, Option, Order } from 'effect'
import type { Html } from 'foldkit/html'

import type { LobbyMember } from '@munch/netcode'

import type { ApplicationViewBuilder } from './composition'
import { CHECK_ICON, COOP_ICON, LEAVE_ICON, portraitOf } from './coop/icons'
import { seatLookOf } from './coop/looks'
import type { Room as CoopRoom } from './coop/model'
import { maybeRoomOf, meIn, pickedModeOf } from './coop/roomState'
import { isOpen as isCoopOpen } from './coop/update'
import { isRunCardHeld, isShareCopied, sharedRunOf } from './endBeat'
import {
  END_LEAVE_ROOM_BUTTON_ID,
  END_LOBBY_BUTTON_ID,
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
  SHARE_ICON,
  SOUND_OFF_ICON,
  SOUND_ON_ICON,
} from './icons'
import { isProfileOpen } from './menuState'
import { Message } from './message'
import { DebutCard, type Model, Phase, RunMode, type ZombieKind } from './model'
import { SHARE_TEXT_DATA, ShareFromClick } from './mount'
import { canSkipDebutCard } from './onboarding'
import { runDifficultyOf } from './onlineRun'
import { shareText } from './share'
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

// NOTE: the end card's buttons, icon first and all one size: HOME, then
// RETRY (on Victory AGAIN, with KEEP GOING beside it), then SHARE. Each
// pops in a beat after the one before it. SHARE has no key: the share
// sheet and the clipboard want a tap or a click.
//
// NOTE: `heads` is RUN IT BACK's crew, each lit once they are in.
type CrewHead = Readonly<{ slot: number; portrait: string; isIn: boolean }>

type EndButton = Readonly<{
  id: string
  look: 'Home' | 'Retry' | 'KeepGoing' | 'Share' | 'Lobby' | 'Leave'
  icon: string
  label: string
  maybeKey: Option.Option<Readonly<{ cap: string; name: string }>>
  ariaLabel: string
  message: Message
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
  message: Message.ClickedMenuButton(),
  maybePressed: Option.none(),
  heads: [],
}

const retryButton = (model: Model): EndButton => ({
  id: END_RETRY_BUTTON_ID,
  look: 'Retry',
  icon: RETRY_ICON,
  label: Phase.isAnyOf(['Victory'])(model.phase) ? 'AGAIN' : 'RETRY',
  maybeKey: Option.some({ cap: 'ENTER', name: 'Enter' }),
  ariaLabel: RunMode.match(model.mode, {
    Campaign: () => `Retry: a new campaign of ${FINAL_WAVE} waves`,
    Endless: () => 'Retry: a new endless run',
  }),
  message: Message.ClickedRetryButton(),
  maybePressed: Option.none(),
  heads: [],
})

const KEEP_GOING_BUTTON: EndButton = {
  id: 'end-keep-going-button',
  look: 'KeepGoing',
  icon: ENDLESS_ICON,
  label: 'KEEP GOING',
  maybeKey: Option.some({ cap: 'K', name: 'K' }),
  ariaLabel: `Keep going: carry on into endless from wave ${FINAL_WAVE + 1} with your money, guns, and traps`,
  message: Message.ClickedKeepGoingButton(),
  maybePressed: Option.none(),
  heads: [],
}

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
    message: Message.ClickedShareButton(),
    maybePressed: Option.none(),
    heads: [],
  }
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
  ...(Array.isReadonlyArrayNonEmpty(button.heads)
    ? [
        h.span(
          [h.Class('end-button-heads'), h.AriaHidden(true)],
          Array.map(button.heads, head =>
            h.keyed('span')(`head-${head.slot}`, [
              h.Class('end-button-head'),
              h.DataAttribute('in', head.isIn ? 'In' : 'Out'),
              h.Style({ backgroundImage: head.portrait }),
            ]),
          ),
        ),
      ]
    : []),
  ...(model.lastDevice === 'KeyboardMouse'
    ? Option.match(button.maybeKey, {
        onNone: () => [],
        onSome: ({ cap }) => [
          h.span([h.Class('end-button-key'), h.AriaHidden(true)], [cap]),
        ],
      })
    : []),
]

// NOTE: this run's post, the room's difficulty in an online co-op run. The
// words are src/share.ts's.
export const shareTextOf = (model: Model): string =>
  shareText(sharedRunOf(model, runDifficultyOf(model)))

// NOTE: SHARE carries its post and the ShareFromClick Mount, which opens
// the share sheet (or copies the post) in the click itself; its OnClick
// counts the share (src/update/end.ts).
const shareAttributes = (model: Model, h: ApplicationViewBuilder) => [
  h.DataAttribute(SHARE_TEXT_DATA, shareTextOf(model)),
  h.OnMount(ShareFromClick()),
]

const endButtonView =
  (model: Model, h: ApplicationViewBuilder) =>
  (button: EndButton, index: number): Html =>
    h.keyed('button')(
      button.id,
      [
        h.Type('button'),
        h.Id(button.id),
        h.Class('end-button'),
        h.DataAttribute('look', button.look),
        h.Style({ animationDelay: `${index * END_BUTTON_STAGGER_MS}ms` }),
        h.AriaLabel(button.ariaLabel),
        ...Option.match(button.maybePressed, {
          onNone: () => [],
          onSome: isPressed => [h.AriaPressed(isPressed ? 'true' : 'false')],
        }),
        ...Option.match(button.maybeKey, {
          onNone: () => [],
          onSome: ({ name }) => [h.AriaKeyshortcuts(name)],
        }),
        h.OnClick(button.message, {
          focusSelector: '.game-surface',
          propagation: 'Stop',
        }),
        ...(button.look === 'Share' ? shareAttributes(model, h) : []),
      ],
      endButtonFace(model, button, h),
    )

// AN ONLINE ROOM'S CARD

const LEAVE_ROOM_BUTTON: EndButton = {
  id: END_LEAVE_ROOM_BUTTON_ID,
  look: 'Leave',
  icon: LEAVE_ICON,
  label: 'LEAVE',
  maybeKey: Option.some({ cap: 'H', name: 'H' }),
  ariaLabel: 'Leave the room',
  message: Message.ClickedLeaveRoomButton(),
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
  message: Message.ClickedRoomLobbyButton(),
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
          ),
          isIn: member.ready,
        }),
      ),
  })

// NOTE: RUN IT BACK is this player's READY in the room's lobby, so the same
// crew plays the room's next pick (KEEP GOING after a win) once everyone is
// in. Its heads light as each player says yes.
const runItBackButton = (model: Model, room: CoopRoom): EndButton => {
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
    label: isKeepGoing ? 'KEEP GOING' : 'RUN IT BACK',
    maybeKey: Option.some({ cap: 'ENTER', name: 'Enter' }),
    ariaLabel: `${isKeepGoing ? 'Keep going' : 'Run it back'} with this crew: ${inCount} of ${heads.length} in`,
    message: Message.ClickedRunItBackButton(),
    maybePressed: Option.some(Option.exists(meIn(room), me => me.ready)),
    heads,
  }
}

// NOTE: in an online co-op run the room's lobby comes next, so the card
// offers the room's choices (src/update/end.ts): LEAVE, RUN IT BACK, LOBBY,
// and SHARE.
const endButtonsOf = (model: Model): ReadonlyArray<EndButton> => {
  const maybeRoom = maybeRoomOf(model.coop)
  if (Option.isSome(maybeRoom)) {
    return [
      LEAVE_ROOM_BUTTON,
      runItBackButton(model, maybeRoom.value),
      ROOM_LOBBY_BUTTON,
      shareButton(model),
    ]
  } else if (Phase.isAnyOf(['Victory'])(model.phase)) {
    return [
      HOME_BUTTON,
      retryButton(model),
      KEEP_GOING_BUTTON,
      shareButton(model),
    ]
  } else {
    return [HOME_BUTTON, retryButton(model), shareButton(model)]
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
  if (offer === 'Nothing') {
    return h.empty
  } else if (isCoopOpen(model.coop)) {
    // NOTE: an online room's card offers the room's choices, with or without
    // a newer build waiting, until LOBBY lets the lobby in.
    return isRunCardHeld(model) ? endActionsView(model, h) : h.empty
  } else if (offer === 'MenuOnly') {
    return menuOnlyView(model, h)
  } else {
    return endActionsView(model, h)
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
