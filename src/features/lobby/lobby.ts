import { Array, Function, Option, pipe } from 'effect'

import type { HomeMode } from '../../domain/clientSchema'
import { FOCUS_STEP_OFFSET, type FocusStep } from '../../input/input'
import type { MapId } from '../../shared/nameKeys'
import type { Difficulty } from '../../shared/playerData'
import { DIFFICULTY_ORDER, isLocked } from '../../world/run/difficulty'
import { MODIFIER_ORDER, type Modifier } from '../../world/run/modifiers'
import type { DifficultySetting } from '../../world/schema/worldSchema'
import type { LobbyControl, LobbyPicks } from './model'

// The single player lobby (GAME_DESIGN.md, "The single player lobby"): PLAY
// opens it, and it holds what a run is picked from, mirroring co-op's lobby.
// The rules here are pure; the Block's Steps are in
// src/features/lobby/steps.ts and its view in src/features/lobby/view.ts.

// CONTROLS

// NOTE: the order the arrow keys walk the lobby, one stop each. Each crew
// seat is a stop (the + BOT tile, or the bot's hero card), and a seated bot's
// x is another.
export const SEATS: ReadonlyArray<readonly [LobbyControl, LobbyControl]> = [
  ['Bot1', 'Drop1'],
  ['Bot2', 'Drop2'],
  ['Bot3', 'Drop3'],
]

// NOTE: Dare's break clock is a stop only while Dare is picked, as only
// then is it drawn.
const modeAndDifficultyControlsOf = (
  picks: LobbyPicks,
): ReadonlyArray<LobbyControl> => [
  'Campaign',
  'Endless',
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
  ...(isEasyBreakShown(picks) ? ['EasyBreak' as const] : []),
  ...MODIFIER_ORDER,
  'Start',
]

// NOTE: the stops of a lobby with these picks: its seated bots, and Dare's
// break clock when it shows.
const lobbyControlsOf = (
  picks: LobbyPicks,
): Array.NonEmptyReadonlyArray<LobbyControl> => {
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
  EasyBreak: 'lobby-easy-break',
  FriendlyFire: 'lobby-friendly-fire',
  BigCrowd: 'lobby-big-crowd',
  Broke: 'lobby-broke',
  Glass: 'lobby-glass',
  Start: 'lobby-start',
}

export const lobbyControlId = (control: LobbyControl): string =>
  LOBBY_CONTROL_IDS[control]

// NOTE: the Dialog the hero picker opens in, over the lobby.
export const HERO_DIALOG_ID = 'lobby-hero-dialog'

type LobbyKey = Readonly<{ code: string; cap: string; name: string }>

// NOTE: one key per action. Enter starts, as PLAY did, and Esc goes back.
// E, X, and Y kept the keys the home menu's mode, difficulty, and hero
// pills had, now that the pills are here.
export const LOBBY_KEYS = {
  Start: { code: 'Enter', cap: 'ENTER', name: 'Enter' },
  Back: { code: 'Escape', cap: 'ESC', name: 'Escape' },
  Mode: { code: 'KeyE', cap: 'E', name: 'E' },
  Difficulty: { code: 'KeyX', cap: 'X', name: 'X' },
  Hero: { code: 'KeyY', cap: 'Y', name: 'Y' },
  Bot: { code: 'KeyB', cap: 'B', name: 'B' },
} as const satisfies Readonly<Record<string, LobbyKey>>

// NOTE: with nothing focused yet the walk starts at START, the control a
// keyboard player wants most.
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

// MODE AND DIFFICULTY

export const MODE_CONTROLS: Readonly<Record<HomeMode, LobbyControl>> = {
  Campaign: 'Campaign',
  Endless: 'Endless',
}

// NOTE: X steps to the next difficulty the player may pick, around the
// four, skipping a locked Nightmare.
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

// BOTS

// NOTE: whether a bot sits in the crew: as many as the seats leave
// (src/domain/bots.ts, botSeatsFor).
const hasSeatedBot = (picks: LobbyPicks): boolean =>
  Array.isReadonlyArrayNonEmpty(Array.take(picks.bots, picks.botSeats))

// DARE'S BREAK CLOCK

// NOTE: on Dare the lobby picks the break's clock, none by default (owner,
// 2026-11-12); the difficulties above keep their own.
export const isEasyBreakShown = (picks: LobbyPicks): boolean =>
  picks.difficulty.chosen === 'Easy'

// MODIFIERS

// NOTE: Friendly Fire needs a teammate to hit, so it is dim and cannot be
// turned on until a bot sits in the crew. The rest are always there.
export const isModifierPickable: {
  (modifier: Modifier): (picks: LobbyPicks) => boolean
  (picks: LobbyPicks, modifier: Modifier): boolean
} = Function.dual(
  2,
  (picks: LobbyPicks, modifier: Modifier): boolean =>
    modifier !== 'FriendlyFire' || hasSeatedBot(picks),
)

// MAPS

// NOTE: the maps a run can be played on, as data: a new map is one more id
// here, its name in src/world/names.ts, and its picture in
// src/features/lobby/view.ts. The manor is the only one for now, so nothing
// is picked and the level logic (src/world/level/arena.ts) is untouched.
export const MAPS: Array.NonEmptyReadonlyArray<MapId> = ['Manor']
