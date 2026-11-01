import { Array, Option, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { maybeNewestNewsDay } from './changelog'
import { FEEDBACK_LINE, RESTART_GRACE_MS } from './constants'
import { IS_COOP_RELEASED } from './coop/release'
import { hasJustWon } from './difficulty'
import {
  type DifficultyBests,
  type HandCard,
  type HomeButton,
  type HomeMode,
  type KillCounts,
  type Model,
  MunchopediaPage,
  Phase,
  RunMode,
  RunTally,
  type ZombieKind,
} from './model'
import { isDiscovered, newlyDiscovered } from './munchopedia'
import { freshRun } from './runReset'
import { addKills, killTotal, killsSince } from './stats'
import type { FocusStep } from './stepWorld'
import type { Difficulty } from './worldSchema'

// BUTTONS

// NOTE: the home layout. Arrow keys walk PLAY, the mode, the difficulty,
// CO-OP, the MANOR button, the coffee, then the gear. Everything else lives
// in the MANOR hand, so a new feature is a new card there and PLAY never
// moves. CO-OP joins only in builds where co-op is released
// (src/coop/release.ts), and the coffee only while a support link is set
// (homeButtonsOf).
export const HOME_BUTTONS: Array.NonEmptyReadonlyArray<HomeButton> =
  IS_COOP_RELEASED
    ? [
        'Play',
        'Mode',
        'Difficulty',
        'Calling',
        'Coop',
        'Manor',
        'Support',
        'Settings',
      ]
    : ['Play', 'Mode', 'Difficulty', 'Calling', 'Manor', 'Support', 'Settings']

const HOME_BUTTON_IDS: Readonly<Record<HomeButton, string>> = {
  Play: 'home-play',
  Mode: 'home-mode',
  Difficulty: 'home-difficulty',
  Calling: 'home-calling',
  Coop: 'home-coop',
  Manor: 'home-manor',
  Support: 'home-support',
  Settings: 'home-settings',
}

export const isSupportShown = (model: Model): boolean =>
  Option.isSome(model.maybeSupportUrl)

// NOTE: the buttons the home menu draws, in arrow key order.
export const homeButtonsOf = (model: Model): ReadonlyArray<HomeButton> =>
  isSupportShown(model)
    ? HOME_BUTTONS
    : Array.filter(HOME_BUTTONS, button => button !== 'Support')

type HomeKey = Readonly<{ code: string; cap: string; name: string }>

// NOTE: one key per action. Enter, E, C, L, Z, I, and O were already the
// home keys. X picks the difficulty, Y the calling, J joins up for co-op, V opens the
// MANOR hand, and B buys Rattles a coffee, letters no other screen uses, so
// WASD, R, Q, T, G, H, K, M, and N keep their one meaning.
export const HOME_KEYS: Readonly<Record<HomeButton, HomeKey>> = {
  Play: { code: 'Enter', cap: 'ENTER', name: 'Enter' },
  Mode: { code: 'KeyE', cap: 'E', name: 'E' },
  Difficulty: { code: 'KeyX', cap: 'X', name: 'X' },
  Calling: { code: 'KeyY', cap: 'Y', name: 'Y' },
  Coop: { code: 'KeyJ', cap: 'J', name: 'J' },
  Manor: { code: 'KeyV', cap: 'V', name: 'V' },
  Support: { code: 'KeyB', cap: 'B', name: 'B' },
  Settings: { code: 'KeyO', cap: 'O', name: 'O' },
}

export const isModeKey = (code: string): boolean => code === HOME_KEYS.Mode.code

export const isDifficultyKey = (code: string): boolean =>
  code === HOME_KEYS.Difficulty.code

export const isCallingKey = (code: string): boolean =>
  code === HOME_KEYS.Calling.code

export const isCoopKey = (code: string): boolean => code === HOME_KEYS.Coop.code

export const isManorKey = (code: string): boolean =>
  code === HOME_KEYS.Manor.code

export const isSupportKey = (code: string): boolean =>
  code === HOME_KEYS.Support.code

export const isSettingsKey = (code: string): boolean =>
  code === HOME_KEYS.Settings.code

export const homeButtonId = (button: HomeButton): string =>
  HOME_BUTTON_IDS[button]

// THE MANOR HAND

// NOTE: the order the cards are dealt, left to right. A future feature, such
// as the cosmetic shop or the co-op lobby, is one more card here.
export const HAND_CARDS: Array.NonEmptyReadonlyArray<HandCard> = [
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
  'Code',
]

// NOTE: the link card opens a page in a new tab, so it has no key and no
// dialog.
export type LinkHandCard = Extract<HandCard, 'Code'>
export type KeyedHandCard = Exclude<HandCard, LinkHandCard>

export const isLinkHandCard = (card: HandCard): card is LinkHandCard =>
  card === 'Code'

// NOTE: the game's public source, for the Code card.
export const SOURCE_URL = 'https://github.com/Tanner-Scadden/munch-manor'

// NOTE: every card but the links keeps the key its rail button had, and the
// key works straight from the menu without opening the hand.
export const HAND_KEYS: Readonly<Record<KeyedHandCard, HomeKey>> = {
  Character: { code: 'KeyC', cap: 'C', name: 'C' },
  Munchopedia: { code: 'KeyZ', cap: 'Z', name: 'Z' },
  WhatsNew: { code: 'KeyL', cap: 'L', name: 'L' },
  HowToPlay: { code: 'KeyI', cap: 'I', name: 'I' },
}

export const KEYED_HAND_CARDS: ReadonlyArray<KeyedHandCard> = [
  'Character',
  'Munchopedia',
  'WhatsNew',
  'HowToPlay',
]

export const maybeHandCardOfKey = (
  code: string,
): Option.Option<KeyedHandCard> =>
  Array.findFirst(KEYED_HAND_CARDS, card => HAND_KEYS[card].code === code)

export const handCardId = (card: HandCard): string =>
  `hand-card-${card.toLowerCase()}`

export const steppedHandCard = (
  cards: ReadonlyArray<HandCard>,
  from: HandCard,
  step: number,
): Option.Option<HandCard> =>
  Option.flatMap(
    Array.findFirstIndex(cards, card => card === from),
    index => Array.get(cards, (index + step + cards.length) % cards.length),
  )

export const RESET_TUTORIAL_BUTTON_ID = 'reset-tutorial'
export const KEEP_TUTORIAL_BUTTON_ID = 'keep-tutorial'

const STEP_OFFSET: Readonly<Record<FocusStep, number>> = {
  Previous: -1,
  Next: 1,
}

export const steppedHomeFocus = (
  buttons: ReadonlyArray<HomeButton>,
  maybeFocus: Option.Option<HomeButton>,
  step: FocusStep,
): HomeButton => {
  const first = Array.headNonEmpty(HOME_BUTTONS)
  return Option.match(maybeFocus, {
    onNone: () => first,
    onSome: focused => {
      const index = pipe(
        Array.findFirstIndex(buttons, button => button === focused),
        Option.getOrElse(() => 0),
      )
      const count = buttons.length
      return pipe(
        Array.get(buttons, (index + STEP_OFFSET[step] + count) % count),
        Option.getOrElse(() => first),
      )
    },
  })
}

// HOME

export const isOnHome = Phase.isAnyOf(['Ready'])

// CORNER

// NOTE: a newer build waits on the home menu only, never mid-run.
export const isUpdateGiftShown = (model: Model): boolean =>
  Option.isSome(model.maybeNewerBuild) && isOnHome(model.phase)

const isInstalled = (model: Model): boolean =>
  model.screenFit === 'Installed' || model.installOffer === 'Installed'

// NOTE: the install tile is for a browser that can put the game on the Home
// Screen: one that offered Chrome's install prompt, or an iPhone, which can
// only do it by hand. Installed, or with no way to install, it hides.
export const isInstallTileShown = (model: Model): boolean =>
  isOnHome(model.phase) &&
  !isInstalled(model) &&
  (model.installOffer === 'Ready' || model.screenFit === 'HomeScreen')

// MODE

export const runModeOf = (mode: HomeMode): RunMode =>
  mode === 'Campaign' ? RunMode.Campaign() : RunMode.Endless()

export const switchMode = (model: Model): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        mode: mode => (mode === 'Campaign' ? 'Endless' : 'Campaign'),
      }),
  })

