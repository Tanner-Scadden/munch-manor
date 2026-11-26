import { Array, Function, Option, pipe } from 'effect'

import type { HomeMode } from '#domain/clientSchema.ts'
import { FOCUS_STEP_OFFSET, type FocusStep } from '#input/input.ts'
import type { MapId } from '#shared/nameKeys.ts'
import type { Difficulty } from '#shared/records/playerData.ts'
import {
  isCoveredByMark,
  runBonusPercentOf,
  withMarkModifiers,
} from '#world/run/dareLadder.ts'
import { DIFFICULTY_ORDER, isLocked } from '#world/run/difficulty.ts'
import {
  MODIFIER_ORDER,
  type Modifier,
  isModifierOn,
} from '#world/run/modifiers.ts'
import type { DifficultySetting } from '#world/schema/worldSchema.ts'

import type { LobbyControl, LobbyPicks } from './model.ts'

export const SEATS: ReadonlyArray<readonly [LobbyControl, LobbyControl]> = [
  ['Bot1', 'Drop1'],
  ['Bot2', 'Drop2'],
  ['Bot3', 'Drop3'],
]

const modeAndDifficultyControlsOf = (
  picks: LobbyPicks,
): ReadonlyArray<LobbyControl> => [
  'Campaign',
  'Endless',
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
  ...(isMarkShown(picks) ? ['Mark' as const] : []),
  ...(isEasyBreakShown(picks) ? ['EasyBreak' as const] : []),
  ...MODIFIER_ORDER,
  'Start',
]

export const isLockedByDare = (picks: LobbyPicks): boolean =>
  picks.lock === 'FriendsDare'

const lobbyControlsOf = (
  picks: LobbyPicks,
): Array.NonEmptyReadonlyArray<LobbyControl> => {
  if (isLockedByDare(picks)) {
    return ['Back', 'Hero', 'Start']
  }
  const botCount = picks.bots.length
  return [
    'Back',
    'Hero',
    ...Array.flatMap(SEATS, ([seat, drop], index) =>
      index < botCount ? [seat, drop] : index === botCount ? [seat] : [],
    ),
    ...modeAndDifficultyControlsOf(picks),
  ]
}

const LOBBY_CONTROL_IDS: Readonly<Record<LobbyControl, string>> = {
  Back: 'lobby-back',
  Hero: 'lobby-hero',
  Bot1: 'lobby-bot-1',
  Drop1: 'lobby-drop-1',
  Bot2: 'lobby-bot-2',
  Drop2: 'lobby-drop-2',
  Bot3: 'lobby-bot-3',
  Drop3: 'lobby-drop-3',
  Campaign: 'lobby-campaign',
  Endless: 'lobby-endless',
  Easy: 'lobby-easy',
  Normal: 'lobby-normal',
  Hard: 'lobby-hard',
  Nightmare: 'lobby-nightmare',
  Mark: 'lobby-mark',
  EasyBreak: 'lobby-easy-break',
  FriendlyFire: 'lobby-friendly-fire',
  BigCrowd: 'lobby-big-crowd',
  Broke: 'lobby-broke',
  Glass: 'lobby-glass',
  Start: 'lobby-start',
}

export const lobbyControlId = (control: LobbyControl): string =>
  LOBBY_CONTROL_IDS[control]

export const HERO_DIALOG_ID = 'lobby-hero-dialog'

type LobbyKey = Readonly<{ code: string; cap: string; name: string }>

export const LOBBY_KEYS = {
  Start: { code: 'Enter', cap: 'ENTER', name: 'Enter' },
  Back: { code: 'Escape', cap: 'ESC', name: 'Escape' },
  Mode: { code: 'KeyE', cap: 'E', name: 'E' },
  Difficulty: { code: 'KeyX', cap: 'X', name: 'X' },
  Hero: { code: 'KeyY', cap: 'Y', name: 'Y' },
  Bot: { code: 'KeyB', cap: 'B', name: 'B' },
} as const satisfies Readonly<Record<string, LobbyKey>>

