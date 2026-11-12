// The phone keyboard pass. On a phone upright and on its side, it taps each
// text field the game has (the Profile's name, the link code, co-op's room
// code, and co-op's name picker), then brings up a fake keyboard two ways:
// as iOS does, shrinking only the visual viewport, and as a browser that
// ignores `interactive-widget=overlays-content` does, shrinking the page
// itself. Neither may change the game's measured surface, its portrait or
// landscape, or its screen height, and the field must keep its focus and
// show above the keyboard, the page lifted if it has to be. Once
// the field lets go, the game measures again. A screenshot of each field
// with the keyboard up lands in tools/audit/shots/. Exits with 1 on any
// change.
//   bun run heavy -- --shared bun tools/audit/keyboard.ts
// VIEWPORTS picks screens.
import { Array, Effect, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  PHONE_844,
  SHOTS_DIR,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  gotoScene,
  harnessUrl,
  launch,
  openPage,
  pickViewports,
  wait,
} from './lib'
import { attempt, decodedFrom } from './page'

const VIEWPORTS = [UPRIGHT_390, PHONE_844]

// NOTE: how much of the screen the fake keyboard covers.
const KEYBOARD_SHARE = 0.45
// NOTE: how long the game gets to answer a resize before it is read.
const SETTLE_MS = 400

type Field = Readonly<{ name: string; query: string; selector: string }>

const FIELDS: ReadonlyArray<Field> = [
  {
    name: 'profile-name',
    query: 'profile=name',
    selector: '#profile-name-input',
  },
  {
    name: 'link-code',
    query: 'profile=account&sync=synced&link=entering',
    selector: '#link-code-input',
  },
  { name: 'coop-code', query: 'coop=code', selector: '#coop-code' },
  { name: 'coop-name', query: 'coop=name', selector: '#coop-name-input' },
]

const Layout = Schema.Struct({
  layout: Schema.String,
  screenHeight: Schema.String,
  orientation: Schema.String,
  surfaceWidth: Schema.Finite,
  surfaceHeight: Schema.Finite,
  isFocused: Schema.Boolean,
  fieldTop: Schema.Finite,
  fieldBottom: Schema.Finite,
})
type Layout = typeof Layout.Type

// NOTE: what the keyboard must not change, read off the root and the Model.
const layoutOf = (page: Page, selector: string) =>
  decodedFrom(Layout, () =>
    page.evaluate(field => {
      const root = document.querySelector('.game-root')
      const model = window.__model
      const surface =
        model.maybeSurface._tag === 'Some'
          ? model.maybeSurface.value
          : { width: -1, height: -1 }
      return {
        layout: root?.getAttribute('data-layout') ?? '',
        screenHeight:
          root instanceof HTMLElement
            ? root.style.getPropertyValue('--screen-h')
            : '',
        orientation: model.orientation,
        surfaceWidth: surface.width,
        surfaceHeight: surface.height,
        isFocused: document.activeElement === document.querySelector(field),
        fieldTop:
          document.querySelector(field)?.getBoundingClientRect().top ?? -1,
        fieldBottom:
          document.querySelector(field)?.getBoundingClientRect().bottom ?? -1,
      }
    }, selector),
  )

// NOTE: iOS's keyboard: the layout viewport stays and only the visual
// viewport shrinks, with its resize events.
const fakeIosKeyboard = (page: Page, height: number) =>
  attempt(() =>
    page.evaluate(visibleHeight => {
      const viewport = window.visualViewport
      if (viewport !== null) {
        Object.defineProperty(viewport, 'height', {
          configurable: true,
          get: () => visibleHeight,
        })
        viewport.dispatchEvent(new Event('resize'))
      }
      window.dispatchEvent(new Event('resize'))
    }, height),
  )

const liftIosKeyboard = (page: Page) =>
  attempt(() =>
    page.evaluate(() => {
      const viewport = window.visualViewport
      if (viewport !== null) {
        Reflect.deleteProperty(viewport, 'height')
        viewport.dispatchEvent(new Event('resize'))
      }
      window.dispatchEvent(new Event('resize'))
    }),
  )