// WHAT'S NEW

export const isNewsUnseen = (model: Model): boolean =>
  Option.match(maybeNewestNewsDay, {
    onNone: () => false,
    onSome: ({ date }) => !Option.contains(model.home.maybeSeenNewsDay, date),
  })

export const seeNews = (model: Model): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newsPage: () => 0,
        maybeSeenNewsDay: seen =>
          Option.match(maybeNewestNewsDay, {
            onNone: () => seen,
            onSome: ({ date }) => Option.some(date),
          }),
      }),
  })

export const turnNewsPage = (
  model: Model,
  step: number,
  dayCount: number,
): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newsPage: page => Math.max(0, Math.min(dayCount - 1, page + step)),
      }),
  })

// MUNCHOPEDIA

const openEntry = (model: Model, kind: ZombieKind): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        munchopediaPage: () => MunchopediaPage.Entry({ kind }),
        newEntries: Array.filter(fresh => fresh !== kind),
        openedEntries: opened =>
          isDiscovered(model.bests.killsByKind, kind)
            ? Array.union(opened, [kind])
            : opened,
      }),
  })

export const showMunchopediaPage = (
  model: Model,
  page: MunchopediaPage,
): Model =>
  MunchopediaPage.match(page, {
    List: () =>
      modifyFields(model, {
        home: home =>
          modifyFields(home, { munchopediaPage: () => MunchopediaPage.List() }),
      }),
    Entry: ({ kind }) => openEntry(model, kind),
  })

// END SCREENS

type EndOffer = 'Nothing' | 'MenuOnly' | 'MenuAndModes'

export const END_MENU_BUTTON_ID = 'end-menu-button'
export const END_RETRY_BUTTON_ID = 'end-retry-button'
export const END_SHARE_BUTTON_ID = 'end-share-button'
export const END_LOBBY_BUTTON_ID = 'end-lobby-button'
export const END_LEAVE_ROOM_BUTTON_ID = 'end-leave-button'