export const steppedLobbyFocus: {
  (
    step: FocusStep,
    picks: LobbyPicks,
  ): (maybeFocus: Option.Option<LobbyControl>) => LobbyControl
  (
    maybeFocus: Option.Option<LobbyControl>,
    step: FocusStep,
    picks: LobbyPicks,
  ): LobbyControl
} = Function.dual(
  3,
  (
    maybeFocus: Option.Option<LobbyControl>,
    step: FocusStep,
    picks: LobbyPicks,
  ): LobbyControl =>
    Option.match(maybeFocus, {
      onNone: (): LobbyControl => 'Start',
      onSome: focused => {
        const controls = lobbyControlsOf(picks)
        const index = Option.getOrElse(
          Array.findFirstIndex(controls, control => control === focused),
          () => 0,
        )
        const count = controls.length
        return Option.getOrElse(
          Array.get(
            controls,
            (index + FOCUS_STEP_OFFSET[step] + count) % count,
          ),
          (): LobbyControl => 'Start',
        )
      },
    }),
)

export const MODE_CONTROLS: Readonly<Record<HomeMode, LobbyControl>> = {
  Campaign: 'Campaign',
  Endless: 'Endless',
}

export const nextDifficultyOf = (setting: DifficultySetting): Difficulty => {
  const from = Option.getOrElse(
    Array.findFirstIndex(DIFFICULTY_ORDER, level => level === setting.chosen),
    () => 0,
  )
  const count = DIFFICULTY_ORDER.length
  return pipe(
    Array.makeBy(count - 1, offset =>
      Array.get(DIFFICULTY_ORDER, (from + offset + 1) % count),
    ),
    Array.getSomes,
    Array.findFirst(level => !isLocked(setting, level)),
    Option.getOrElse(() => setting.chosen),
  )
}

const hasSeatedBot = (picks: LobbyPicks): boolean =>
  Array.isReadonlyArrayNonEmpty(Array.take(picks.bots, picks.botSeats))

export const isEasyBreakShown = (picks: LobbyPicks): boolean =>
  picks.difficulty.chosen === 'Easy'

export const isMarkShown = (picks: LobbyPicks): boolean => picks.bestMark > 0

export const isModifierLocked: {
  (modifier: Modifier): (picks: LobbyPicks) => boolean
  (picks: LobbyPicks, modifier: Modifier): boolean
} = Function.dual(2, (picks: LobbyPicks, modifier: Modifier): boolean =>
  isCoveredByMark(picks.dareMark, modifier),
)

export const isModifierPickable: {
  (modifier: Modifier): (picks: LobbyPicks) => boolean
  (picks: LobbyPicks, modifier: Modifier): boolean
} = Function.dual(
  2,
  (picks: LobbyPicks, modifier: Modifier): boolean =>
    !isModifierLocked(picks, modifier) &&
    (modifier !== 'FriendlyFire' || hasSeatedBot(picks)),
)

export const picksBonusPercentOf = (picks: LobbyPicks): number => {
  const modifiers = withMarkModifiers(picks.modifiers, picks.dareMark)
  return runBonusPercentOf(
    {
      ...modifiers,
      friendlyFire: modifiers.friendlyFire && hasSeatedBot(picks),
    },
    picks.dareMark,
  )
}

export const isModifierShownOn: {
  (modifier: Modifier): (picks: LobbyPicks) => boolean
  (picks: LobbyPicks, modifier: Modifier): boolean
} = Function.dual(
  2,
  (picks: LobbyPicks, modifier: Modifier): boolean =>
    isModifierOn(picks.modifiers, modifier) ||
    isModifierLocked(picks, modifier),
)

export const MAPS: Array.NonEmptyReadonlyArray<MapId> = ['Manor']
