import { Array, Option, Order, pipe } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import {
  type Lobby,
  type LobbyMember,
  MAX_PLAYERS,
  type PickedMode,
  type RoomDifficulty,
  type RoomScore,
} from '@munch/netcode'

import { closeButtonView } from '../dialogs'
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../difficulty'
import {
  CAMPAIGN_ICON,
  ENDLESS_ICON,
  PADLOCK_ICON,
  SHARE_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
  TROPHY_ICON,
} from '../icons'
import { callingPropView, iconView, rankTagView } from '../menuParts'
import type { Appearance } from '../model'
import { CALLING_NAMES, MODE_NAMES } from '../names'
import { seatColorOf } from '../partyView'
import type { Calling, SavedBoughtCosmetics } from '../playerData'
import { callingPickerView, callingPillView } from './callingPicker'
import { CoopComposition } from './composition'
import {
  AWAY_ICON,
  BACK_ICON,
  CHECK_ICON,
  CODE_ICON,
  COOP_ICON,
  CROWN_ICON,
  KICK_ICON,
  LEAVE_ICON,
  LINK_ICON,
  NEW_ROOM_ICON,
  OFFLINE_ICON,
  QUICK_ICON,
  WAIT_ICON,
  portraitOf,
} from './icons'
import { callingOfMember, seatLook, seatLookOf } from './looks'
import { Message } from './message'
import {
  type CoopProblem,
  type Model,
  type Queue,
  type Room,
  Screen,
} from './model'
import {
  CODE_INPUT_ID,
  MODE_PICKS,
  QUICK_PLAY_BUTTON_ID,
  READY_BUTTON_ID,
  ROOM_CODE_LENGTH,
  canPickDifficulty,
  canPickMode,
  isHost,
  isInLobby,
  isPicking,
  meIn,
  pickedModeOf,
} from './roomState'
import { readoutOf } from './seam'

// INPUTS

// NOTE: `isRunCardUp` while the root's end card shows a run's end, so the
// lobby waits behind it until the player picks one of the card's buttons.
export type ViewInputs = Readonly<{
  look: Appearance
  isKeyboard: boolean
  isRunCardUp: boolean
  bought: SavedBoughtCosmetics
}>

const lookOf = (inputs: ViewInputs, room: Room, seat: number) =>
  seatLookOf(inputs.look, room.slot, seat, room.maybeLobby)

// PIECES

const keyCapView = (
  inputs: ViewInputs,
  cap: string,
  h: HtmlBuilder<Message>,
): Html =>
  inputs.isKeyboard
    ? h.span([h.Class('coop-key'), h.AriaHidden(true)], [cap])
    : h.empty

const portraitView = (
  look: Appearance,
  className: string,
  h: HtmlBuilder<Message>,
  calling: Calling = 'You',
): Html => iconView(`coop-portrait ${className}`, portraitOf(look, calling), h)

const coopCloseView = (h: HtmlBuilder<Message>): Html =>
  closeButtonView(
    {
      attributes: [h.OnClick(Message.ClickedCloseButton())],
      className: 'coop-close',
      label: 'Close co-op',
    },
    h,
  )

const backButtonView = (
  label: string,
  message: Message,
  h: HtmlBuilder<Message>,
): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-back'),
      h.AriaLabel(label),
      h.AriaKeyshortcuts('Escape'),
      h.OnClick(message),
    ],
    [iconView('coop-back-icon', BACK_ICON, h)],
  )

const PROBLEM_WORDS: Readonly<Record<CoopProblem, string>> = {
  Offline: 'OFFLINE',
  NoRoom: 'NO ROOM',
  Full: 'FULL',
  Started: 'STARTED',
  Busy: 'BUSY',
  NotACode: 'BAD CODE',
  Kicked: 'KICKED',
  Dropped: 'LOST',
  Outdated: 'UPDATE',
}

const PROBLEM_LINES: Readonly<Record<CoopProblem, string>> = {
  Offline: 'Co-op needs the internet.',
  NoRoom: 'No room has that code.',
  Full: 'That room is full.',
  Started: 'That room already started.',
  Busy: 'Too many tries. Wait a moment.',
  NotACode: 'That is not a room code.',
  Kicked: 'The host kicked you.',
  Dropped: 'The connection dropped.',
  Outdated: 'The room runs a newer game. Update to join.',
}