export const isEndScreen = Phase.isAnyOf(['Victory', 'GameOver'])

// NOTE: a newer build waits on the home menu, so the end screens offer only
// MENU then. Starting another run here would keep the old build running.
export const endOffer = (model: Model): EndOffer => {
  if (!isEndScreen(model.phase) || model.screenMs < RESTART_GRACE_MS) {
    return 'Nothing'
  } else if (Option.isSome(model.maybeNewerBuild)) {
    return 'MenuOnly'
  } else {
    return 'MenuAndModes'
  }
}

// NOTE: going home ends the run, so every run field goes back to a fresh start.
export const returnHome = (model: Model): Model => ({
  ...model,
  ...freshRun(model),
  phase: Phase.Ready(),
  maybeHomeFocus: Option.none(),
})

// BESTS

export const bestsFor = (model: Model): DifficultyBests =>
  model.bests.byDifficulty[model.difficulty.chosen]

export const withBests = (
  model: Model,
  toBests: (bests: DifficultyBests) => DifficultyBests,
  chosen: Difficulty = model.difficulty.chosen,
): Model => {
  return modifyFields(model, {
    bests: bests =>
      modifyFields(bests, {
        byDifficulty: byDifficulty =>
          modifyFields(byDifficulty, {
            Easy: current => (chosen === 'Easy' ? toBests(current) : current),
            Normal: current =>
              chosen === 'Normal' ? toBests(current) : current,
            Hard: current => (chosen === 'Hard' ? toBests(current) : current),
            Nightmare: current =>
              chosen === 'Nightmare' ? toBests(current) : current,
          }),
      }),
  })
}

const fasterWin = (
  maybeFastestMs: Option.Option<number>,
  runMs: number,
): Option.Option<number> =>
  Option.some(
    Option.match(maybeFastestMs, {
      onNone: () => runMs,
      onSome: fastestMs => Math.min(fastestMs, runMs),
    }),
  )

export const isInRun = Phase.isAnyOf(['Preparation', 'Wave', 'Paused'])

const countRun = (
  model: Model,
  tally: RunTally,
  kills: KillCounts,
  isWin: boolean,
  played: Difficulty,
): Model => {
  const isFirstCount = RunTally.isAnyOf(['Uncounted'])(tally)
  const newKills = RunTally.match(tally, {
    Uncounted: () => kills,
    Counted: ({ kills: countedKills }) => killsSince(kills, countedKills),
  })
  const killsByKind = addKills(model.bests.killsByKind, newKills)
  const counted = modifyFields(model, {
    bests: bests =>
      modifyFields(bests, {
        runsPlayed: runs => (isFirstCount ? runs + 1 : runs),
        totalKills: total => total + killTotal(newKills),
        killsByKind: () => killsByKind,
      }),
    runTally: () => RunTally.Counted({ kills }),
    home: home =>
      modifyFields(home, {
        newEntries: fresh =>
          Array.union(
            fresh,
            newlyDiscovered(model.bests.killsByKind, killsByKind),
          ),
      }),
  })
  return isWin
    ? withBests(
        counted,
        bests =>
          modifyFields(bests, {
            maybeFastestWinMs: maybeFastestMs =>
              fasterWin(maybeFastestMs, model.stats.runMs),
          }),
        played,
      )
    : counted
}

// NOTE: a run is counted when it ends: on Game Over, on Victory, and when
// the player leaves it for the menu. Counting then and not every frame means
// the save is written once a run.
// NOTE: `played` is the run's difficulty, which an online co-op run takes
// from the room.
export const countRunFrom = (
  before: Model,
  after: Model,
  played: Difficulty = after.difficulty.chosen,
): Model => {
  if (!isEndScreen(before.phase) && isEndScreen(after.phase)) {
    return countRun(
      after,
      after.runTally,
      after.stats.kills,
      hasJustWon(before, after),
      played,
    )
  } else if (isInRun(before.phase) && isOnHome(after.phase)) {
    return modifyFields(
      countRun(after, before.runTally, before.stats.kills, false, played),
      { runTally: () => RunTally.Uncounted() },
    )
  } else {
    return after
  }
}

// NOTE: the NEW ENTRY pop stays up on the end screen and the menu until the
// entry is opened or another run starts. The dot on the rail stays until the
// entry is opened.
export const forgetNewEntriesFrom = (before: Model, after: Model): Model =>
  !isInRun(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase) &&
  Array.isReadonlyArrayNonEmpty(after.home.newEntries)
    ? modifyFields(after, {
        home: home => modifyFields(home, { newEntries: () => [] }),
      })
    : after

// FEEDBACK

// NOTE: the end screens ask for feedback only on a player's first few runs.
// The run on the end screen is already counted, so a first run shows 1.
export const FEEDBACK_RUNS = 3

export const isAskingForFeedback = (model: Model): boolean =>
  model.bests.runsPlayed <= FEEDBACK_RUNS

export const feedbackSentence = (model: Model): string =>
  isAskingForFeedback(model) ? ` ${FEEDBACK_LINE}` : ''
