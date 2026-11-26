import { Array, Effect, Option } from 'effect'

import { Command, Component } from '@effect/ui'

import { type MenuState, isPanelOpen, menuState } from '#app/menus/menuState.ts'
import type { Model } from '#app/model.ts'
import { PadDirection, newDirection, newlyPressed } from '#input/gamepad.ts'
import { PadScope } from '#input/inputSchema.ts'
import type { Gamepad, PadClick } from '#input/inputSchema.ts'
import {
  ACCEPT_KEY,
  BACK_KEY,
  DIRECTION_KEYS,
  type PadMenuPress,
  padMenuPressOf,
} from '#input/keyActions.ts'
import { InputMessage } from '#input/message.ts'
import {
  TabStep,
  clickPadFocus,
  escapePadDialog,
  movePadFocus,
  stepPadTab,
} from '#input/padFocus.ts'

import { isCardHolding, pressedPadKey } from './play.ts'
import { isPaused } from './run.ts'
import { type UpdateStep, defineHandlers, unchanged } from './step.ts'

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

const isAnsweredByPad = (model: Model): boolean =>
  isPaused(model.phase) && isPanelOpen(model, 'LeaveRun')

const menuRouteOf = (model: Model): Option.Option<MenuRoute> =>
  isAnsweredByPad(model) ? Option.none() : MENU_ROUTES[menuState(model)._tag]

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

const cardStep = (press: PadMenuPress): UpdateStep =>
  press === 'Accept' ? pressedPadKey(ACCEPT_KEY) : unchanged

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

const repeatedDirection =
  (direction: PadDirection): UpdateStep =>
  $ =>
    Option.match(menuRouteOf($.model), {
      onNone: () => $.model,
      onSome: route => directionStep(route, direction)($),
    })

const clickedNothing = (scope: PadScope, outcome: PadClick): UpdateStep =>
  outcome === 'NothingFocused' && scope !== 'TopDialog'
    ? pressedPadKey(ACCEPT_KEY)
    : unchanged

export const padMenuHandlers = defineHandlers({
  RepeatedPadDirection: ($, { direction }) => repeatedDirection(direction)($),

  ClickedPadFocus: ($, { scope, outcome }) => clickedNothing(scope, outcome)($),
})