const problemView = (
  maybeProblem: Option.Option<CoopProblem>,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(maybeProblem, {
    onNone: () => h.empty,
    onSome: problem =>
      h.p(
        [
          h.Class('coop-problem'),
          h.Role('alert'),
          h.AriaLabel(PROBLEM_LINES[problem]),
        ],
        [
          iconView('coop-problem-icon', OFFLINE_ICON, h),
          h.span([h.AriaHidden(true)], [PROBLEM_WORDS[problem]]),
        ],
      ),
  })

// PING

// NOTE: a player's link as three bars: green and full under 100 ms, yellow
// and two under 200, red and one above; the number is for screen readers.
const PING_GOOD_MS = 100
const PING_OK_MS = 200

const pingGrade = (rttMs: number): 'Good' | 'Ok' | 'Bad' =>
  rttMs < PING_GOOD_MS ? 'Good' : rttMs < PING_OK_MS ? 'Ok' : 'Bad'

const pingBarsView = (
  rttMs: number,
  className: string,
  h: HtmlBuilder<Message>,
): Html =>
  rttMs <= 0
    ? h.empty
    : h.span(
        [
          h.Class(`coop-ping ${className}`),
          h.Role('img'),
          h.DataAttribute('ping', pingGrade(rttMs)),
          h.AriaLabel(`${Math.round(rttMs)} ms`),
        ],
        Array.map([1, 2, 3], bar =>
          h.span([h.Class('coop-ping-bar'), h.DataAttribute('bar', `${bar}`)]),
        ),
      )

const ownPingOf = (room: Room): number => Math.round(room.session.rttMs)

// HUB

const quickHeadsView = (h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-quick-heads'), h.AriaHidden(true)],
    Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
      portraitView(seatLook(seat), 'coop-quick-head', h),
    ),
  )

const hubView = (
  maybeProblem: Option.Option<CoopProblem>,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-hub')],
    [
      coopCloseView(h),
      h.h2(
        [h.Class('coop-title'), h.AriaLabel('Co-op')],
        [iconView('coop-title-icon', COOP_ICON, h), h.span([], ['CO-OP'])],
      ),
      h.button(
        [
          h.Type('button'),
          h.Id(QUICK_PLAY_BUTTON_ID),
          h.Class('coop-quick'),
          h.AriaLabel('Quick play: join players anywhere'),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(Message.ClickedQuickPlayButton()),
        ],
        [
          h.span(
            [h.Class('coop-quick-face')],
            [
              iconView('coop-quick-icon', QUICK_ICON, h),
              h.span([h.Class('coop-quick-label')], ['QUICK PLAY']),
              quickHeadsView(h),
            ],
          ),
          keyCapView(inputs, 'ENTER', h),
        ],
      ),
      h.div(
        [h.Class('coop-pair')],
        [
          h.button(
            [
              h.Type('button'),
              h.Class('coop-tile coop-tile-code'),
              h.AriaLabel('Join a friend with a code'),
              h.OnClick(Message.ClickedCodeButton()),
            ],
            [
              iconView('coop-tile-icon', CODE_ICON, h),
              h.span([h.Class('coop-tile-label')], ['CODE']),
            ],
          ),
          h.button(
            [
              h.Type('button'),
              h.Class('coop-tile coop-tile-new'),
              h.AriaLabel('Make a room for friends'),
              h.OnClick(Message.ClickedCreateButton()),
            ],
            [
              iconView('coop-tile-icon', NEW_ROOM_ICON, h),
              h.span([h.Class('coop-tile-label')], ['NEW ROOM']),
            ],
          ),
        ],
      ),
      problemView(maybeProblem, h),
    ],
  )

// CODE

const slotState = (typed: string, index: number): string => {
  if (index < typed.length) {
    return 'Filled'
  } else if (index === typed.length) {
    return 'Next'
  } else {
    return 'Empty'
  }
}

const codeSlotsView = (typed: string, h: HtmlBuilder<Message>): Html =>
  h.span(
    [h.Class('coop-slots'), h.AriaHidden(true)],
    Array.map(Array.range(0, ROOM_CODE_LENGTH - 1), index =>
      h.span(
        [
          h.Class('coop-slot'),
          h.DataAttribute('state', slotState(typed, index)),
        ],
        [typed.charAt(index)],
      ),
    ),
  )

