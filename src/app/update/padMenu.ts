import { Array, Effect, Option } from 'effect'
import { Update } from 'foldkit'

import { PadDirection, newDirection, newlyPressed } from '../../input/gamepad'
import { PadScope } from '../../input/inputSchema'
import type { Gamepad, PadClick } from '../../input/inputSchema'
import {
  ACCEPT_KEY,
  BACK_KEY,
  DIRECTION_KEYS,
  type PadMenuPress,
  padMenuPressOf,
} from '../../input/keyActions'
import { InputMessage } from '../../input/message'
import {
  TabStep,
  clickPadFocus,
  escapePadDialog,
  movePadFocus,
  stepPadTab,
} from '../../input/padFocus'
import { ApplicationBlock, makeStep } from '../definition'
import { type MenuState, isPanelOpen, menuState } from '../menuState'
import type { Model } from '../model'
import { isCardHolding, pressedPadKey } from './play'
import { isPaused } from './run'
import { type UpdateStep, defineHandlers, unchanged } from './step'

// A controller in every menu (docs/INPUT_PLAN.md, phase 2): the d-pad and
// the left stick move focus, A presses what has focus, B backs out as
// Escape does, and the bumpers turn tabs. Which way each goes is read off
// menuState: a screen that steps its own focus by arrows (the home menu,
// the lobby) gets the arrow key, a dialog gets its focus moved on the page
// and an Escape of its own, and the rest move focus on the page and read
// Enter and Escape as keys. Update only picks the Command, so it stays pure.

// COMMANDS

export const MovePadFocus = ApplicationBlock.makeCommand('MovePadFocus', {
  args: { scope: PadScope, direction: PadDirection },
  messages: [InputMessage.CompletedPadMenu],
  handler: function* () {
    return ({ scope, direction }) =>
      movePadFocus({ scope, direction }).pipe(
        Effect.as(InputMessage.CompletedPadMenu()),
      )
  },
})

export const ClickPadFocus = ApplicationBlock.makeCommand('ClickPadFocus', {
  args: { scope: PadScope },
  messages: [InputMessage.ClickedPadFocus],
  handler: function* () {
    return ({ scope }) =>
      Effect.map(clickPadFocus(scope), outcome =>
        InputMessage.ClickedPadFocus({ scope, outcome }),
      )
  },
})

export const StepPadTab = ApplicationBlock.makeCommand('StepPadTab', {
  args: { scope: PadScope, step: TabStep },
  messages: [InputMessage.CompletedPadMenu],
  handler: function* () {
    return ({ scope, step }) =>
      stepPadTab({ scope, step }).pipe(
        Effect.as(InputMessage.CompletedPadMenu()),
      )
  },
})

export const EscapePadDialog = ApplicationBlock.makeCommand('EscapePadDialog', {
  messages: [InputMessage.CompletedPadMenu],
  handler: function* () {
    return () =>
      escapePadDialog.pipe(Effect.as(InputMessage.CompletedPadMenu()))
  },
})

// ROUTES

// NOTE: how a menu takes a pad. `Arrows`: it steps its own focus by arrow
// keys, as the keyboard does. `Page`: focus moves on the page in the scope.
// Back is Escape: a dialog's own (`Dialog`) or the root's key (`Key`).
type DirectionRoute = 'Arrows' | 'Page'
type BackRoute = 'Dialog' | 'Key'

type MenuRoute = Readonly<{
  scope: PadScope
  direction: DirectionRoute
  back: BackRoute
}>

const DIALOG: MenuRoute = {
  scope: 'TopDialog',
  direction: 'Page',
  back: 'Dialog',
}

// NOTE: every menu by its state, so a new one fails typecheck until it says
// how a pad drives it. Playing is no menu: the run's own buttons have the
// pad there (src/input/keyActions.ts).
const MENU_ROUTES: {
  readonly [Tag in MenuState['_tag']]: Option.Option<MenuRoute>
} = {
  Profile: Option.some(DIALOG),
  Panel: Option.some(DIALOG),
  Hand: Option.some(DIALOG),
  InstallSteps: Option.some(DIALOG),
  UpdateGreeting: Option.some(DIALOG),
  HeroPicker: Option.some(DIALOG),
  Lobby: Option.some({ scope: 'Page', direction: 'Arrows', back: 'Key' }),
  Coop: Option.some({ scope: 'Coop', direction: 'Page', back: 'Key' }),
  Home: Option.some({ scope: 'Page', direction: 'Arrows', back: 'Key' }),
  Playing: Option.none(),
  Paused: Option.some({ scope: 'Page', direction: 'Page', back: 'Key' }),
  EndScreen: Option.some({ scope: 'Page', direction: 'Page', back: 'Key' }),
}

