import {
  Array,
  Effect,
  Function,
  Number,
  Option,
  Order,
  Schema,
  pipe,
} from 'effect'

import type { Vector } from '../world/schema/entitySchema'
import { SCREEN_STEPS } from '../world/step/geometry'
import type { PadDirection } from './gamepad'
import { FOCUS_STEP_OFFSET } from './input'
import type { PadClick, PadScope } from './inputSchema'

// A controller in the menus, on the page: moving focus to the nearest
// control the way the stick points, clicking what has focus, turning a
// tab strip or a page, and backing out of a dialog as Escape does. The
// Commands in src/app/update/padMenu.ts run these; `update` only decides
// which, from menuState, so it stays pure.

// NOTE: a control's box on screen, as getBoundingClientRect gives it.
export type Box = Readonly<{
  left: number
  top: number
  width: number
  height: number
}>

const centerOf = (box: Box): Vector => ({
  x: box.left + box.width / 2,
  y: box.top + box.height / 2,
})

// NOTE: a control a pixel or two off the line still counts as level with
// the one that has focus, so a row's buttons never read as a step down.
const LEVEL_SLACK_PX = 2

// NOTE: how much a step sideways costs against a step the way the stick
// points: the nearest control along the line wins over a closer one off it.
const ACROSS_WEIGHT = 2

type Scored = Readonly<{ index: number; score: number }>

const byScore = Order.mapInput(Number.Order, (scored: Scored) => scored.score)

// NOTE: the box nearest `from` the way `direction` points, by its center:
// only boxes ahead of it count, and a box off the line pays for the step
// sideways. None when nothing is that way.
export const nearestInDirection: {
  (
    from: Box,
    direction: PadDirection,
  ): (boxes: ReadonlyArray<Box>) => Option.Option<number>
  (
    boxes: ReadonlyArray<Box>,
    from: Box,
    direction: PadDirection,
  ): Option.Option<number>
} = Function.dual(
  3,
  (
    boxes: ReadonlyArray<Box>,
    from: Box,
    direction: PadDirection,
  ): Option.Option<number> => {
    const start = centerOf(from)
    const way = SCREEN_STEPS[direction]
    const scored = Array.getSomes(
      Array.map(boxes, (box, index) => {
        const center = centerOf(box)
        const dx = center.x - start.x
        const dy = center.y - start.y
        const along = dx * way.x + dy * way.y
        const across = Math.abs(dx * way.y - dy * way.x)
        return along > LEVEL_SLACK_PX
          ? Option.some({ index, score: along + across * ACROSS_WEIGHT })
          : Option.none()
      }),
    )
    return pipe(
      Array.sort(scored, byScore),
      Array.head,
      Option.map(({ index }) => index),
    )
  },
)

// THE PAGE

const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]):not([type='hidden']), " +
  "select:not([disabled]), textarea:not([disabled]), [role='tab'], " +
  "[role='radio'], [tabindex]:not([tabindex='-1'])"

// NOTE: the game surface takes focus for the keys in a run; it is no menu
// control.
const GAME_SURFACE_CLASS = 'game-surface'

const zIndexOf = (element: Element): number =>
  element instanceof HTMLElement ? globalThis.Number(element.style.zIndex) : 0

const topDialog = (): Option.Option<Element> =>
  pipe(
    Array.fromIterable(document.querySelectorAll('dialog[open]')),
    Array.sort(Order.mapInput(Number.Order, zIndexOf)),
    Array.last,
  )

const scopeElement = (scope: PadScope): Option.Option<Element> => {
  switch (scope) {
    case 'TopDialog':
      return topDialog()
    case 'Coop':
      return Option.fromNullishOr(document.querySelector('section.coop'))
    case 'Page':
      return Option.some(document.body)
  }
}

const isShown = (element: Element): boolean =>
  element.getClientRects().length > 0 &&
  element.closest('[inert], [aria-hidden="true"]') === null &&
  getComputedStyle(element).visibility !== 'hidden'

const controlsIn = (root: Element): ReadonlyArray<HTMLElement> =>
  Array.filter(
    Array.fromIterable(root.querySelectorAll(FOCUSABLE)),
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      !element.classList.contains(GAME_SURFACE_CLASS) &&
      isShown(element),
  )