const codeView = (
  typed: string,
  maybeProblem: Option.Option<CoopProblem>,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-code')],
    [
      backButtonView('Back', Message.ClickedBackButton(), h),
      coopCloseView(h),
      iconView('coop-code-icon', CODE_ICON, h),
      h.form(
        [h.Class('coop-code-form'), h.OnSubmit(Message.SubmittedCode())],
        [
          h.label(
            [h.Class('coop-code-field')],
            [
              h.input([
                h.Id(CODE_INPUT_ID),
                h.Class('coop-code-input'),
                h.AriaLabel('Room code'),
                h.Type('text'),
                h.Value(typed),
                h.Autocomplete('off'),
                h.Autocapitalize('characters'),
                h.Spellcheck(false),
                h.EnterKeyHint('go'),
                h.OnInput(value => Message.UpdatedCode({ value })),
              ]),
              codeSlotsView(typed, h),
            ],
          ),
          h.button(
            [
              h.Type('submit'),
              h.Class('coop-go'),
              h.AriaLabel('Join'),
              h.Disabled(typed.length < ROOM_CODE_LENGTH),
            ],
            [iconView('coop-go-icon', QUICK_ICON, h), h.span([], ['GO'])],
          ),
        ],
      ),
      problemView(maybeProblem, h),
    ],
  )

// ASKING

const askingView = (h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('coop-asking'), h.Role('status'), h.AriaLabel('Finding the room')],
    [
      h.span(
        [h.Class('coop-bounce'), h.AriaHidden(true)],
        Array.map(Array.range(0, 2), seat =>
          portraitView(seatLook(seat), 'coop-bounce-head', h),
        ),
      ),
    ],
  )

// QUEUE

const queueSeatView = (
  queue: Queue,
  inputs: ViewInputs,
  seat: number,
  h: HtmlBuilder<Message>,
): Html => {
  const isFilled = seat < queue.waiting
  const isMe = seat === queue.position - 1
  const name = Option.getOrElse(Array.get(queue.names, seat), () => '')
  return h.keyed('li')(
    `seat-${seat}`,
    [
      h.Class('coop-queue-seat'),
      h.DataAttribute('state', isFilled ? 'Filled' : 'Empty'),
      h.DataAttribute('me', isMe ? 'Me' : 'Other'),
    ],
    [
      isFilled
        ? portraitView(
            isMe ? inputs.look : seatLook(seat),
            'coop-queue-head',
            h,
          )
        : h.span([h.Class('coop-queue-empty'), h.AriaHidden(true)], ['?']),
      h.span([h.Class('coop-nameplate')], [isFilled ? name : '']),
    ],
  )
}

const offerView = (
  queue: Queue,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
) => {
  if (queue.offerPlayers === 0 || queue.answer === 'Waiting') {
    return h.empty
  }
  const heads = Array.map(Array.range(0, queue.offerPlayers - 1), seat =>
    portraitView(
      seat === queue.position - 1 ? inputs.look : seatLook(seat),
      seat < queue.accepted
        ? 'coop-offer-head coop-offer-yes'
        : 'coop-offer-head',
      h,
    ),
  )
  return h.div(
    [h.Class('coop-offer')],
    [
      h.button(
        [
          h.Type('button'),
          h.Class('coop-offer-start'),
          h.DataAttribute('answer', queue.answer),
          h.AriaLabel(
            `Start with ${queue.offerPlayers} players. ${queue.accepted} said yes`,
          ),
          h.AriaPressed(queue.answer === 'Accepted' ? 'true' : 'false'),
          h.OnClick(Message.ClickedAcceptOfferButton()),
        ],
        [
          h.span(
            [h.Class('coop-offer-label')],
            [`START WITH ${queue.offerPlayers}?`],
          ),
          h.span([h.Class('coop-offer-heads'), h.AriaHidden(true)], heads),
          keyCapView(inputs, 'ENTER', h),
        ],
      ),
      queue.answer === 'Accepted'
        ? h.empty
        : h.button(
            [
              h.Type('button'),
              h.Class('coop-offer-wait'),
              h.AriaLabel('Keep waiting for four'),
              h.OnClick(Message.ClickedKeepWaitingButton()),
            ],
            [iconView('coop-offer-wait-icon', WAIT_ICON, h)],
          ),
    ],
  )
}

