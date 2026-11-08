import { Array, Function, Option, String, pipe } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { type HomeMode, type Model, RunTally } from '../../app/model'
import { freshRun } from '../../app/runReset'
import { FOCUS_STEP_OFFSET } from '../../input/input'
import { isPortrait } from '../../render/screen'
import { FEEDBACK_LINE, RESTART_GRACE_MS } from '../../shared/constants'
import { isObjectFirst, isObjectSecond } from '../../shared/dualArgs'
import { hasJustWon } from '../../world/run/difficulty'
import { addKills, killTotal, killsSince } from '../../world/run/stats'
import type { ZombieKind } from '../../world/schema/entitySchema'
import {
  type Difficulty,
  type DifficultyBests,
  type KillCounts,
  Phase,
  RunMode,
} from '../../world/schema/worldSchema'
import type { FocusStep } from '../../world/step/stepWorld'
import { botSeatsFor } from '../bots/bots'
import { IS_COOP_RELEASED } from '../coop/release'
import type { LobbyPicks } from '../lobby/model'
import { isDiscovered, newlyDiscovered } from '../munchopedia/munchopedia'
import { maybeNewestNewsDay } from '../whatsNew/changelog'
import type { HandCard, HomeButton } from './homeSchema'

// BUTTONS

// NOTE: the home layout. Arrow keys walk PLAY, CO-OP, the MANOR button, the
// coffee, then the gear. The mode, difficulty, and hero are picked in the
// single player lobby PLAY opens (src/features/lobby/lobby.ts). Everything else lives in
// the MANOR hand, so a new feature is a new card there and PLAY never
// moves. CO-OP joins only in builds where co-op is released
// (src/features/coop/release.ts), and the coffee only while a support link is set
// (homeButtonsOf).
export const HOME_BUTTONS: Array.NonEmptyReadonlyArray<HomeButton> =
  IS_COOP_RELEASED
    ? ['Play', 'Coop', 'Manor', 'Bests', 'Support', 'Settings']
    : ['Play', 'Manor', 'Bests', 'Support', 'Settings']

const HOME_BUTTON_IDS: Readonly<Record<HomeButton, string>> = {
  Play: 'home-play',
  Coop: 'home-coop',
  Manor: 'home-manor',
  Bests: 'home-bests',
  Support: 'home-support',
  Settings: 'home-settings',
}

export const isSupportShown = (model: Model): boolean =>
  Option.isSome(model.maybeSupportUrl)

// NOTE: the bests badge is a button, and is drawn only once the player has
// a best on the chosen level or a zombie splatted.
const hasBests = (model: Model): boolean =>
  Option.isSome(bestsFor(model).maybeBestEndlessWave) ||
  Option.isSome(bestsFor(model).maybeFastestWinMs) ||
  model.bests.totalKills > 0

// NOTE: the buttons the home menu draws, in arrow key order.
export const homeButtonsOf = (model: Model): ReadonlyArray<HomeButton> =>
  Array.filter(
    HOME_BUTTONS,
    button =>
      (button !== 'Support' || isSupportShown(model)) &&
      (button !== 'Bests' || hasBests(model)),
  )

type HomeKey = Readonly<{ code: string; cap: string; name: string }>

// NOTE: one key per action. Enter, C, L, Z, I, and O were already the home
// keys. J joins up for co-op, V opens the MANOR hand, and B buys Rattles a
// coffee, letters no other screen uses, so WASD, R, Q, T, G, H, K, M, and N
// keep their one meaning. E, X, and Y pick the mode, difficulty, and hero in
// the lobby (src/features/lobby/lobby.ts).
export const HOME_KEYS: Readonly<Record<HomeButton, HomeKey>> = {
  Play: { code: 'Enter', cap: 'ENTER', name: 'Enter' },
  Coop: { code: 'KeyJ', cap: 'J', name: 'J' },
  Manor: { code: 'KeyV', cap: 'V', name: 'V' },
  // NOTE: the bests badge opens the Munchopedia, so it shares the card's key.
  Bests: { code: 'KeyZ', cap: 'Z', name: 'Z' },
  Support: { code: 'KeyB', cap: 'B', name: 'B' },
  Settings: { code: 'KeyO', cap: 'O', name: 'O' },
}

export const isCoopKey = (code: string): boolean => code === HOME_KEYS.Coop.code

export const isManorKey = (code: string): boolean =>
  code === HOME_KEYS.Manor.code

export const isSupportKey = (code: string): boolean =>
  code === HOME_KEYS.Support.code

export const isSettingsKey = (code: string): boolean =>
  code === HOME_KEYS.Settings.code

// NOTE: the turn hint shows on the portrait home menu until it is dismissed
// or the phone turns.
export const isTurnHintShown = (model: Model): boolean =>
  isOnHome(model.phase) && isPortrait(model) && !model.home.isTurnHintSeen

