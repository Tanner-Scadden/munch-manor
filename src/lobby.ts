import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { DIFFICULTY_ORDER, isLocked } from './difficulty'
import { FOCUS_STEP_OFFSET } from './input'
import {
  type Difficulty,
  type HomeLobby,
  type HomeMode,
  type LobbyControl,
  type MapId,
  type Model,
} from './model'
import type { FocusStep } from './stepWorld'

// The single player lobby (GAME_DESIGN.md, "The single player lobby"): PLAY
// opens it, and it holds what a run is picked from, mirroring co-op's lobby.
// The rules here are pure; the Steps are in src/update/lobby.ts and the
// view in src/lobbyView.ts.

// CONTROLS

// NOTE: the order the arrow keys walk the lobby, one stop each.
const LOBBY_CONTROLS: Array.NonEmptyReadonlyArray<LobbyControl> = [
  'Back',
  'Hero',
  'Campaign',
  'Endless',
  'Easy',
  'Normal',
  'Hard',
  'Nightmare',
  'Start',
]

const LOBBY_CONTROL_IDS: Readonly<Record<LobbyControl, string>> = {
  Back: 'lobby-back',
  Hero: 'lobby-hero',
  Campaign: 'lobby-campaign',
  Endless: 'lobby-endless',
  Easy: 'lobby-easy',
  Normal: 'lobby-normal',
  Hard: 'lobby-hard',
  Nightmare: 'lobby-nightmare',
  Start: 'lobby-start',
}

export const lobbyControlId = (control: LobbyControl): string =>
  LOBBY_CONTROL_IDS[control]

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
} as const satisfies Readonly<Record<string, LobbyKey>>

// NOTE: with nothing focused yet the walk starts at START, the control a
// keyboard player wants most.
export const steppedLobbyFocus = (
  maybeFocus: Option.Option<LobbyControl>,
  step: FocusStep,
): LobbyControl =>
  Option.match(maybeFocus, {
    onNone: (): LobbyControl => 'Start',
    onSome: focused => {
      const index = Option.getOrElse(
        Array.findFirstIndex(LOBBY_CONTROLS, control => control === focused),
        () => 0,
      )
      const count = LOBBY_CONTROLS.length
      return Option.getOrElse(
        Array.get(
          LOBBY_CONTROLS,
          (index + FOCUS_STEP_OFFSET[step] + count) % count,
        ),
        (): LobbyControl => 'Start',
      )
    },
  })

// MODE AND DIFFICULTY

export const MODE_CONTROLS: Readonly<Record<HomeMode, LobbyControl>> = {
  Campaign: 'Campaign',
  Endless: 'Endless',
}

// NOTE: X steps to the next difficulty the player may pick, around the
// four, skipping a locked Nightmare.
export const nextDifficultyOf = (model: Model): Difficulty => {
  const from = Option.getOrElse(
    Array.findFirstIndex(
      DIFFICULTY_ORDER,
      level => level === model.difficulty.chosen,
    ),
    () => 0,
  )
  const count = DIFFICULTY_ORDER.length
  return pipe(
    Array.makeBy(count - 1, offset =>
      Array.get(DIFFICULTY_ORDER, (from + offset + 1) % count),
    ),
    Array.getSomes,
    Array.findFirst(level => !isLocked(model.difficulty, level)),
    Option.getOrElse(() => model.difficulty.chosen),
  )
}

// MAPS

// NOTE: the maps a run can be played on, as data: a new map is one more id
// here, its name in src/names.ts, and its picture in src/lobbyView.ts. The
// manor is the only one for now, so nothing is picked and the level logic
// (src/arena.ts) is untouched.
export const MAPS: Array.NonEmptyReadonlyArray<MapId> = ['Manor']

// STATE

export const withLobby = (model: Model, lobby: HomeLobby): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        lobby: () => lobby,
        maybeLobbyFocus: () => Option.none(),
      }),
  })
