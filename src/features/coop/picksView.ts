import { Array, Function, Option } from 'effect'
import type { Html } from 'foldkit/html'

import type { Lobby, PickedMode, RoomDifficulty } from '@munch/netcode'

import { PROP_ICONS } from '../../art/callingArt'
import { CROWN_ICON } from '../../art/coopIcons'
import {
  CAMPAIGN_ICON,
  ENDLESS_ICON,
  PADLOCK_ICON,
  SKULL_ICONS,
  SKULL_OFF_ICON,
  TROPHY_ICON,
} from '../../art/icons'
import { callingOfMember } from '../../art/seatLooks'
import { specialsNoteOf } from '../../domain/callingSpecials'
import type { NudgeReason, Room } from '../../domain/coopRoom'
import { iconView, skullFaceViews } from '../../ui/menuParts'
import {
  bonusChipView,
  modifierFaceView,
  modifierLabel,
} from '../../ui/modifiersView'
import { CALLING_NAMES, MODE_NAMES } from '../../world/names'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
} from '../../world/run/difficulty'
import {
  MODIFIER_ORDER,
  type Modifier,
  bonusPercentOf,
  isModifierOn,
  modifiersOfMask,
} from '../../world/run/modifiers'
import type { CoopViewBuilder } from './composition'
import { Message } from './message'
import {
  CALLING_PILL_ID,
  MODE_PICKS,
  canPickDifficulty,
  canPickMode,
  isPicking,
  meIn,
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
  h: CoopViewBuilder,
) =>
  canPick
    ? [h.OnClick(message)]
    : [h.AriaDisabled(true), h.OnClick(Message.ClickedPickNudge({ reason }))]

const modePickView = (
  room: Room,
  lobby: Lobby,
  mode: PickedMode,
  h: CoopViewBuilder,
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
  h: CoopViewBuilder,
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
    skullFaceViews(
      {
        className: 'coop-pick-icon',
        icon: isLit ? SKULL_ICONS[lobby.difficulty] : SKULL_OFF_ICON,
        isLocked,
      },
      h,
    ),
  )
}

// NOTE: a run modifier is a tile the host turns on and off, lit when on. A
// guest sees the same tiles, still, and a tap says the host picks.
const modifierPickView = (
  room: Room,
  lobby: Lobby,
  modifier: Modifier,
  h: CoopViewBuilder,
): Html => {
  const isOn = isModifierOn(modifiersOfMask(lobby.modifiers), modifier)
  return h.keyed('button')(
    `modifier-${modifier}`,
    [
      h.Type('button'),
      h.Class('coop-pick modifier-pick'),
      h.DataAttribute('modifier', modifier),
      h.DataAttribute('state', isOn ? 'On' : 'Off'),
      h.AriaPressed(isOn ? 'true' : 'false'),
      h.AriaLabel(modifierLabel(modifier, isOn)),
      ...pickAttributes(
        isPicking(room),
        Message.ClickedModifierPick({ modifier }),
        'HostPicks',
        h,
      ),
    ],
    modifierFaceView(modifier, h),
  )
}

// NOTE: the note a tap on a pick that is not yours leaves: it fades in
// place over the picks (no movement), and a new tap starts it again.
const nudgeView = (room: Room, h: CoopViewBuilder): Html =>
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

// NOTE: the hero pill beside the mode and difficulty picks: the player's own
// hero, which opens the hero picker over the lobby (src/features/heroes/),
// so a hero can change while the room waits. Every member has one, as the
// host alone picks the mode and difficulty.
const callingPillView = (
  room: Room,
  isPickerOpen: boolean,
  keyCap: Html,
  h: CoopViewBuilder,
): Html =>
  Option.match(meIn(room), {
    onNone: () => h.empty,
    onSome: me => {
      const calling = callingOfMember(me)
      return h.button(
        [
          h.Type('button'),
          h.Id(CALLING_PILL_ID),
          h.Class('coop-pick coop-calling-pill'),
          h.DataAttribute('calling', calling),
          h.AriaLabel(
            `Hero: ${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}. Change it`,
          ),
          h.AriaHasPopup('dialog'),
          h.AriaExpanded(isPickerOpen),
          h.AriaKeyshortcuts('Y'),
          h.OnClick(Message.ClickedCallingPill()),
        ],
        [iconView('coop-calling-pill-icon', PROP_ICONS[calling], h), keyCap],
      )
    },
  })

// NOTE: an object type, not Readonly<...>, so the pipeable check matches the
// view's two signatures.
type PicksInput = {
  readonly lobby: Lobby
  readonly keyCapView: (key: string) => Html
}

type HeroPickInput = {
  readonly isPickerOpen: boolean
  readonly keyCapView: (key: string) => Html
}

// NOTE: the hero pill in a group of its own, which the lobby sets beside
// READY rather than among the room's picks: it is every member's, and held
// upright it would otherwise take a row alone.
export const heroPickView: {
  (input: HeroPickInput, h: CoopViewBuilder): (room: Room) => Html
  (room: Room, input: HeroPickInput, h: CoopViewBuilder): Html
} = Function.dual(
  3,
  (
    room: Room,
    { isPickerOpen, keyCapView }: HeroPickInput,
    h: CoopViewBuilder,
  ): Html =>
    h.div(
      [
        h.Class('coop-pick-group coop-hero-pick'),
        h.Role('group'),
        h.AriaLabel('Hero'),
      ],
      [callingPillView(room, isPickerOpen, keyCapView('Y'), h)],
    ),
)

export const picksView: {
  (input: PicksInput, h: CoopViewBuilder): (room: Room) => Html
  (room: Room, input: PicksInput, h: CoopViewBuilder): Html
} = Function.dual(
  3,
  (room: Room, { lobby, keyCapView }: PicksInput, h: CoopViewBuilder): Html =>
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
          [
            h.Class('coop-pick-group modifier-group'),
            h.Role('group'),
            h.AriaLabel('Modifiers'),
          ],
          [
            ...Array.map(MODIFIER_ORDER, modifier =>
              modifierPickView(room, lobby, modifier, h),
            ),
            bonusChipView(bonusPercentOf(modifiersOfMask(lobby.modifiers)), h),
          ],
        ),
        nudgeView(room, h),
      ],
    ),
)
