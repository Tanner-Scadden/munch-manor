import { Array, Function, Option, Order, String, pipe } from 'effect'

import {
  type ClosedReason,
  type Lobby,
  type LobbyMember,
  MAX_PLAYERS,
  type RoomScore,
} from '@munch/netcode'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
import {
  AWAY_ICON,
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
  WIFI_ICONS,
  portraitOf,
} from '../../art/coopIcons'
import { SHARE_ICON, SKULL_ICONS, TROPHY_ICON } from '../../art/icons'
import { MISSION_ICONS } from '../../art/missionIcons'
import { callingOfMember, seatLook, seatLookOf } from '../../art/seatLooks'
import {
  type CoopProblem,
  type Queue,
  type Room,
  RoomRequest,
  Screen,
  isInLobby,
} from '../../domain/coopRoom'
import { bestMarkOn } from '../../domain/dareMarks'
import { seatColorOf } from '../../render/partyView'
import type { SavedDareMarks } from '../../shared/dareMarkData'
import type {
  Appearance,
  Calling,
  SavedBoughtCosmetics,
} from '../../shared/playerData'
import { backButtonView, closeButtonView } from '../../ui/cornerButtons'
import { dareMarkBadgeView } from '../../ui/dareMarkView'
import { callingPropView, iconView, rankTagView } from '../../ui/menuParts'
import { CALLING_NAMES } from '../../world/names'
import { HeroPicker } from '../heroes/block'
import { readoutOf } from './auditReadout'
import { CoopMessage } from './message'
import { type Model } from './model'
import { askingView, poofView, queueRollView } from './motionArt'
import { nameButtonView, namePickerView } from './namePicker'
import { heroPickView, picksView } from './picksView'
import {
  CODE_INPUT,
  CODE_INPUT_ID,
  QUICK_PLAY_BUTTON,
  QUICK_PLAY_BUTTON_ID,
  READY_BUTTON,
  READY_BUTTON_ID,
  ROOM_CODE_LENGTH,
  isHost,
  meIn,
} from './roomState'

export type ViewInputs = Readonly<{
  look: Appearance
  isKeyboard: boolean
  isRunCardUp: boolean
  isRunEndComing: boolean
  bought: SavedBoughtCosmetics
  bones: number
  dareMarks: SavedDareMarks
}>

type HeroPick = Model['heroPick']

const lookOf = (inputs: ViewInputs, room: Room, seat: number) =>
  seatLookOf(inputs.look, room.slot, seat, room.maybeLobby)

