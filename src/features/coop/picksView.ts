import { Array, Function, Option } from 'effect'

import type { Lobby, PickedMode, RoomDifficulty } from '@munch/netcode'

import type {
  ApplicationHtml,
  ApplicationViewBuilder,
} from '../../app/definition'
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
import { nextMarkOf } from '../../domain/dareMarks'
import { dareMarkFaceView, dareMarkLabel } from '../../ui/dareMarkView'
import { easyBreakFaceView, easyBreakLabel } from '../../ui/easyBreakView'
import { iconView, skullFaceViews } from '../../ui/menuParts'
import {
  bonusChipView,
  modifierFaceView,
  modifierLabel,
} from '../../ui/modifiersView'
import { CALLING_NAMES, MODE_NAMES } from '../../world/names'
import {
  isCoveredByMark,
  runBonusPercentOf,
  withMarkModifiers,
} from '../../world/run/dareLadder'
import {
  DIFFICULTIES,
  DIFFICULTY_ORDER,
  NIGHTMARE_LOCK_NOTE,
} from '../../world/run/difficulty'
import {
  MODIFIER_ORDER,
  type Modifier,
  isModifierOn,
  modifiersOfMask,
} from '../../world/run/modifiers'
import { CoopMessage } from './message'
import {
  CALLING_PILL,
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
const pickClick = (
  canPick: boolean,
  message: CoopMessage,
  reason: NudgeReason,
): CoopMessage =>
  canPick ? message : CoopMessage.ClickedCoopPickNudge({ reason })

const pickDisabled = (canPick: boolean): string | undefined =>
  canPick ? undefined : 'true'

const modePickView = (
  room: Room,
  lobby: Lobby,
  mode: PickedMode,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isChosen = pickedModeOf(lobby) === mode
  return h.button
    .key(mode)
    .attr('type', 'button')
    .class('coop-pick coop-mode-pick')
    .attr('data-mode', mode)
    .attr('data-state', isChosen ? 'Chosen' : 'Other')
    .attr('aria-pressed', String(isChosen ? 'true' : 'false'))
    .attr('aria-label', MODE_NAMES[mode])
    .attr('aria-disabled', pickDisabled(isPicking(room)))
    .on(
      'click',
      pickClick(
        isPicking(room),
        CoopMessage.ClickedCoopModePick({ mode }),
        'HostPicks',
      ),
    )
    .children(
      iconView('coop-pick-icon', MODE_PICK_ICONS[mode], h),
      mode === 'KeepGoing' ? iconView('coop-pick-badge', TROPHY_ICON, h) : null,
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
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isLit = skullIndexOf(difficulty) <= skullIndexOf(lobby.difficulty)
  const isLocked = !canPickDifficulty(lobby, difficulty)
  return h.button
    .key(difficulty)
    .attr('type', 'button')
    .class('coop-pick coop-skull-pick')
    .attr('data-difficulty', difficulty)
    .attr(
      'data-state',
      lobby.difficulty === difficulty ? 'Chosen' : isLit ? 'Lit' : 'Other',
    )
    .attr(
      'aria-pressed',
      String(lobby.difficulty === difficulty ? 'true' : 'false'),
    )
    .attr(
      'aria-label',
      isLocked
        ? `${DIFFICULTIES[difficulty].name}, locked`
        : DIFFICULTIES[difficulty].name,
    )
    .attr('aria-disabled', pickDisabled(isPicking(room) && !isLocked))
    .on(
      'click',
      pickClick(
        isPicking(room) && !isLocked,
        CoopMessage.ClickedCoopDifficultyPick({ difficulty }),
        isLocked ? 'Locked' : 'HostPicks',
      ),
    )
    .children(
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

// NOTE: Dare's break clock beside the skulls, on Dare alone: the host's
// press steps it, ∞ (none) first; a guest's tap says the host picks.
const easyBreakPickView = (
  room: Room,
  lobby: Lobby,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.button
    .key('easy-break')
    .attr('type', 'button')
    .class('coop-pick easy-break-pick')
    .attr('data-state', lobby.easyBreakSeconds > 0 ? 'On' : 'Off')
    .attr('aria-label', easyBreakLabel(lobby.easyBreakSeconds))
    .attr('aria-disabled', pickDisabled(isPicking(room)))
    .on(
      'click',
      pickClick(
        isPicking(room),
        CoopMessage.ClickedCoopEasyBreakPick(),
        'HostPicks',
      ),
    )
    .children(easyBreakFaceView(lobby.easyBreakSeconds, h))

// NOTE: the dare ladder's mark beside the skulls: the host's press steps it
// through the marks they have opened on the room's difficulty, round to
// none; a guest sees the room's mark, and a tap says the host picks. It
// shows once the host has a mark to pick, or the room has one.
const markPickView = (
  room: Room,
  lobby: Lobby,
  bestMark: number,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  h.button
    .key('dare-mark')
    .attr('type', 'button')
    .class('coop-pick dare-mark-pick')
    .attr('data-state', lobby.dareMark > 0 ? 'On' : 'Off')
    .attr('data-mark', `${lobby.dareMark}`)
    .attr('aria-label', dareMarkLabel(lobby.dareMark))
    .attr('aria-disabled', pickDisabled(isPicking(room)))
    .on(
      'click',
      pickClick(
        isPicking(room),
        CoopMessage.ClickedCoopDareMarkPick({
          mark: nextMarkOf(lobby.dareMark, bestMark),
        }),
        'HostPicks',
      ),
    )
    .children(dareMarkFaceView(lobby.dareMark, h))

const isMarkPickShown = (room: Room, lobby: Lobby, bestMark: number) =>
  lobby.dareMark > 0 || (isPicking(room) && bestMark > 0)

// NOTE: a run modifier is a tile the host turns on and off, lit when on. A
// guest sees the same tiles, still, and a tap says the host picks. One the
// room's mark turns on is lit and locked.
const modifierPickView = (
  room: Room,
  lobby: Lobby,
  modifier: Modifier,
  h: ApplicationViewBuilder,
): ApplicationHtml | null => {
  const isLockedOn = isCoveredByMark(lobby.dareMark, modifier)
  const isOn =
    isLockedOn || isModifierOn(modifiersOfMask(lobby.modifiers), modifier)
  return h.button
    .key(`modifier-${modifier}`)
    .attr('type', 'button')
    .class('coop-pick modifier-pick')
    .attr('data-modifier', modifier)
    .attr('data-state', isOn ? 'On' : 'Off')
    .attr('data-locked', isLockedOn ? 'Yes' : 'No')
    .attr('aria-pressed', String(isOn ? 'true' : 'false'))
    .attr(
      'aria-label',
      isLockedOn
        ? `${modifierLabel(modifier, isOn)}. Held by the dare mark`
        : modifierLabel(modifier, isOn),
    )
    .attr('aria-disabled', pickDisabled(isPicking(room) && !isLockedOn))
    .on(
      'click',
      pickClick(
        isPicking(room) && !isLockedOn,
        CoopMessage.ClickedCoopModifierPick({ modifier }),
        'HostPicks',
      ),
    )
    .children(modifierFaceView(modifier, h))
}

// NOTE: the note a tap on a pick that is not yours leaves: it fades in
// place over the picks (no movement), and a new tap starts it again.
const nudgeView = (
  room: Room,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(room.maybeNudge, {
    onNone: () => null,
    onSome: ({ reason, count }) =>
      h.span
        .key(`nudge-${count}`)
        .class('coop-nudge')
        .attr('data-reason', reason)
        .attr('role', 'status')
        .children(
          iconView(
            'coop-nudge-icon',
            reason === 'Locked' ? PADLOCK_ICON : CROWN_ICON,
            h,
          ),
          h.span.children(
            reason === 'Locked' ? NIGHTMARE_LOCK_NOTE : 'HOST PICKS',
          ),
        ),
  })

// NOTE: the hero pill beside the mode and difficulty picks: the player's own
// hero, which opens the hero picker over the lobby (src/features/heroes/),
// so a hero can change while the room waits. Every member has one, as the
// host alone picks the mode and difficulty.
const callingPillView = (
  room: Room,
  isPickerOpen: boolean,
  keyCap: ApplicationHtml | null,
  h: ApplicationViewBuilder,
): ApplicationHtml | null =>
  Option.match(meIn(room), {
    onNone: () => null,
    onSome: me => {
      const calling = callingOfMember(me)
      return h.button
        .attr('type', 'button')
        .id(CALLING_PILL_ID)
        .ref(CALLING_PILL)
        .class('coop-pick coop-calling-pill')
        .attr('data-calling', calling)
        .attr(
          'aria-label',
          `Hero: ${CALLING_NAMES[calling]}. ${specialsNoteOf(calling)}. Change it`,
        )
        .attr('aria-haspopup', 'dialog')
        .attr('aria-expanded', String(isPickerOpen))
        .attr('aria-keyshortcuts', 'Y')
        .on('click', CoopMessage.ClickedCoopCallingPill())
        .children(
          iconView('coop-calling-pill-icon', PROP_ICONS[calling], h),
          keyCap,
        )
    },
  })

// NOTE: an object type, not Readonly<...>, so the pipeable check matches the
// view's two signatures.
type PicksInput = {
  readonly lobby: Lobby
  readonly bestMark: number
  readonly keyCapView: (key: string) => ApplicationHtml | null
}

type HeroPickInput = {
  readonly isPickerOpen: boolean
  readonly keyCapView: (key: string) => ApplicationHtml | null
}

// NOTE: the hero pill in a group of its own, which the lobby sets beside
// READY rather than among the room's picks: it is every member's, and held
// upright it would otherwise take a row alone.
export const heroPickView: {
  (
    input: HeroPickInput,
    h: ApplicationViewBuilder,
  ): (room: Room) => ApplicationHtml | null
  (
    room: Room,
    input: HeroPickInput,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null
} = Function.dual(
  3,
  (
    room: Room,
    { isPickerOpen, keyCapView }: HeroPickInput,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null =>
    h.div
      .class('coop-pick-group coop-hero-pick')
      .attr('role', 'group')
      .attr('aria-label', 'Hero')
      .children(callingPillView(room, isPickerOpen, keyCapView('Y'), h)),
)

export const picksView: {
  (
    input: PicksInput,
    h: ApplicationViewBuilder,
  ): (room: Room) => ApplicationHtml | null
  (
    room: Room,
    input: PicksInput,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null
} = Function.dual(
  3,
  (
    room: Room,
    { lobby, bestMark, keyCapView }: PicksInput,
    h: ApplicationViewBuilder,
  ): ApplicationHtml | null =>
    h.div
      .class('coop-picks')
      .attr('data-host', isPicking(room) ? 'Picking' : 'Watching')
      .attr(
        'aria-label',
        `${MODE_NAMES[pickedModeOf(lobby)]}, ${DIFFICULTIES[lobby.difficulty].name}`,
      )
      .children(
        h.div
          .class('coop-pick-group')
          .attr('role', 'group')
          .attr('aria-label', 'Mode')
          .children(
            ...Array.map(
              Array.filter(MODE_PICKS, mode => canPickMode(lobby, mode)),
              mode => modePickView(room, lobby, mode, h),
            ),
            isPicking(room) ? keyCapView('E') : null,
          ),
        h.div
          .class('coop-pick-group coop-skulls')
          .attr('role', 'group')
          .attr('aria-label', 'Difficulty')
          .children(
            ...Array.map(DIFFICULTY_ORDER, difficulty =>
              skullPickView(room, lobby, difficulty, h),
            ),
            isPicking(room) ? keyCapView('X') : null,
            isMarkPickShown(room, lobby, bestMark)
              ? markPickView(room, lobby, bestMark, h)
              : null,
            lobby.difficulty === 'Easy'
              ? easyBreakPickView(room, lobby, h)
              : null,
          ),
        h.div
          .class('coop-pick-group modifier-group')
          .attr('role', 'group')
          .attr('aria-label', 'Modifiers')
          .children(
            ...Array.map(MODIFIER_ORDER, modifier =>
              modifierPickView(room, lobby, modifier, h),
            ),
            bonusChipView(
              runBonusPercentOf(
                withMarkModifiers(
                  modifiersOfMask(lobby.modifiers),
                  lobby.dareMark,
                ),
                lobby.dareMark,
              ),
              h,
            ),
          ),
        nudgeView(room, h),
      ),
)