export const seeTurnHint = (model: Model): Model =>
  modifyFields(model, {
    home: home => modifyFields(home, { isTurnHintSeen: () => true }),
  })

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
  `hand-card-${String.toLowerCase(card)}`

export const steppedHandCard: {
  (
    from: HandCard,
    step: number,
  ): (cards: ReadonlyArray<HandCard>) => Option.Option<HandCard>
  (
    cards: ReadonlyArray<HandCard>,
    from: HandCard,
    step: number,
  ): Option.Option<HandCard>
} = Function.dual(
  3,
  (
    cards: ReadonlyArray<HandCard>,
    from: HandCard,
    step: number,
  ): Option.Option<HandCard> =>
    Option.flatMap(
      Array.findFirstIndex(cards, card => card === from),
      index => Array.get(cards, (index + step + cards.length) % cards.length),
    ),
)

export const steppedHomeFocus: {
  (
    maybeFocus: Option.Option<HomeButton>,
    step: FocusStep,
  ): (buttons: ReadonlyArray<HomeButton>) => HomeButton
  (
    buttons: ReadonlyArray<HomeButton>,
    maybeFocus: Option.Option<HomeButton>,
    step: FocusStep,
  ): HomeButton
} = Function.dual(
  3,
  (
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
          Array.get(buttons, (index + FOCUS_STEP_OFFSET[step] + count) % count),
          Option.getOrElse(() => first),
        )
      },
    })
  },
)

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

// NOTE: what the single player lobby picks from, as the root keeps it: its
// update context and view input (LobbyBinding in src/app/bindings.ts).
export const lobbyPicksOf = (model: Model): LobbyPicks => ({
  mode: model.home.mode,
  difficulty: model.difficulty,
  modifiers: model.modifiers,
  bots: model.home.bots,
  botSeats: botSeatsFor(model),
})

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

export const turnNewsPage: {
  (step: number, dayCount: number): (model: Model) => Model
  (model: Model, step: number, dayCount: number): Model
} = Function.dual(3, (model: Model, step: number, dayCount: number): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newsPage: page => Math.max(0, Math.min(dayCount - 1, page + step)),
      }),
  }),
)

// MUNCHOPEDIA

// NOTE: an entry the Munchopedia opened (its OutMessage `OpenedEntry`):
// its NEW ENTRY goes, and a zombie already found is saved as opened.
export const openedEntry: {
  (kind: ZombieKind): (model: Model) => Model
  (model: Model, kind: ZombieKind): Model
} = Function.dual(2, (model: Model, kind: ZombieKind): Model =>
  modifyFields(model, {
    home: home =>
      modifyFields(home, {
        newEntries: Array.filter(fresh => fresh !== kind),
        openedEntries: opened =>
          isDiscovered(model.bests.killsByKind, kind)
            ? Array.union(opened, [kind])
            : opened,
      }),
  }),
)

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

export const withBests: {
  (
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen?: Difficulty,
  ): (model: Model) => Model
  (
    model: Model,
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen?: Difficulty,
  ): Model
} = Function.dual(
  isObjectFirst,
  (
    model: Model,
    toBests: (bests: DifficultyBests) => DifficultyBests,
    chosen: Difficulty = model.difficulty.chosen,
  ): Model =>
    modifyFields(model, {
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
    }),
)

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
export const countRunFrom: {
  (after: Model, played?: Difficulty): (before: Model) => Model
  (before: Model, after: Model, played?: Difficulty): Model
} = Function.dual(
  isObjectSecond,
  (
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
  },
)

// NOTE: the NEW ENTRY pop stays up on the end screen and the menu until the
// entry is opened or another run starts. The dot on the rail stays until the
// entry is opened.
export const forgetNewEntriesFrom: {
  (after: Model): (before: Model) => Model
  (before: Model, after: Model): Model
} = Function.dual(2, (before: Model, after: Model): Model =>
  !isInRun(before.phase) &&
  Phase.isAnyOf(['Preparation'])(after.phase) &&
  Array.isReadonlyArrayNonEmpty(after.home.newEntries)
    ? modifyFields(after, {
        home: home => modifyFields(home, { newEntries: () => [] }),
      })
    : after,
)

// FEEDBACK

// NOTE: the end screens ask for feedback only on a player's first few runs.
// The run on the end screen is already counted, so a first run shows 1.
export const FEEDBACK_RUNS = 3

export const isAskingForFeedback = (model: Model): boolean =>
  model.bests.runsPlayed <= FEEDBACK_RUNS

export const feedbackSentence = (model: Model): string =>
  isAskingForFeedback(model) ? ` ${FEEDBACK_LINE}` : ''
