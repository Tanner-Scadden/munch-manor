import { Duration, Effect, Option } from 'effect'
import { Dom, Update } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import type { HomeMode } from '../../domain/clientSchema'
import { nextMarkOf } from '../../domain/dareMarks'
import { maybeFocusStep } from '../../input/input'
import type { Calling, Difficulty } from '../../shared/playerData'
import { isLocked, nextEasyBreakOf } from '../../world/run/difficulty'
import type { Modifier } from '../../world/run/modifiers'
import { PickOutcome } from '../heroes/inMessage'
import { isPickerOpen } from '../heroes/model'
import { HeroDialogBinding, HeroPickerBinding } from './bindings'
import { LobbyBlock, makeNoopStep, makeStep } from './block'
import {
  LOBBY_KEYS,
  isEasyBreakShown,
  isMarkShown,
  isModifierPickable,
  lobbyControlId,
  nextDifficultyOf,
  steppedLobbyFocus,
} from './lobby'
import { Message, OutMessage } from './message'
import {
  LobbyControl,
  type LobbyPicks,
  type LobbyStatus,
  type Model,
  isLobbyShown,
} from './model'

// The lobby's own transitions, shared by its update, its InMessages, and
// its children's folds (FOLDKIT.md, "File organization"). The picks are the
// root's, read from the update context: a pick here only says what was
// picked. RETRY, AGAIN, and KEEP GOING never come here: they replay the
// settings the run had.

// FOCUS

export const FocusLobbyControl = LobbyBlock.makeCommand('FocusLobbyControl', {
  args: { control: LobbyControl },
  messages: [Message.CompletedFocusControl],
  handler: function* () {
    return ({ control }) =>
      Dom.focus(`#${lobbyControlId(control)}`).pipe(
        Effect.ignore,
        Effect.as(Message.CompletedFocusControl()),
      )
  },
})

const withFocus = (
  model: Model,
  maybeFocus: Option.Option<LobbyControl>,
): Model => modifyFields(model, { maybeFocus: () => maybeFocus })

export const focusedControl =
  (control: LobbyControl) =>
  (model: Model): Model =>
    withFocus(model, Option.some(control))

export const blurredControl = (model: Model): Model =>
  withFocus(model, Option.none())

const focus = (model: Model, control: LobbyControl) => ({
  model: withFocus(model, Option.some(control)),
  commands: [FocusLobbyControl({ control })],
})

// NOTE: the lobby takes taps and keys while it is up with nothing over it:
// the hero picker's Dialog takes them while it is open.
const isActive = (model: Model): boolean =>
  isLobbyShown(model) &&
  !model.heroDialog.isOpen &&
  !isPickerOpen(model.heroPicker)

// OPENING

// NOTE: START has focus, so Enter plays at once.
export const open = (model: Model) =>
  focus(
    modifyFields(model, {
      status: () => 'Open',
      maybeFocus: () => Option.none(),
      maybePickingBot: () => Option.none(),
    }),
    'Start',
  )

// LEAVING

// NOTE: how long the card takes to fold back into PLAY (lobby.css,
// `--dare-close-ms`), after which it is gone. A player who opens it again
// before then gets it Open, and the late CompletedFold changes nothing.
const FOLD_MS = 280

export const FoldLobby = LobbyBlock.makeCommand('FoldLobby', {
  messages: [Message.CompletedFold],
  handler: function* () {
    return () =>
      Effect.sleep(Duration.millis(FOLD_MS)).pipe(
        Effect.as(Message.CompletedFold()),
      )
  },
})

const withStatus = (model: Model, status: LobbyStatus): Model =>
  modifyFields(model, {
    status: () => status,
    maybeFocus: () => Option.none(),
  })

// NOTE: SHAKE ON IT: the run starts, so the card goes at once.
export const start = (model: Model) =>
  isActive(model)
    ? { model: withStatus(model, 'Closed'), outMessage: OutMessage.Started() }
    : { model }

// NOTE: CHICKEN OUT, Escape, or a tap outside the card: it folds back into
// PLAY, and the root puts focus back on PLAY.
export const leave = (model: Model) =>
  isActive(model)
    ? {
        model: withStatus(model, 'Folding'),
        commands: [FoldLobby()],
        outMessage: OutMessage.Left(),
      }
    : { model }

export const finishFold = (model: Model): Model =>
  model.status === 'Folding' ? withStatus(model, 'Closed') : model

// PICKS

// NOTE: a pick puts focus on START, so Enter after a pick starts the run
// instead of pressing the tile again, and goes up for the root to make.
const picked = (model: Model, outMessage: OutMessage, isAllowed = true) =>
  isActive(model) && isAllowed
    ? { ...focus(model, 'Start'), outMessage }
    : { model }

export const pickMode = (mode: HomeMode) => (model: Model) =>
  picked(model, OutMessage.ChoseMode({ mode }))

export const pickDifficulty =
  (difficulty: Difficulty) => (model: Model, picks: LobbyPicks) =>
    picked(
      model,
      OutMessage.ChoseDifficulty({ difficulty }),
      !isLocked(picks.difficulty, difficulty),
    )

// NOTE: a modifier turns on and off where it sits, so a player can turn
// several on in a row (a pick elsewhere hands focus to START). Friendly Fire
// waits for a bot to hit, as the tile says.
export const pickModifier =
  (modifier: Modifier) => (model: Model, picks: LobbyPicks) =>
    isActive(model) && isModifierPickable(picks, modifier)
      ? { model, outMessage: OutMessage.ToggledModifier({ modifier }) }
      : { model }

