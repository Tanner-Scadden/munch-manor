import { Array, Effect, Option } from 'effect'

import { Command, Component } from '@effect/ui'

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

// NOTE: a move, a tab turned, or a dialog's Escape on the page changes
// nothing the Model holds, so it reports nothing.
export const MovePadFocus = Command.make(
  'MovePadFocus',
  { args: { scope: PadScope, direction: PadDirection } },
  ({ scope, direction }) =>
    Effect.as(movePadFocus({ scope, direction }), Component.noop),
)

export const ClickPadFocus = Command.make(
  'ClickPadFocus',
  { args: { scope: PadScope } },
  ({ scope }) =>
    Effect.map(clickPadFocus(scope), outcome =>
      InputMessage.ClickedPadFocus({ scope, outcome }),
    ),
)

export const StepPadTab = Command.make(
  'StepPadTab',
  { args: { scope: PadScope, step: TabStep } },
  ({ scope, step }) => Effect.as(stepPadTab({ scope, step }), Component.noop),
)

export const EscapePadDialog = Command.make(
  'EscapePadDialog',
  { args: {} },
  () => Effect.as(escapePadDialog, Component.noop),
)

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

const directionStep = (
  route: MenuRoute,
  direction: PadDirection,
): UpdateStep =>
  route.direction === 'Arrows'
    ? pressedPadKey(DIRECTION_KEYS[direction])
    : movedFocus(route.scope, direction)

const movedFocus =
  (scope: PadScope, direction: PadDirection): UpdateStep =>
  $ =>
    $.run(MovePadFocus.make({ scope, direction }))

const clickedFocus =
  (scope: PadScope): UpdateStep =>
  $ =>
    $.run(ClickPadFocus.make({ scope }))

const steppedTab =
  (scope: PadScope, step: TabStep): UpdateStep =>
  $ =>
    $.run(StepPadTab.make({ scope, step }))

const escapedDialog: UpdateStep = $ => $.run(EscapePadDialog.make())

const pressStep = (route: MenuRoute, press: PadMenuPress): UpdateStep => {
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
const cardStep = (press: PadMenuPress): UpdateStep =>
  press === 'Accept' ? pressedPadKey(ACCEPT_KEY) : unchanged

// NOTE: the menu presses of one poll, read against the Model before it: a
// newly pointed direction and each newly pressed menu button. The route is
// picked from that Model too, so a press that leaves a menu (A leaving a
// run) never presses the screen it lands on as well.
export const padMenuSteps = ({
  model,
  pad,
}: Readonly<{ model: Model; pad: Gamepad }>): ReadonlyArray<UpdateStep> => {
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
const repeatedDirection =
  (direction: PadDirection): UpdateStep =>
  $ =>
    Option.match(menuRouteOf($.model), {
      onNone: () => $.model,
      onSome: route => directionStep(route, direction)($),
    })

// NOTE: A found nothing with focus: a screen that reads keys takes it as
// Enter (PLAY on the home menu, START in the lobby), as a key would.
const clickedNothing = (scope: PadScope, outcome: PadClick): UpdateStep =>
  outcome === 'NothingFocused' && scope !== 'TopDialog'
    ? pressedPadKey(ACCEPT_KEY)
    : unchanged

export const padMenuHandlers = defineHandlers({
  RepeatedPadDirection: ($, { direction }) => repeatedDirection(direction)($),

  ClickedPadFocus: ($, { scope, outcome }) => clickedNothing(scope, outcome)($),
})