// NOTE: the leave panel over pause is answered by the pad itself, A to
// leave and B to stay (leaveRunFromPad in src/app/update/home.ts), so a
// player never has to find the right button to get out of a run.
const isAnsweredByPad = (model: Model): boolean =>
  isPaused(model.phase) && isPanelOpen(model, 'LeaveRun')

const menuRouteOf = (model: Model): Option.Option<MenuRoute> =>
  isAnsweredByPad(model) ? Option.none() : MENU_ROUTES[menuState(model)._tag]

// NOTE: a pad's menus are up: what the PadRepeat Subscription watches, so
// a stick held in a run sends nothing.
export const isPadMenuUp = (model: Model): boolean =>
  Option.isSome(model.input.maybeGamepad) &&
  (Option.isSome(menuRouteOf(model)) || isCardHolding(model))

const directionStep = (route: MenuRoute, direction: PadDirection) =>
  route.direction === 'Arrows'
    ? pressedPadKey(DIRECTION_KEYS[direction])
    : movedFocus(route.scope, direction)

const movedFocus =
  (scope: PadScope, direction: PadDirection): UpdateStep =>
  model => ({ model, commands: [MovePadFocus({ scope, direction })] })

const clickedFocus =
  (scope: PadScope): UpdateStep =>
  model => ({ model, commands: [ClickPadFocus({ scope })] })

const steppedTab =
  (scope: PadScope, step: TabStep): UpdateStep =>
  model => ({ model, commands: [StepPadTab({ scope, step })] })

const escapedDialog: UpdateStep = model => ({
  model,
  commands: [EscapePadDialog()],
})

const pressStep = (route: MenuRoute, press: PadMenuPress) => {
  switch (press) {
    case 'Accept':
      return clickedFocus(route.scope)
    case 'Back':
      return route.back === 'Dialog' ? escapedDialog : pressedPadKey(BACK_KEY)
    case 'PreviousTab':
      return steppedTab(route.scope, 'Previous')
    case 'NextTab':
      return steppedTab(route.scope, 'Next')
  }
}

// NOTE: a card that holds the run (the new zombie card, the display
// case's) is no menu, but A answers it as Enter does.
const cardStep = (press: PadMenuPress) =>
  press === 'Accept' ? pressedPadKey(ACCEPT_KEY) : unchanged

// NOTE: the menu presses of one poll, read against the Model before it: a
// newly pointed direction and each newly pressed menu button. The route is
// picked from that Model too, so a press that leaves a menu (A leaving a
// run) never presses the screen it lands on as well.
export const padMenuSteps = ({
  model,
  pad,
}: Readonly<{ model: Model; pad: Gamepad }>) => {
  const presses = Array.getSomes(
    Array.map(newlyPressed(model.input.maybeGamepad, pad), padMenuPressOf),
  )
  return Option.match(menuRouteOf(model), {
    onNone: () => (isCardHolding(model) ? Array.map(presses, cardStep) : []),
    onSome: route => [
      ...Option.match(newDirection(model.input.maybeGamepad, pad), {
        onNone: () => [],
        onSome: direction => [directionStep(route, direction)],
      }),
      ...Array.map(presses, press => pressStep(route, press)),
    ],
  })
}

// NOTE: a direction held past the repeat delay steps again.
const repeatedDirection = (direction: PadDirection) =>
  makeStep(model =>
    Option.match(menuRouteOf(model), {
      onNone: () => unchanged,
      onSome: route => directionStep(route, direction),
    }),
  )

// NOTE: A found nothing with focus: a screen that reads keys takes it as
// Enter (PLAY on the home menu, START in the lobby), as a key would.
const clickedNothing = (scope: PadScope, outcome: PadClick) =>
  makeStep(() =>
    outcome === 'NothingFocused' && scope !== 'TopDialog'
      ? pressedPadKey(ACCEPT_KEY)
      : unchanged,
  )

export const padMenuHandlers = defineHandlers({
  RepeatedPadDirection: (model, { direction }) =>
    Update.combineSteps(model, [repeatedDirection(direction)]),

  ClickedPadFocus: (model, { scope, outcome }) =>
    Update.combineSteps(model, [clickedNothing(scope, outcome)]),

  CompletedPadMenu: model => ({ model }),
})