const keyCapView = (
  inputs: ViewInputs,
  cap: string,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  inputs.isKeyboard
    ? h.span.class('coop-key').attr('aria-hidden', 'true').children(cap)
    : null

const portraitView = (
  look: Appearance,
  className: string,
  h: ApplicationViewBuilder,
  calling: Calling = 'You',
): ApplicationHtml | null =>
  iconView(`coop-portrait ${className}`, portraitOf(look, calling), h)

const coopCloseView = (h: ApplicationViewBuilder): ApplicationHtml | null =>
  closeButtonView(
    {
      button: h.button.on('click', CoopMessage.ClickedCoopCloseButton()),
      className: 'coop-close',
      label: 'Close co-op',
    },
    h,
  )

const coopBackView = (
  label: string,
  message: CoopMessage,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  backButtonView(
    {
      button: h.button.attr('aria-keyshortcuts', 'Escape').on('click', message),
      className: 'coop-back',
      label,
    },
    h,
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
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(maybeProblem, {
    onNone: () => null,
    onSome: problem =>
      h.p
        .class('coop-problem')
        .attr('role', 'alert')
        .attr('aria-label', PROBLEM_LINES[problem])
        .children(
          iconView('coop-problem-icon', OFFLINE_ICON, h),
          h.span.attr('aria-hidden', 'true').children(PROBLEM_WORDS[problem]),
        ),
  })

const PING_GOOD_MS = 100
const PING_OK_MS = 200

const pingGrade = (rttMs: number): 'Good' | 'Ok' | 'Bad' =>
  rttMs < PING_GOOD_MS ? 'Good' : rttMs < PING_OK_MS ? 'Ok' : 'Bad'

const pingView = (
  rttMs: number,
  className: string,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  rttMs <= 0
    ? null
    : h.span
        .class(`coop-ping ${className}`)
        .attr('role', 'img')
        .attr('data-ping', pingGrade(rttMs))
        .attr('aria-label', `${Math.round(rttMs)} ms`)
        .children(iconView('coop-ping-icon', WIFI_ICONS[pingGrade(rttMs)], h))

const ownPingOf = (room: Room): number => Math.round(room.session.rttMs)

const quickHeadsView = (h: ApplicationViewBuilder): ApplicationHtml | null =>
  h.span
    .class('coop-quick-heads')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
        portraitView(seatLook(seat), 'coop-quick-head', h),
      ),
    )

const hubView = (
  maybeProblem: Option.Option<CoopProblem>,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .key('hub')
    .class('coop-hub')
    .children(
      coopCloseView(h),
      h.h2
        .class('coop-title')
        .attr('aria-label', 'Co-op')
        .children(
          iconView('coop-title-icon', COOP_ICON, h),
          h.span.children('CO-OP'),
        ),
      h.button
        .attr('type', 'button')
        .id(QUICK_PLAY_BUTTON_ID)
        .ref(QUICK_PLAY_BUTTON)
        .class('coop-quick')
        .attr('aria-label', 'Quick play: join players anywhere')
        .attr('aria-keyshortcuts', 'Enter')
        .on('click', CoopMessage.ClickedCoopQuickPlayButton())
        .children(
          h.span
            .class('coop-quick-face')
            .children(
              iconView('coop-quick-icon', QUICK_ICON, h),
              h.span.class('coop-quick-label').children('QUICK PLAY'),
              quickHeadsView(h),
            ),
          keyCapView(inputs, 'ENTER', h),
        ),
      h.div.class('coop-pair').children(
        h.button
          .attr('type', 'button')
          .class('coop-tile coop-tile-code')
          .attr('aria-label', 'Join a friend with a code')
          .on('click', CoopMessage.ClickedCoopCodeButton())
          .children(
            iconView('coop-tile-icon', CODE_ICON, h),
            h.span.class('coop-tile-label').children('CODE'),
          ),
        h.button
          .attr('type', 'button')
          .class('coop-tile coop-tile-new')
          .attr('aria-label', 'Make a room for friends')
          .on('click', CoopMessage.ClickedCoopCreateButton())
          .children(
            iconView('coop-tile-icon', NEW_ROOM_ICON, h),
            h.span.class('coop-tile-label').children('NEW ROOM'),
          ),
      ),
      problemView(maybeProblem, h),
    )

const slotState = (typed: string, index: number): string => {
  if (index < typed.length) {
    return 'Filled'
  } else if (index === typed.length) {
    return 'Next'
  } else {
    return 'Empty'
  }
}

const codeSlotsView = (
  typed: string,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.span
    .class('coop-slots')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(Array.range(0, ROOM_CODE_LENGTH - 1), index =>
        h.span
          .class('coop-slot')
          .attr('data-state', slotState(typed, index))
          .children(Option.getOrElse(String.charAt(typed, index), () => '')),
      ),
    )

const codeView = (
  typed: string,
  maybeProblem: Option.Option<CoopProblem>,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .key('code')
    .class('coop-code')
    .children(
      coopBackView('Back', CoopMessage.ClickedCoopBackButton(), h),
      coopCloseView(h),
      iconView('coop-code-icon', CODE_ICON, h),
      h.form
        .class('coop-code-form')
        .on('submit', CoopMessage.SubmittedCoopCode())
        .children(
          h.label.class('coop-code-field').children(
            h.input
              .id(CODE_INPUT_ID)
              .ref(CODE_INPUT)
              .class('coop-code-input')
              .attr('aria-label', 'Room code')
              .attr('type', 'text')
              .value(typed)
              .attr('autocomplete', 'off')
              .attr('autocapitalize', 'characters')
              .attr('spellcheck', 'false')
              .attr('enterkeyhint', 'go')
              .on('input', ({ value }) =>
                CoopMessage.UpdatedCoopCode({ value }),
              ),
            codeSlotsView(typed, h),
          ),
          h.button
            .attr('type', 'submit')
            .class('coop-go')
            .attr('aria-label', 'Join')
            .disabled(typed.length < ROOM_CODE_LENGTH)
            .children(
              iconView('coop-go-icon', QUICK_ICON, h),
              h.span.children('GO'),
            ),
        ),
      problemView(maybeProblem, h),
    )

const queueSeatView = (
  queue: Queue,
  inputs: ViewInputs,
  seat: number,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isFilled = seat < queue.waiting
  const isMe = seat === queue.position - 1
  const name = Option.getOrElse(Array.get(queue.names, seat), () => '')
  return h.li
    .key(`seat-${seat}-${isFilled ? 'Filled' : 'Empty'}`)
    .class('coop-queue-seat')
    .attr('data-state', isFilled ? 'Filled' : 'Empty')
    .attr('data-me', isMe ? 'Me' : 'Other')
    .children(
      isFilled
        ? portraitView(
            isMe ? inputs.look : seatLook(seat),
            'coop-queue-head',
            h,
          )
        : queueRollView(h),
      h.span.class('coop-nameplate').children(isFilled ? name : ''),
    )
}

const offerView = (
  queue: Queue,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
) => {
  if (queue.offerPlayers === 0 || queue.answer === 'Waiting') {
    return null
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
  return h.div.class('coop-offer').children(
    h.button
      .attr('type', 'button')
      .class('coop-offer-start')
      .attr('data-answer', queue.answer)
      .attr(
        'aria-label',
        `Start with ${queue.offerPlayers} players. ${queue.accepted} said yes`,
      )
      .attr('aria-pressed', queue.answer === 'Accepted' ? 'true' : 'false')
      .on('click', CoopMessage.ClickedCoopAcceptOfferButton())
      .children(
        h.span
          .class('coop-offer-label')
          .children(`START WITH ${queue.offerPlayers}?`),
        h.span
          .class('coop-offer-heads')
          .attr('aria-hidden', 'true')
          .children(heads),
        keyCapView(inputs, 'ENTER', h),
      ),
    queue.answer === 'Accepted'
      ? null
      : h.button
          .attr('type', 'button')
          .class('coop-offer-wait')
          .attr('aria-label', 'Keep waiting for four')
          .on('click', CoopMessage.ClickedCoopKeepWaitingButton())
          .children(iconView('coop-offer-wait-icon', WAIT_ICON, h)),
  )
}

const queueView = (
  queue: Queue,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .key('queue')
    .class('coop-queue')
    .attr('data-answer', queue.answer)
    .children(
      closeButtonView(
        {
          button: h.button.on(
            'click',
            CoopMessage.ClickedCoopCancelQueueButton(),
          ),
          className: 'coop-close',
          label: 'Stop looking',
        },
        h,
      ),
      iconView('coop-queue-icon', QUICK_ICON, h),
      h.ol
        .class('coop-queue-seats')
        .attr(
          'aria-label',
          `${queue.waiting} of ${queue.groupSize} players here`,
        )
        .children(
          Array.map(Array.range(0, Math.max(1, queue.groupSize) - 1), seat =>
            queueSeatView(queue, inputs, seat, h),
          ),
        ),
      offerView(queue, inputs, h),
    )

const ROOM_CODE_COPIED = 'COPIED!'

const roomCodeView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.button
    .attr('type', 'button')
    .class('coop-room-code')
    .attr(
      'aria-label',
      `Room code ${Array.join(String.split('')(room.code), ' ')}${room.codeCopies > 0 ? ', copied' : ', tap to copy'}`,
    )
    .on('click', CoopMessage.ClickedCoopRoomCode())
    .children(
      ...Array.map(String.split('')(room.code), symbol =>
        h.span
          .class('coop-room-code-symbol')
          .attr('aria-hidden', 'true')
          .children(symbol),
      ),
      ...(room.codeCopies > 0
        ? [
            h.span
              .key(`copied-${room.codeCopies}`)
              .class('coop-room-code-copied')
              .attr('aria-hidden', 'true')
              .children(ROOM_CODE_COPIED),
          ]
        : []),
    )

const shareButtonView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.button
    .attr('type', 'button')
    .class('coop-share')
    .attr('data-share', room.share)
    .attr(
      'aria-label',
      room.share === 'Copied'
        ? 'Link copied'
        : 'I dare you: share the room link',
    )
    .on('click', CoopMessage.ClickedCoopShareButton())
    .children(
      iconView(
        'coop-share-icon',
        room.share === 'Idle' ? SHARE_ICON : CHECK_ICON,
        h,
      ),
      iconView('coop-share-link', LINK_ICON, h),
    )

const leaveButtonView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.button
    .attr('type', 'button')
    .class('coop-leave')
    .attr('aria-label', 'Leave the room')
    .disabled(room.departure === 'Leaving')
    .on('click', CoopMessage.ClickedCoopLeaveButton())
    .children(iconView('coop-leave-icon', LEAVE_ICON, h))

const seatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  seat: number,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === seat),
    {
      onNone: () =>
        h.li
          .key(`seat-${seat}`)
          .class('coop-seat')
          .attr('data-state', 'Empty')
          .attr('aria-label', 'Empty seat')
          .children(
            h.span
              .class('coop-seat-empty')
              .attr('aria-hidden', 'true')
              .children('+'),
            poofView('Leave', h),
          ),
      onSome: member => memberSeatView(room, lobby, inputs, member, h),
    },
  )

const seatLabelOf = (
  member: LobbyMember,
  { isMe, isTheHost }: Readonly<{ isMe: boolean; isTheHost: boolean }>,
): string => {
  const calling = callingOfMember(member)
  return Array.join(
    [
      member.name,
      ...(isMe ? ['you'] : []),
      ...(isTheHost ? ['host'] : []),
      `rank ${member.rank}`,
      ...(calling === 'You' ? [] : [CALLING_NAMES[calling]]),
      ...(member.ready ? ['ready'] : []),
    ],
    ', ',
  )
}

const crownClassOf = (room: Room): string =>
  Option.match(room.maybeNudge, {
    onNone: () => 'coop-crown',
    onSome: ({ reason, count }) =>
      reason === 'HostPicks'
        ? `coop-crown coop-crown-flash-${count % 2 === 0 ? 'a' : 'b'}`
        : 'coop-crown',
  })

const memberSeatView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  member: LobbyMember,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isMe = Option.exists(room.maybePlayerId, id => id === member.playerId)
  const isTheHost = lobby.host === member.playerId
  const canKick = isHost(room) && !isMe && lobby.status === 'Lobby'
  const label = seatLabelOf(member, { isMe, isTheHost })
  return h.li
    .key(member.playerId)
    .class('coop-seat')
    .attr('data-state', member.ready ? 'Ready' : 'Here')
    .attr('data-me', isMe ? 'Me' : 'Other')
    .attr('aria-label', label)
    .children(
      portraitView(
        lookOf(inputs, room, member.slot),
        'coop-seat-head',
        h,
        callingOfMember(member),
      ),
      poofView('Arrive', h),
      isTheHost ? iconView(crownClassOf(room), CROWN_ICON, h) : null,
      ...(isTheHost
        ? dareMarkBadgeView(lobby.dareMark, 'coop-seat-dare-mark', h)
        : []),
      member.ready
        ? h.span
            .class('coop-stamp')
            .attr('aria-hidden', 'true')
            .children(iconView('coop-stamp-icon', CHECK_ICON, h))
        : null,
      h.div
        .class('coop-nameline')
        .children(
          rankTagView('coop-rank', member.rank, 2, h),
          callingPropView('coop-calling', callingOfMember(member), h),
          isMe && lobby.status === 'Lobby'
            ? nameButtonView(member.name, h)
            : h.span
                .class('coop-nameplate')
                .attr('aria-hidden', 'true')
                .children(member.name),
        ),
      pingView(
        isMe && ownPingOf(room) > 0 ? ownPingOf(room) : member.pingMs,
        'coop-seat-ping',
        h,
      ),
      canKick
        ? h.button
            .attr('type', 'button')
            .class('coop-kick')
            .attr('aria-label', `Kick ${member.name}`)
            .attr('title', `Kick ${member.name}`)
            .on(
              'click',
              CoopMessage.ClickedCoopKickButton({ playerId: member.playerId }),
            )
            .children(
              iconView('coop-kick-icon', KICK_ICON, h),
              h.span
                .class('coop-kick-word')
                .attr('aria-hidden', 'true')
                .children('KICK'),
            )
        : null,
    )
}

const RESULT_ICONS: Readonly<Record<ClosedReason, string>> = {
  Won: TROPHY_ICON,
  LeftEarly: MISSION_ICONS.LeaveEarly,
  GameOver: SKULL_ICONS.Hard,
  EndedByHost: SKULL_ICONS.Hard,
  Abandoned: SKULL_ICONS.Hard,
  Interrupted: SKULL_ICONS.Hard,
}

const resultView = (
  room: Room,
  lobby: Lobby,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(lobby.result, {
    onNone: () => null,
    onSome: result =>
      h.div
        .class('coop-result')
        .attr('aria-label', 'Last run')
        .children(
          iconView('coop-result-icon', RESULT_ICONS[result.reason], h),
          h.ol.class('coop-result-scores').children(
            pipe(
              result.scores,
              Array.sort(BY_SCORE_DESCENDING),
              Array.map((score, index) =>
                h.li
                  .key(score.playerId)
                  .class('coop-result-score')
                  .attr('aria-label', scoreLabelOf(lobby, score, index))
                  .children(
                    index === 0 && score.score > 0
                      ? iconView('coop-result-crown', CROWN_ICON, h)
                      : null,
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
                    h.span
                      .attr('aria-hidden', 'true')
                      .children(`${score.score}`),
                  ),
              ),
            ),
          ),
        ),
  })

const scoreLabelOf = (
  lobby: Lobby,
  score: RoomScore,
  index: number,
): string => {
  const calling = callingAt(lobby, score.slot)
  return Array.join(
    [
      `${nameAt(lobby, score.slot)}: rank ${rankAt(lobby, score.slot)}`,
      ...(calling === 'You' ? [] : [CALLING_NAMES[calling]]),
      `${score.score}${index === 0 && score.score > 0 ? ', MVP' : ''}`,
    ],
    ', ',
  )
}

const BY_SCORE_DESCENDING = Order.flip(
  Order.mapInput(Order.Number, (score: RoomScore) => score.score),
)

const nameAt = (lobby: Lobby, slot: number): string =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: () => `Player ${slot + 1}`, onSome: member => member.name },
  )

const rankAt = (lobby: Lobby, slot: number): number =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: () => 1, onSome: member => member.rank },
  )