const focusedIn = (root: Element): Option.Option<HTMLElement> => {
  const active = document.activeElement
  return active instanceof HTMLElement &&
    active !== root &&
    root.contains(active) &&
    active.matches(FOCUSABLE) &&
    !active.classList.contains(GAME_SURFACE_CLASS)
    ? Option.some(active)
    : Option.none()
}

// NOTE: focusVisible asks for the ring even when the mouse was last on the
// page; the stylesheet draws it for a pad anyway, where a browser ignores it.
const focusControl = (element: HTMLElement): void => {
  element.focus({ focusVisible: true })
}

const boxOf = (element: Element): Box => element.getBoundingClientRect()

// NOTE: the stick or d-pad: focus steps to the nearest control that way,
// or, when nothing in the scope has focus yet, onto its first control.
export const movePadFocus = ({
  scope,
  direction,
}: Readonly<{
  scope: PadScope
  direction: PadDirection
}>): Effect.Effect<void> =>
  Effect.sync(() =>
    Option.map(scopeElement(scope), root => {
      const controls = controlsIn(root)
      const maybeNext = Option.match(focusedIn(root), {
        onNone: () => Array.head(controls),
        onSome: focused =>
          pipe(
            nearestInDirection(
              Array.map(controls, boxOf),
              boxOf(focused),
              direction,
            ),
            Option.flatMap(index => Array.get(controls, index)),
          ),
      })
      return Option.map(maybeNext, focusControl)
    }),
  )

// NOTE: A presses the focused control, as Enter does. A dialog with
// nothing focused gets its first control focused instead; elsewhere the
// root hears NothingFocused and takes A as Enter.
export const clickPadFocus = (scope: PadScope): Effect.Effect<PadClick> =>
  Effect.sync(() =>
    Option.match(scopeElement(scope), {
      onNone: () => 'NothingFocused',
      onSome: root =>
        Option.match(focusedIn(root), {
          onNone: () => {
            if (scope !== 'TopDialog') {
              return 'NothingFocused'
            }
            Option.map(Array.head(controlsIn(root)), focusControl)
            return 'Clicked'
          },
          onSome: focused => {
            focused.click()
            return 'Clicked'
          },
        }),
    }),
  )

export const TabStep = Schema.Literals(['Previous', 'Next'])
export type TabStep = typeof TabStep.Type

const stepTabs = (
  tabList: Element,
  step: TabStep,
): Option.Option<HTMLElement> => {
  const tabs = Array.filter(
    Array.fromIterable(tabList.querySelectorAll("[role='tab']")),
    (tab): tab is HTMLElement => tab instanceof HTMLElement && isShown(tab),
  )
  const count = tabs.length
  return pipe(
    Array.findFirstIndex(
      tabs,
      tab => tab.getAttribute('aria-selected') === 'true',
    ),
    Option.flatMap(selected =>
      Array.get(tabs, (selected + FOCUS_STEP_OFFSET[step] + count) % count),
    ),
  )
}

// NOTE: a bumper: the next or previous tab of the scope's tab strip, or,
// with no strip, its page button (`data-pad-page`, What's New's Older and
// Newer).
export const stepPadTab = ({
  scope,
  step,
}: Readonly<{ scope: PadScope; step: TabStep }>): Effect.Effect<void> =>
  Effect.sync(() =>
    Option.map(scopeElement(scope), root => {
      const maybeTab = pipe(
        Array.findFirst(
          Array.fromIterable(root.querySelectorAll("[role='tablist']")),
          isShown,
        ),
        Option.flatMap(tabList => stepTabs(tabList, step)),
      )
      return Option.match(maybeTab, {
        onNone: () =>
          Option.map(
            Option.filter(
              Option.fromNullishOr(
                root.querySelector(`[data-pad-page='${step}']`),
              ),
              (button): button is HTMLElement =>
                button instanceof HTMLElement && isShown(button),
            ),
            button => button.click(),
          ),
        onSome: tab => {
          tab.click()
          focusControl(tab)
          return Option.some(undefined)
        },
      })
    }),
  )

// NOTE: B in a dialog: an Escape on what has focus, which the dialog's own
// keys and Foldkit's Dialog take as they take the keyboard's.
export const escapePadDialog: Effect.Effect<void> = Effect.sync(() =>
  Option.map(topDialog(), dialog => {
    const target = Option.getOrElse(
      Option.filter(Option.fromNullishOr(document.activeElement), active =>
        dialog.contains(active),
      ),
      () => dialog,
    )
    return target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    )
  }),
)