const queueView = (
  queue: Queue,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-queue')],
    [
      closeButtonView(
        {
          attributes: [h.OnClick(Message.ClickedCancelQueueButton())],
          className: 'coop-close',
          label: 'Stop looking',
        },
        h,
      ),
      iconView('coop-queue-icon', QUICK_ICON, h),
      h.ol(
        [
          h.Class('coop-queue-seats'),
          h.AriaLabel(`${queue.waiting} of ${queue.groupSize} players here`),
        ],
        Array.map(Array.range(0, Math.max(1, queue.groupSize) - 1), seat =>
          queueSeatView(queue, inputs, seat, h),
        ),
      ),
      offerView(queue, inputs, h),
    ],
  )

// LOBBY

const ROOM_CODE_COPIED = 'COPIED!'

// NOTE: a tap on the code copies it, and COPIED! flashes over it, afresh
// for each copy (keyed by the count), fading in place.
const roomCodeView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-room-code'),
      h.AriaLabel(
        `Room code ${room.code.split('').join(' ')}${room.codeCopies > 0 ? ', copied' : ', tap to copy'}`,
      ),
      h.OnClick(Message.ClickedRoomCode()),
    ],
    [
      ...Array.map(room.code.split(''), symbol =>
        h.span(
          [h.Class('coop-room-code-symbol'), h.AriaHidden(true)],
          [symbol],
        ),
      ),
      ...(room.codeCopies > 0
        ? [
            h.keyed('span')(
              `copied-${room.codeCopies}`,
              [h.Class('coop-room-code-copied'), h.AriaHidden(true)],
              [ROOM_CODE_COPIED],
            ),
          ]
        : []),
    ],
  )

const shareButtonView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-share'),
      h.DataAttribute('share', room.share),
      h.AriaLabel(
        room.share === 'Copied' ? 'Link copied' : 'Share the room link',
      ),
      h.OnClick(Message.ClickedShareButton()),
    ],
    [
      iconView(
        'coop-share-icon',
        room.share === 'Idle' ? SHARE_ICON : CHECK_ICON,
        h,
      ),
      iconView('coop-share-link', LINK_ICON, h),
    ],
  )

const leaveButtonView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.button(
    [
      h.Type('button'),
      h.Class('coop-leave'),
      h.AriaLabel('Leave the room'),
      h.Disabled(room.departure === 'Leaving'),
      h.OnClick(Message.ClickedLeaveButton()),
    ],
    [iconView('coop-leave-icon', LEAVE_ICON, h)],
  )

const seatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  seat: number,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === seat),
    {
      onNone: () =>
        h.keyed('li')(
          `seat-${seat}`,
          [
            h.Class('coop-seat'),
            h.DataAttribute('state', 'Empty'),
            h.AriaLabel('Empty seat'),
          ],
          [h.span([h.Class('coop-seat-empty'), h.AriaHidden(true)], ['+'])],
        ),
      onSome: member => memberSeatView(room, lobby, inputs, member, h),
    },
  )

// NOTE: a seat read aloud: who, their rank, their hero (nothing for
// YOU), and READY. The prop and the badge are pictures.
const seatLabelOf = (
  member: LobbyMember,
  { isMe, isTheHost }: Readonly<{ isMe: boolean; isTheHost: boolean }>,
): string => {
  const calling = callingOfMember(member)
  return [
    member.name,
    ...(isMe ? ['you'] : []),
    ...(isTheHost ? ['host'] : []),
    `rank ${member.rank}`,
    ...(calling === 'You' ? [] : [CALLING_NAMES[calling]]),
    ...(member.ready ? ['ready'] : []),
  ].join(', ')
}

const memberSeatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  member: LobbyMember,
  h: HtmlBuilder<Message>,
): Html => {
  const isMe = Option.exists(room.maybePlayerId, id => id === member.playerId)
  const isTheHost = lobby.host === member.playerId
  const canKick = isHost(room) && !isMe && lobby.status === 'Lobby'
  const label = seatLabelOf(member, { isMe, isTheHost })
  return h.keyed('li')(
    member.playerId,
    [
      h.Class('coop-seat'),
      h.DataAttribute('state', member.ready ? 'Ready' : 'Here'),
      h.DataAttribute('me', isMe ? 'Me' : 'Other'),
      h.AriaLabel(label),
    ],
    [
      portraitView(
        lookOf(inputs, room, member.slot),
        'coop-seat-head',
        h,
        callingOfMember(member),
      ),
      isTheHost ? iconView('coop-crown', CROWN_ICON, h) : h.empty,
      member.ready
        ? h.span(
            [h.Class('coop-stamp'), h.AriaHidden(true)],
            [iconView('coop-stamp-icon', CHECK_ICON, h)],
          )
        : h.empty,
      h.div(
        [h.Class('coop-nameline')],
        [
          rankTagView('coop-rank', member.rank, 2, h),
          callingPropView('coop-calling', callingOfMember(member), h),
          h.span(
            [h.Class('coop-nameplate'), h.AriaHidden(true)],
            [member.name],
          ),
        ],
      ),
      pingBarsView(
        isMe && ownPingOf(room) > 0 ? ownPingOf(room) : member.pingMs,
        'coop-seat-ping',
        h,
      ),
      canKick
        ? h.button(
            [
              h.Type('button'),
              h.Class('coop-kick'),
              h.AriaLabel(`Kick ${member.name}`),
              h.OnClick(
                Message.ClickedKickButton({ playerId: member.playerId }),
              ),
            ],
            [iconView('coop-kick-icon', KICK_ICON, h)],
          )
        : h.empty,
    ],
  )
}