const callingAt = (lobby: Lobby, slot: number): Calling =>
  Option.match(
    Array.findFirst(lobby.members, member => member.slot === slot),
    { onNone: (): Calling => 'You', onSome: callingOfMember },
  )

const readyButtonView = (
  room: Room,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isReady = Option.exists(meIn(room), me => me.ready)
  return h.button
    .attr('type', 'button')
    .id(READY_BUTTON_ID)
    .ref(READY_BUTTON)
    .class('coop-ready')
    .attr('data-ready', isReady ? 'Ready' : 'NotReady')
    .attr('aria-pressed', isReady ? 'true' : 'false')
    .attr('aria-keyshortcuts', 'Enter')
    .disabled(Option.isNone(meIn(room)))
    .on('click', CoopMessage.ClickedCoopReadyButton())
    .children(
      h.span
        .class('coop-ready-face')
        .children(
          iconView('coop-ready-icon', CHECK_ICON, h),
          h.span.class('coop-ready-label').children('READY'),
        ),
      keyCapView(inputs, 'ENTER', h),
    )
}

const lobbyView = (
  room: Room,
  heroPick: HeroPick,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .key('lobby')
    .class('coop-lobby')
    .children(
      h.div
        .class('coop-lobby-top')
        .children(
          leaveButtonView(room, h),
          roomCodeView(room, h),
          shareButtonView(room, h),
        ),
      Option.match(room.maybeLobby, {
        onNone: () => askingView(RoomRequest.Create(), h),
        onSome: lobby =>
          h.ol
            .class('coop-seats')
            .attr('aria-label', 'Players')
            .children(
              Array.map(Array.range(0, MAX_PLAYERS - 1), seat =>
                seatView(room, lobby, inputs, seat, h),
              ),
            ),
      }),
      Option.match(room.maybeLobby, {
        onNone: () => null,
        onSome: lobby => resultView(room, lobby, inputs, h),
      }),
      Option.match(room.maybeLobby, {
        onNone: () => null,
        onSome: lobby =>
          picksView(
            room,
            {
              lobby,
              bestMark: bestMarkOn(inputs.dareMarks, lobby.difficulty),
              keyCapView: key => keyCapView(inputs, key, h),
            },
            h,
          ),
      }),
      h.div.class('coop-ready-row').children(
        Option.match(room.maybeLobby, {
          onNone: () => null,
          onSome: () =>
            heroPickView(
              room,
              {
                isPickerOpen: heroPick.isOpen,
                keyCapView: key => keyCapView(inputs, key, h),
              },
              h,
            ),
        }),
        readyButtonView(room, inputs, h),
      ),
      Option.match(meIn(room), {
        onNone: () => null,
        onSome: me =>
          heroPick.isOpen &&
          HeroPicker(h, {
            key: 'coop-hero-picker',
            props: {
              look: lookOf(inputs, room, me.slot),
              chosen: callingOfMember(me),
              trying: Option.getOrNull(heroPick.maybeTrying),
              rank: me.rank,
              bought: inputs.bought,
              bones: inputs.bones,
              fresh: [],
              layout: 'Overlay',
            },
            onEmit: {
              Picked: ({ calling }) => CoopMessage.PickedCoopHero({ calling }),
              RequestedBuy: ({ calling }) =>
                CoopMessage.RequestedBuyCoopHero({ calling }),
              RequestedClose: () => CoopMessage.RequestedCloseCoopHeroPicker(),
            },
          }),
      }),
      namePickerView(room, h),
    )

const countdownView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .key(
      `countdown-${Option.match(room.maybeLobby, { onNone: () => 0, onSome: lobby => lobby.round })}`,
    )
    .class('coop-countdown')
    .attr('aria-hidden', 'true')
    .children(
      Array.map(['3', '2', '1', 'GO!'], (word, index) =>
        h.span
          .key(word)
          .class('coop-countdown-word')
          .style({ animationDelay: `${index * 0.6}s` })
          .children(word),
      ),
    )

const awayView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  room.link === 'Reconnecting' || room.link === 'Lost'
    ? h.div
        .class('coop-away')
        .attr('role', 'status')
        .attr('aria-label', 'Reconnecting')
        .children(
          iconView('coop-away-icon', AWAY_ICON, h),
          room.link === 'Lost' ? lostView(room, h) : null,
        )
    : null

const lostView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div.class('coop-away-lost').children(
    h.p
      .class('coop-problem')
      .attr('role', 'alert')
      .children(
        iconView('coop-problem-icon', OFFLINE_ICON, h),
        h.span.children('LOST THE ROOM'),
      ),
    h.button
      .attr('type', 'button')
      .class('coop-leave')
      .attr('aria-label', 'Leave the room')
      .disabled(room.departure === 'Leaving')
      .on('click', CoopMessage.ClickedCoopLeaveButton())
      .children(
        iconView('coop-leave-icon', LEAVE_ICON, h),
        h.span.attr('aria-hidden', 'true').children('LEAVE'),
      ),
  )

const netView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const { stats } = room.session
  return h.div
    .class('coop-net')
    .attr('aria-hidden', 'true')
    .attr('data-rtt', `${Math.round(room.session.rttMs)}`)
    .attr('data-bytes-in', `${stats.bytesIn}`)
    .attr('data-frames-in', `${stats.framesIn}`)
    .attr('data-inputs-out', `${stats.inputsOut}`)
    .attr('data-since', `${stats.sinceMs}`)
    .attr('data-now', `${room.session.renderedMs}`)
    .attr('data-corrections', `${stats.corrections}`)
    .attr('data-correction-px', `${stats.maxCorrectionPx.toFixed(1)}`)
    .attr('data-stalls', `${stats.stalls}`)
    .attr('data-longest-stall', `${stats.longestStallMs}`)
    .attr('data-resyncs', `${stats.resyncs}`)
    .attr('data-slot', `${room.slot}`)
    .attr('data-looked-hits', `${room.hits.looked}`)
    .attr('data-confirmed-hits', `${room.hits.confirmed}`)
    .attr('data-delay', `${Math.round(room.session.interpolationMs)}`)
    .attr(
      'data-world',
      Option.match(room.maybeWorld, {
        onNone: () => '',
        onSome: readoutOf,
      }),
    )
}