// NOTE: Dare's break clock steps to its next choice where it sits, as a
// modifier turns, so focus stays on it for another press.
export const pickEasyBreak = (model: Model) => (picks: LobbyPicks) =>
  isActive(model) && isEasyBreakShown(picks)
    ? {
        model,
        outMessage: OutMessage.ChoseEasyBreak({
          seconds: nextEasyBreakOf(picks.easyBreakSeconds),
        }),
      }
    : { model }

// NOTE: the dare ladder's mark steps to the next opened where it sits, round
// to none, as the break clock does.
export const pickDareMark = (model: Model) => (picks: LobbyPicks) =>
  isActive(model) && isMarkShown(picks)
    ? {
        model,
        outMessage: OutMessage.ChoseDareMark({
          mark: nextMarkOf(picks.dareMark, picks.bestMark),
        }),
      }
    : { model }

// BOTS

// NOTE: + BOT asks the root for a bot for the next empty seat, as its seeded
// generator picks the goofy name (none the crew wears) and the hero (one
// this player owns). With no seat free it changes nothing, but it is still
// a pick: its tap and START's focus.
export const addBot = (model: Model) =>
  picked(model, OutMessage.ClickedAddBot())

// NOTE: the x on a bot: the root sends it home (the last bot takes Friendly
// Fire with it), and a picker choosing for a bot chooses for nobody.
export const dropBot = (index: number) => (model: Model) =>
  picked(
    modifyFields(model, { maybePickingBot: () => Option.none() }),
    OutMessage.DroppedBot({ index }),
  )

// THE HERO PICKER

const choosingFor = (maybeBot: Option.Option<number>) => (model: Model) => ({
  model: modifyFields(model, { maybePickingBot: () => maybeBot }),
})

// NOTE: the hero card opens the picker for the player, a bot's card for
// that bot, in the Dialog over the lobby. The handler tells the root
// (`heroOpenedFrom`), which plays the tap and marks the heroes seen: a
// Binding's operation in a combined Step cannot carry an OutMessage.
const openPicker = (maybeBot: Option.Option<number>) =>
  Update.combineSteps([
    choosingFor(maybeBot),
    HeroPickerBinding.requestOpen(),
    HeroDialogBinding.requestOpen(),
  ])

export const openHero = makeStep(model =>
  isActive(model) ? openPicker(Option.none()) : makeNoopStep(),
)

export const heroOpenedFrom = (model: Model) =>
  isActive(model) ? OutMessage.OpenedHeroPicker() : undefined

const isBotHeroOpenable = (
  model: Model,
  picks: LobbyPicks,
  index: number,
): boolean => isActive(model) && index < picks.bots.length

type BotCard = Readonly<{ index: number; picks: LobbyPicks }>

export const openBotHero = ({ index, picks }: BotCard) =>
  makeStep(model =>
    isBotHeroOpenable(model, picks, index)
      ? openPicker(Option.some(index))
      : makeNoopStep(),
  )

export const botHeroOpenedFrom =
  ({ index, picks }: BotCard) =>
  (model: Model) =>
    isBotHeroOpenable(model, picks, index)
      ? OutMessage.OpenedHeroPicker()
      : undefined

// NOTE: the Dialog closed, by its Escape, its backdrop, or a hero worn: the
// picker closes with it, and the next opening chooses for the player.
export const closeHeroPicker = Update.combineSteps([
  choosingFor(Option.none()),
  HeroPickerBinding.requestClose(),
])

// NOTE: the root's answer to a hero card or BUY: the picker plays it, and a
// hero worn (the player's, or a bot's at its seat) closes the Dialog.
export const showHeroOutcome = (outcome: PickOutcome) =>
  makeStep(model =>
    isPickerOpen(model.heroPicker)
      ? Update.combineSteps([
          HeroPickerBinding.informOfOutcome({ outcome }),
          PickOutcome.isAnyOf(['Worn'])(outcome)
            ? HeroDialogBinding.requestClose()
            : makeNoopStep(),
        ])
      : makeNoopStep(),
  )

// NOTE: BUY is for the player's own hero: a bot only takes a hero the
// player owns, so a try-on for a bot only ends.
export const buyHero = (calling: Calling) =>
  makeStep(model =>
    Option.isSome(model.maybePickingBot)
      ? HeroPickerBinding.informOfOutcome({
          outcome: PickOutcome.TryOnEnded(),
        })
      : { model, outMessage: OutMessage.ClickedBuyHero({ calling }) },
  )

// KEYS

// NOTE: Enter starts, Esc goes back, and E, X, and B pick as their tiles
// do (Y, the hero card's, opens the picker in inMessageUpdate.ts). The
// arrows walk the controls. A key on a focused button is that button's own
// (src/app/subscriptions.ts), so Enter there presses it.
export const pressKey = (code: string) => (model: Model, picks: LobbyPicks) => {
  if (!isActive(model)) {
    return { model }
  } else if (code === LOBBY_KEYS.Start.code) {
    return start(model)
  } else if (code === LOBBY_KEYS.Back.code) {
    return leave(model)
  } else if (code === LOBBY_KEYS.Mode.code) {
    return pickMode(picks.mode === 'Campaign' ? 'Endless' : 'Campaign')(model)
  } else if (code === LOBBY_KEYS.Difficulty.code) {
    return pickDifficulty(nextDifficultyOf(picks.difficulty))(model, picks)
  } else if (code === LOBBY_KEYS.Bot.code) {
    return addBot(model)
  } else {
    return Option.match(maybeFocusStep(code), {
      onNone: () => ({ model }),
      onSome: step =>
        focus(model, steppedLobbyFocus(model.maybeFocus, step, picks)),
    })
  }
}