const resultView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  Option.match(lobby.result, {
    onNone: () => h.empty,
    onSome: result =>
      h.div(
        [h.Class('coop-result'), h.AriaLabel('Last run')],
        [
          iconView(
            'coop-result-icon',
            result.reason === 'Won' ? TROPHY_ICON : SKULL_ICONS.Hard,
            h,
          ),
          h.ol(
            [h.Class('coop-result-scores')],
            pipe(
              result.scores,
              Array.sort(BY_SCORE_DESCENDING),
              Array.map((score, index) =>
                h.keyed('li')(
                  score.playerId,
                  [
                    h.Class('coop-result-score'),
                    h.AriaLabel(scoreLabelOf(lobby, score, index)),
                  ],
                  [
                    index === 0 && score.score > 0
                      ? iconView('coop-result-crown', CROWN_ICON, h)
                      : h.empty,
                    portraitView(
                      lookOf(inputs, room, score.slot),
                      'coop-result-head',
                      h,
                      callingAt(lobby, score.slot),
                    ),
                    rankTagView(
                      'coop-result-rank',
                      rankAt(lobby, score.slot),
                      1,
                      h,
                    ),
                    callingPropView(
                      'coop-result-calling',
                      callingAt(lobby, score.slot),
                      h,
                    ),
                    h.span([h.AriaHidden(true)], [`${score.score}`]),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
  })

// NOTE: a score read aloud: who, their rank, their hero (nothing for
// YOU), the points, and the MVP.
const scoreLabelOf = (
  lobby: Lobby,
  score: RoomScore,
  index: number,
): string => {
  const calling = callingAt(lobby, score.slot)
  return [
    `${nameAt(lobby, score.slot)}: rank ${rankAt(lobby, score.slot)}`,
    ...(calling === 'You' ? [] : [CALLING_NAMES[calling]]),
    `${score.score}${index === 0 && score.score > 0 ? ', MVP' : ''}`,
  ].join(', ')
}

const BY_SCORE_DESCENDING = Order.flip(
  Order.mapInput(Order.Number, (score: RoomScore) => score.score),
)

const nameAt = (lobby: Lobby, slot: number): string =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: () => `Player ${slot + 1}`, onSome: member => member.name },
  )

// NOTE: a seat's rank from the lobby; a seat that left reads as 1.
const rankAt = (lobby: Lobby, slot: number): number =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: () => 1, onSome: member => member.rank },
  )

// NOTE: a seat's calling from the lobby; a seat that left has none.
const callingAt = (lobby: Lobby, slot: number): Calling =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: (): Calling => 'You', onSome: callingOfMember },
  )

const readyButtonView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html => {
  const isReady = Option.exists(meIn(room), me => me.ready)
  return h.button(
    [
      h.Type('button'),
      h.Id(READY_BUTTON_ID),
      h.Class('coop-ready'),
      h.DataAttribute('ready', isReady ? 'Ready' : 'NotReady'),
      h.AriaPressed(isReady ? 'true' : 'false'),
      h.AriaKeyshortcuts('Enter'),
      h.Disabled(Option.isNone(meIn(room))),
      h.OnClick(Message.ClickedReadyButton()),
    ],
    [
      h.span(
        [h.Class('coop-ready-face')],
        [
          iconView('coop-ready-icon', CHECK_ICON, h),
          h.span([h.Class('coop-ready-label')], ['READY']),
        ],
      ),
      keyCapView(inputs, 'ENTER', h),
    ],
  )
}

// PICKS

const MODE_PICK_ICONS: Readonly<Record<PickedMode, string>> = {
  Campaign: CAMPAIGN_ICON,
  Endless: ENDLESS_ICON,
  KeepGoing: ENDLESS_ICON,
}

// NOTE: a pick the host can change is a button; everyone else sees the
// same icons, still, with the picked one lit.
const pickAttributes = (
  canPick: boolean,
  message: Message,
  h: HtmlBuilder<Message>,
) => (canPick ? [h.OnClick(message)] : [h.AriaDisabled(true)])

const modePickView = (
  room: Room,
  lobby: Lobby,
  mode: PickedMode,
  h: HtmlBuilder<Message>,
): Html => {
  const isChosen = pickedModeOf(lobby) === mode
  return h.keyed('button')(
    mode,
    [
      h.Type('button'),
      h.Class('coop-pick coop-mode-pick'),
      h.DataAttribute('mode', mode),
      h.DataAttribute('state', isChosen ? 'Chosen' : 'Other'),
      h.AriaPressed(isChosen ? 'true' : 'false'),
      h.AriaLabel(MODE_NAMES[mode]),
      ...pickAttributes(isPicking(room), Message.ClickedModePick({ mode }), h),
    ],
    [
      iconView('coop-pick-icon', MODE_PICK_ICONS[mode], h),
      mode === 'KeepGoing'
        ? iconView('coop-pick-badge', TROPHY_ICON, h)
        : h.empty,
    ],
  )
}

const skullIndexOf = (difficulty: RoomDifficulty): number =>
  Option.getOrElse(
    Array.findFirstIndex(DIFFICULTY_ORDER, level => level === difficulty),
    () => 0,
  )

const skullPickView = (
  room: Room,
  lobby: Lobby,
  difficulty: RoomDifficulty,
  h: HtmlBuilder<Message>,
): Html => {
  const isLit = skullIndexOf(difficulty) <= skullIndexOf(lobby.difficulty)
  const isLocked = !canPickDifficulty(lobby, difficulty)
  return h.keyed('button')(
    difficulty,
    [
      h.Type('button'),
      h.Class('coop-pick coop-skull-pick'),
      h.DataAttribute('difficulty', difficulty),
      h.DataAttribute(
        'state',
        lobby.difficulty === difficulty ? 'Chosen' : isLit ? 'Lit' : 'Other',
      ),
      h.AriaPressed(lobby.difficulty === difficulty ? 'true' : 'false'),
      h.AriaLabel(
        isLocked
          ? `${DIFFICULTIES[difficulty].name}, locked`
          : DIFFICULTIES[difficulty].name,
      ),
      ...pickAttributes(
        isPicking(room) && !isLocked,
        Message.ClickedDifficultyPick({ difficulty }),
        h,
      ),
    ],
    [
      iconView(
        'coop-pick-icon',
        isLocked
          ? PADLOCK_ICON
          : isLit
            ? SKULL_ICONS[lobby.difficulty]
            : SKULL_OFF_ICON,
        h,
      ),
    ],
  )
}

const picksView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [
      h.Class('coop-picks'),
      h.DataAttribute('host', isPicking(room) ? 'Picking' : 'Watching'),
      h.AriaLabel(
        `${MODE_NAMES[pickedModeOf(lobby)]}, ${DIFFICULTIES[lobby.difficulty].name}`,
      ),
    ],
    [
      h.div(
        [h.Class('coop-pick-group'), h.Role('group'), h.AriaLabel('Mode')],
        [
          ...Array.map(
            Array.filter(MODE_PICKS, mode => canPickMode(lobby, mode)),
            mode => modePickView(room, lobby, mode, h),
          ),
          isPicking(room) ? keyCapView(inputs, 'E', h) : h.empty,
        ],
      ),
      h.div(
        [
          h.Class('coop-pick-group coop-skulls'),
          h.Role('group'),
          h.AriaLabel('Difficulty'),
        ],
        [
          ...Array.map(DIFFICULTY_ORDER, difficulty =>
            skullPickView(room, lobby, difficulty, h),
          ),
          isPicking(room) ? keyCapView(inputs, 'X', h) : h.empty,
        ],
      ),
      h.div(
        [h.Class('coop-pick-group'), h.Role('group'), h.AriaLabel('Hero')],
        [callingPillView(room, [keyCapView(inputs, 'Y', h)], h)],
      ),
    ],
  )

