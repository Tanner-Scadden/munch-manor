import { Array, Option } from 'effect'
import type { Html, HtmlBuilder } from 'foldkit/html'

import type { Lobby, PickedMode, RoomDifficulty } from '@munch/netcode'

import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
} from '../difficulty'
import {
  CAMPAIGN_ICON,
  ENDLESS_ICON,
  PADLOCK_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
  TROPHY_ICON,
} from '../icons'
import { iconView } from '../menuParts'
import { MODE_NAMES } from '../names'
import { callingPillView } from './callingPicker'
import { CROWN_ICON } from './icons'
import { Message } from './message'
import type { NudgeReason, Room } from './model'
import {
  MODE_PICKS,
  canPickDifficulty,
  canPickMode,
  isPicking,
  pickedModeOf,
} from './roomState'

// PICKS

const MODE_PICK_ICONS: Readonly<Record<PickedMode, string>> = {
  Campaign: CAMPAIGN_ICON,
  Endless: ENDLESS_ICON,
  KeepGoing: ENDLESS_ICON,
}

// NOTE: a pick the host can change is a button; everyone else sees the
// same icons, still, with the picked one lit.
// A pick that is not yours to change still answers a tap: it says why
// (the host picks, or Nightmare is locked), in place.
const pickAttributes = (
  canPick: boolean,
  message: Message,
  reason: NudgeReason,
  h: HtmlBuilder<Message>,
) =>
  canPick
    ? [h.OnClick(message)]
    : [h.AriaDisabled(true), h.OnClick(Message.ClickedPickNudge({ reason }))]

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
      ...pickAttributes(
        isPicking(room),
        Message.ClickedModePick({ mode }),
        'HostPicks',
        h,
      ),
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
        isLocked ? 'Locked' : 'HostPicks',
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

// NOTE: the note a tap on a pick that is not yours leaves: it fades in
// place over the picks (no movement), and a new tap starts it again.
const nudgeView = (room: Room, h: HtmlBuilder<Message>): Html =>
  Option.match(room.maybeNudge, {
    onNone: () => h.empty,
    onSome: ({ reason, count }) =>
      h.keyed('span')(
        `nudge-${count}`,
        [
          h.Class('coop-nudge'),
          h.DataAttribute('reason', reason),
          h.Role('status'),
        ],
        [
          iconView(
            'coop-nudge-icon',
            reason === 'Locked' ? PADLOCK_ICON : CROWN_ICON,
            h,
          ),
          h.span(
            [],
            [reason === 'Locked' ? NIGHTMARE_LOCK_NOTE : 'HOST PICKS'],
          ),
        ],
      ),
  })

export const picksView = (
  room: Room,
  lobby: Lobby,
  keyCapView: (key: string) => Html,
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
          isPicking(room) ? keyCapView('E') : h.empty,
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
          isPicking(room) ? keyCapView('X') : h.empty,
        ],
      ),
      h.div(
        [h.Class('coop-pick-group'), h.Role('group'), h.AriaLabel('Hero')],
        [callingPillView(room, [keyCapView('Y')], h)],
      ),
      nudgeView(room, h),
    ],
  )