const arenaPingsView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .class('coop-arena-pings')
    .attr('aria-label', 'Connections')
    .children(
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
          h.span
            .key(`ping-${slot}`)
            .class('coop-arena-ping')
            .style({ borderColor: seatColorOf(slot) })
            .children(
              pingView(
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
            ),
      ),
    )

const arenaView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.div
    .class('coop-arena')
    .children(
      countdownView(room, h),
      awayView(room, h),
      h.div
        .class('coop-arena-hud')
        .children(leaveButtonView(room, h), arenaPingsView(room, h)),
      netView(room, h),
    )

const roomView = (
  room: Room,
  heroPick: HeroPick,
  inputs: ViewInputs,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  if (inputs.isRunCardUp) {
    return null
  } else if (!isInLobby(room) || inputs.isRunEndComing) {
    return arenaView(room, h)
  } else {
    return lobbyView(room, heroPick, inputs, h)
  }
}

const roomScreenName = (room: Room, inputs: ViewInputs): string => {
  if (inputs.isRunCardUp) {
    return 'RunCard'
  } else {
    return isInLobby(room) && !inputs.isRunEndComing ? 'Lobby' : 'Arena'
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

export const coopScreenView: {
  (
    inputs: ViewInputs,
    h: ApplicationViewBuilder,
  ): (model: Model) => ApplicationHtml | null
  (
    model: Model,
    inputs: ViewInputs,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null
} = Function.dual(
  3,
  (
    model: Model,
    inputs: ViewInputs,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null =>
    Screen.isAnyOf(['Closed'])(model.screen)
      ? null
      : h.section
          .class('coop')
          .attr('data-screen', screenName(model, inputs))
          .attr('aria-label', 'Co-op')
          .children(
            Screen.match(model.screen, {
              Closed: () => null,
              Hub: ({ maybeProblem }) => hubView(maybeProblem, inputs, h),
              Code: ({ typed, maybeProblem }) =>
                codeView(typed, maybeProblem, h),
              Asking: ({ request }) => askingView(request, h),
              Queue: ({ queue }) => queueView(queue, inputs, h),
              InRoom: ({ room }) => roomView(room, model.heroPick, inputs, h),
            }),
          ),
)