const lobbyView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html =>
  h.div(
    [h.Class('coop-lobby')],
    [
      h.div(
        [h.Class('coop-lobby-top')],
        [
          leaveButtonView(room, h),
          roomCodeView(room, h),
          shareButtonView(room, h),
        ],
      ),
      Option.match(room.maybeLobby, {
        onNone: () => askingView(h),
        onSome: lobby =>
          h.ol(
            [h.Class('coop-seats'), h.AriaLabel('Players')],
            Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
              seatView(room, lobby, inputs, seat, h),
            ),
          ),
      }),
      Option.match(room.maybeLobby, {
        onNone: () => h.empty,
        onSome: lobby => resultView(room, lobby, inputs, h),
      }),
      Option.match(room.maybeLobby, {
        onNone: () => h.empty,
        onSome: lobby => picksView(room, lobby, inputs, h),
      }),
      readyButtonView(room, inputs, h),
      Option.match(meIn(room), {
        onNone: () => h.empty,
        onSome: me =>
          callingPickerView(
            room,
            lookOf(inputs, room, me.slot),
            inputs.bought,
            h,
          ),
      }),
    ],
  )

// ARENA

const countdownView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.keyed('div')(
    `countdown-${Option.match(room.maybeLobby, { onNone: () => 0, onSome: lobby => lobby.round })}`,
    [h.Class('coop-countdown'), h.AriaHidden(true)],
    Array.map(['3', '2', '1', 'GO!'], (word, index) =>
      h.keyed('span')(
        word,
        [
          h.Class('coop-countdown-word'),
          h.Style({ animationDelay: `${index * 0.6}s` }),
        ],
        [word],
      ),
    ),
  )

// NOTE: Zz while the link tries again; past 20 seconds it says LOST THE ROOM
// and offers the way out, with the tries going on behind it.
const awayView = (room: Room, h: HtmlBuilder<Message>): Html =>
  room.link === 'Reconnecting' || room.link === 'Lost'
    ? h.div(
        [h.Class('coop-away'), h.Role('status'), h.AriaLabel('Reconnecting')],
        [
          iconView('coop-away-icon', AWAY_ICON, h),
          room.link === 'Lost' ? lostView(room, h) : h.empty,
        ],
      )
    : h.empty

const lostView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('coop-away-lost')],
    [
      h.p(
        [h.Class('coop-problem'), h.Role('alert')],
        [
          iconView('coop-problem-icon', OFFLINE_ICON, h),
          h.span([], ['LOST THE ROOM']),
        ],
      ),
      h.button(
        [
          h.Type('button'),
          h.Class('coop-leave'),
          h.AriaLabel('Leave the room'),
          h.Disabled(room.departure === 'Leaving'),
          h.OnClick(Message.ClickedLeaveButton()),
        ],
        [
          iconView('coop-leave-icon', LEAVE_ICON, h),
          h.span([h.AriaHidden(true)], ['LEAVE']),
        ],
      ),
    ],
  )