const changesFrom = (
  where: string,
  before: Layout,
  after: Layout,
): ReadonlyArray<string> => {
  const watched: ReadonlyArray<readonly [string, string, string]> = [
    ['layout', before.layout, after.layout],
    ['--screen-h', before.screenHeight, after.screenHeight],
    ['orientation', before.orientation, after.orientation],
    ['surface width', `${before.surfaceWidth}`, `${after.surfaceWidth}`],
    ['surface height', `${before.surfaceHeight}`, `${after.surfaceHeight}`],
  ]
  return [
    ...(after.isFocused ? [] : [`${where}: the field lost its focus`]),
    ...Array.map(
      Array.filter(watched, ([, was, is]) => was !== is),
      ([label, was, is]) => `${where}: ${label} ${was} became ${is}`,
    ),
  ]
}

// NOTE: the field must show above the keyboard, lifted if it has to be,
// and never off the top of the screen.
const hiddenUnder = (
  where: string,
  layout: Layout,
  keyboardTop: number,
): ReadonlyArray<string> =>
  layout.fieldBottom <= keyboardTop && layout.fieldTop >= 0
    ? []
    : [
        `${where}: the field (${Math.round(layout.fieldTop)} to ${Math.round(layout.fieldBottom)}) is not between the top and the keyboard (${keyboardTop})`,
      ]

const checkField = (page: Page, viewport: Viewport, field: Field) =>
  Effect.gen(function* () {
    const where = `${viewport.name} ${field.name}`
    yield* gotoScene(page, harnessUrl(field.query, deviceQuery(viewport)))
    yield* attempt(() => page.tap(field.selector))
    yield* wait(SETTLE_MS)
    const before = yield* layoutOf(page, field.selector)
    const keyboardTop = Math.round(viewport.height * (1 - KEYBOARD_SHARE))

    yield* fakeIosKeyboard(page, keyboardTop)
    yield* wait(SETTLE_MS)
    const withIosKeyboard = yield* layoutOf(page, field.selector)
    yield* attempt(() =>
      page.screenshot({
        path: `${SHOTS_DIR}/keyboard-${viewport.name}-${field.name}.png`,
      }),
    )
    yield* liftIosKeyboard(page)

    yield* attempt(() =>
      page.setViewportSize({ width: viewport.width, height: keyboardTop }),
    )
    yield* wait(SETTLE_MS)
    const withSqueeze = yield* layoutOf(page, field.selector)

    yield* attempt(() =>
      page.setViewportSize({ width: viewport.width, height: viewport.height }),
    )
    yield* attempt(() =>
      page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur()
        }
      }),
    )
    yield* wait(SETTLE_MS)
    const afterBlur = yield* layoutOf(page, field.selector)

    return [
      ...(before.isFocused ? [] : [`${where}: a tap did not focus the field`]),
      ...hiddenUnder(`${where} iOS keyboard`, withIosKeyboard, keyboardTop),
      ...hiddenUnder(`${where} squeezed page`, withSqueeze, keyboardTop),
      ...changesFrom(`${where} iOS keyboard`, before, withIosKeyboard),
      ...changesFrom(`${where} squeezed page`, before, withSqueeze),
      ...(afterBlur.surfaceHeight === before.surfaceHeight
        ? []
        : [
            `${where}: after the field let go the surface did not measure back`,
          ]),
    ]
  })

runHarnessAudit(
  Effect.gen(function* () {
    const viewports = yield* pickViewports(VIEWPORTS)
    const browser = yield* Effect.acquireRelease(
      attempt(() => launch()),
      launched => attempt(() => launched.close()).pipe(Effect.ignore),
    )
    const problems = yield* Effect.forEach(viewports, viewport =>
      Effect.gen(function* () {
        const page = yield* openPage(browser, viewport)
        const found = yield* Effect.forEach(FIELDS, field =>
          checkField(page, viewport, field),
        )
        yield* attempt(() => page.context().close())
        return Array.flatten(found)
      }),
    )
    yield* finish(
      Array.flatten(problems),
      'The keyboard overlays every text field, upright and on its side.',
    )
  }),
)