// NOTE: the link's numbers, for the audit harness and the curious: the
// round trip, what came down, and how far your own player was corrected.
const netView = (room: Room, h: HtmlBuilder<Message>): Html => {
  const { stats } = room.session
  return h.div([
    h.Class('coop-net'),
    h.AriaHidden(true),
    h.DataAttribute('rtt', `${Math.round(room.session.rttMs)}`),
    h.DataAttribute('bytes-in', `${stats.bytesIn}`),
    h.DataAttribute('frames-in', `${stats.framesIn}`),
    h.DataAttribute('inputs-out', `${stats.inputsOut}`),
    h.DataAttribute('since', `${stats.sinceMs}`),
    h.DataAttribute('now', `${room.session.renderedMs}`),
    h.DataAttribute('corrections', `${stats.corrections}`),
    h.DataAttribute('correction-px', `${stats.maxCorrectionPx.toFixed(1)}`),
    h.DataAttribute('stalls', `${stats.stalls}`),
    h.DataAttribute('longest-stall', `${stats.longestStallMs}`),
    h.DataAttribute('resyncs', `${stats.resyncs}`),
    h.DataAttribute('slot', `${room.slot}`),
    h.DataAttribute('looked-hits', `${room.hits.looked}`),
    h.DataAttribute('confirmed-hits', `${room.hits.confirmed}`),
    h.DataAttribute('delay', `${Math.round(room.session.interpolationMs)}`),
    h.DataAttribute(
      'world',
      Option.match(room.maybeWorld, {
        onNone: () => '',
        onSome: readoutOf,
      }),
    ),
  ])
}

// NOTE: the run itself is the game's own scene under this overlay
// (src/coopPlay.ts), drawn from the room's World with the game's views.
// Co-op adds only what the room is: LEAVE, the countdown, Away while the
// socket reconnects, and the trophy when the run ends.
// NOTE: every player's bars in their seat's color, your own from your
// own pings and the rest as the room last shared them.
const arenaPingsView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('coop-arena-pings'), h.AriaLabel('Connections')],
    Array.map(
      Array.sort(
        Array.dedupe(
          Array.append(
            Array.map(room.session.rtts, ping => ping.slot),
            room.slot,
          ),
        ),
        Order.Number,
      ),
      slot =>
        h.keyed('span')(
          `ping-${slot}`,
          [
            h.Class('coop-arena-ping'),
            h.Style({ borderColor: seatColorOf(slot) }),
          ],
          [
            pingBarsView(
              slot === room.slot
                ? ownPingOf(room)
                : Option.getOrElse(
                    Option.map(
                      Array.findFirst(
                        room.session.rtts,
                        ping => ping.slot === slot,
                      ),
                      ping => ping.rttMs,
                    ),
                    () => 0,
                  ),
              'coop-arena-ping-bars',
              h,
            ),
          ],
        ),
    ),
  )

const arenaView = (room: Room, h: HtmlBuilder<Message>): Html =>
  h.div(
    [h.Class('coop-arena')],
    [
      countdownView(room, h),
      awayView(room, h),
      h.div(
        [h.Class('coop-arena-hud')],
        [leaveButtonView(room, h), arenaPingsView(room, h)],
      ),
      netView(room, h),
    ],
  )

// NOTE: while the root's end card is up the room's choices are its buttons
// (RUN IT BACK, LOBBY, LEAVE in src/menus.ts), so co-op draws nothing over
// it: no scrim, and nothing to take a tap.
const roomView = (
  room: Room,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
): Html => {
  if (inputs.isRunCardUp) {
    return h.empty
  } else if (!isInLobby(room)) {
    return arenaView(room, h)
  } else {
    return lobbyView(room, inputs, h)
  }
}

// VIEW

const roomScreenName = (room: Room, inputs: ViewInputs): string => {
  if (inputs.isRunCardUp) {
    return 'RunCard'
  } else {
    return isInLobby(room) ? 'Lobby' : 'Arena'
  }
}

const screenName = (model: Model, inputs: ViewInputs): string =>
  Screen.match(model.screen, {
    Closed: () => 'Closed',
    Hub: () => 'Hub',
    Code: () => 'Code',
    Asking: () => 'Asking',
    Queue: () => 'Queue',
    InRoom: ({ room }) => roomScreenName(room, inputs),
  })

export const view = CoopComposition.makeView.withInputs<ViewInputs>(
  (model, inputs, h) =>
    Screen.isAnyOf(['Closed'])(model.screen)
      ? h.empty
      : h.section(
          [
            h.Class('coop'),
            h.DataAttribute('screen', screenName(model, inputs)),
            h.AriaLabel('Co-op'),
          ],
          [
            Screen.match(model.screen, {
              Hub: ({ maybeProblem }) => hubView(maybeProblem, inputs, h),
              Code: ({ typed, maybeProblem }) =>
                codeView(typed, maybeProblem, h),
              Asking: () => askingView(h),
              Queue: ({ queue }) => queueView(queue, inputs, h),
              InRoom: ({ room }) => roomView(room, inputs, h),
            }),
          ],
        ),
)
