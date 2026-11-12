// Every menu by controller, end to end in headless Chrome, with the stand-in
// pad of tools/audit/padStandIn.ts and no mouse or keyboard: the d-pad
// steps the home menu, A opens the MORE hand, its How to play, Munchopedia,
// and What's New panels, the Profile (whose tabs the bumper turns), co-op
// where it ships, and the lobby with its hero picker; B closes each. The
// end card and pause take the d-pad and B too. The focus ring must show on
// what has focus. Screenshots go to `padmenus-<TAG>-d1280-<step>.png`.
//   TAG=after bun run heavy -- --shared bun tools/audit/padMenus.ts
import { Effect, Schema } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  auditTag,
  closePage,
  finish,
  harnessUrl,
  modelAs,
  openBrowser,
  openPage,
  sceneReady,
  shot,
  wait,
} from './lib'
import {
  A,
  B,
  DPAD_DOWN,
  DPAD_RIGHT,
  DPAD_UP,
  RB,
  padStandIn,
  pressPad,
} from './padStandIn'
import { attempt, evaluateAs } from './page'

// NOTE: a returning player, so PLAY opens the lobby rather than starting
// a new player's first run.
const VETERAN =
  'learned=move,fire,startWave,swap,pickup,timedBreaks,openBreak,dareTour,dareKey,rattles&rank=4000&calling=Handyman'

const FocusView = Schema.Struct({
  id: Schema.String,
  isInDialog: Schema.Boolean,
  isInCoop: Schema.Boolean,
  ring: Schema.String,
  openDialogs: Schema.Finite,
  selectedTab: Schema.String,
  isLobbyOpen: Schema.Boolean,
  isCoopOpen: Schema.Boolean,
  hasCoopButton: Schema.Boolean,
})
type FocusView = typeof FocusView.Type

// NOTE: what has focus and what is open, read in the page.
const focusView = (page: Page) =>
  evaluateAs(page, FocusView, () => {
    const active = document.activeElement
    const isControl = active instanceof HTMLElement && active !== document.body
    // NOTE: a hand card draws its ring on its face, not itself.
    const face = isControl
      ? (active.querySelector('.hand-card-face') ?? active)
      : null
    const selected = document.querySelector(
      "dialog[open] [role='tab'][aria-selected='true']",
    )
    return {
      id: isControl ? active.id : '',
      isInDialog: isControl && active.closest('dialog[open]') !== null,
      isInCoop: isControl && active.closest('section.coop') !== null,
      ring: face === null ? 'none' : getComputedStyle(face).outlineStyle,
      openDialogs: document.querySelectorAll('dialog[open]').length,
      selectedTab: selected === null ? '' : selected.textContent,
      isLobbyOpen: document.querySelector('#lobby-back') !== null,
      isCoopOpen: document.querySelector('section.coop') !== null,
      hasCoopButton: document.querySelector('#home-coop') !== null,
    }
  })

const DeviceView = Schema.Struct({
  lastDevice: Schema.String,
  phase: Schema.Struct({ _tag: Schema.String }),
})

const deviceView = (page: Page) => modelAs(page, DeviceView)

// NOTE: long enough for a dialog to open or close and its focus to land.
const SETTLE_MS = 600

// NOTE: presses one way until the control with this id has focus, as a
// player hunting for it would, or gives up after a lap.
const stepTo = (page: Page, id: string, button: number, most: number) =>
  Effect.gen(function* () {
    for (let step = 0; step < most; step += 1) {
      const view = yield* focusView(page)
      if (view.id === id) {
        return true
      }
      yield* pressPad({ page, button })
    }
    const last = yield* focusView(page)
    return last.id === id
  })

const press = (page: Page, button: number) =>
  Effect.gen(function* () {
    yield* pressPad({ page, button })
    yield* wait(SETTLE_MS)
    return yield* focusView(page)
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const browser = yield* openBrowser
    const viewport = DESKTOP_1280
    const problems: Array<string> = []
    const check = (isFine: boolean, problem: string) => {
      if (!isFine) {
        problems.push(`${viewport.name}: ${problem}`)
      }
    }
    const shotOf = (page: Page, step: string) =>
      shot(page, `padmenus-${tag}-${viewport.name}-${step}`)
    const isRinged = (view: FocusView) => view.ring !== 'none'
    const reach = (
      on: Page,
      id: string,
      button: number,
      problem: string,
      most = 8,
    ) =>
      Effect.map(stepTo(on, id, button, most), isThere =>
        check(isThere, problem),
      )

    const page = yield* openPage(browser, viewport)
    yield* attempt(() => page.addInitScript(padStandIn))
    yield* attempt(() => page.goto(harnessUrl(VETERAN, 'nodev')))
    yield* sceneReady(page)
    yield* wait(300)

    // THE HOME MENU
    const home = yield* press(page, DPAD_DOWN)
    const device = yield* deviceView(page)
    check(device.lastDevice === 'Gamepad', 'the d-pad did not take the device')
    check(home.id === 'home-play', `the d-pad focused ${home.id}, not PLAY`)
    check(isRinged(home), 'no focus ring on the home menu')
    yield* shotOf(page, 'home')
    const stepped = yield* press(page, DPAD_DOWN)
    check(stepped.id !== home.id, 'the d-pad did not step the home menu')

    // THE MORE HAND
    yield* reach(page, 'home-manor', DPAD_DOWN, 'the d-pad never reached MORE')
    const hand = yield* press(page, A)
    check(hand.openDialogs > 0, 'A on MORE opened no hand')
    const handStep = yield* press(page, DPAD_RIGHT)
    check(handStep.isInDialog, 'the d-pad left the hand')
    check(isRinged(handStep), 'no focus ring in the hand')
    yield* shotOf(page, 'hand')
    const handShut = yield* press(page, B)
    check(handShut.openDialogs === 0, 'B did not put the hand away')

    // THE HAND'S PANELS
    for (const card of ['howtoplay', 'munchopedia', 'whatsnew']) {
      yield* reach(
        page,
        'home-manor',
        DPAD_DOWN,
        `the d-pad never got back to MORE for ${card}`,
      )
      yield* press(page, A)
      yield* reach(
        page,
        `hand-card-${card}`,
        DPAD_RIGHT,
        `the d-pad never reached the ${card} card`,
      )
      const panel = yield* press(page, A)
      check(panel.openDialogs > 0, `A on ${card} opened no panel`)
      const inside = yield* press(page, DPAD_DOWN)
      check(inside.isInDialog, `the d-pad left the ${card} panel`)
      check(isRinged(inside), `no focus ring in the ${card} panel`)
      yield* press(page, RB)
      yield* shotOf(page, card)
      const closed = yield* press(page, B)
      check(closed.openDialogs === 0, `B did not close the ${card} panel`)
    }

    // THE PROFILE
    yield* reach(
      page,
      'home-settings',
      DPAD_DOWN,
      'the d-pad never reached the gear',
    )
    const profile = yield* press(page, A)
    check(profile.openDialogs > 0, 'A on the gear opened no Profile')
    const turned = yield* press(page, RB)
    check(
      turned.selectedTab !== profile.selectedTab,
      `RB did not turn the Profile's tab (${profile.selectedTab})`,
    )
    const profileStep = yield* press(page, DPAD_DOWN)
    check(profileStep.isInDialog, 'the d-pad left the Profile')
    check(isRinged(profileStep), 'no focus ring in the Profile')
    yield* shotOf(page, 'profile')
    const profileShut = yield* press(page, B)
    check(profileShut.openDialogs === 0, 'B did not close the Profile')

    // CO-OP, where this build ships it
    if (profileShut.hasCoopButton) {
      yield* reach(
        page,
        'home-coop',
        DPAD_DOWN,
        'the d-pad never reached CO-OP',
      )
      const coop = yield* press(page, A)
      check(coop.isCoopOpen, 'A on CO-OP opened nothing')
      const coopStep = yield* press(page, DPAD_DOWN)
      check(coopStep.isInCoop, "the d-pad left co-op's screen")
      yield* shotOf(page, 'coop')
      const coopShut = yield* press(page, B)
      check(!coopShut.isCoopOpen, 'B did not back out of co-op')
    }

    // THE LOBBY AND THE HERO PICKER
    yield* reach(
      page,
      'home-play',
      DPAD_DOWN,
      'the d-pad never got back to PLAY',
    )
    const lobby = yield* press(page, A)
    check(lobby.isLobbyOpen, 'A on PLAY opened no lobby')
    yield* reach(
      page,
      'lobby-hero',
      DPAD_UP,
      "the d-pad never reached the lobby's hero",
      24,
    )
    yield* shotOf(page, 'lobby')
    const picker = yield* press(page, A)
    check(picker.openDialogs > 0, 'A on the hero opened no picker')
    const pickerStep = yield* press(page, DPAD_RIGHT)
    check(pickerStep.isInDialog, 'the d-pad left the hero picker')
    yield* shotOf(page, 'heroes')
    const pickerShut = yield* press(page, B)
    check(pickerShut.openDialogs === 0, 'B did not close the hero picker')
    const lobbyShut = yield* press(page, B)
    check(!lobbyShut.isLobbyOpen, 'B did not back out of the lobby')
    yield* closePage(page)

    // THE END CARD
    const end = yield* openPage(browser, viewport)
    yield* attempt(() => end.addInitScript(padStandIn))
    yield* attempt(() => end.goto(harnessUrl('wave=3&phase=gameover', 'nodev')))
    yield* sceneReady(end)
    yield* wait(1500)
    const endStep = yield* press(end, DPAD_RIGHT)
    check(endStep.id !== '', 'the d-pad focused nothing on the end card')
    check(isRinged(endStep), 'no focus ring on the end card')
    yield* shotOf(end, 'end')
    yield* closePage(end)

    // PAUSE
    const paused = yield* openPage(browser, viewport)
    yield* attempt(() => paused.addInitScript(padStandIn))
    yield* attempt(() =>
      paused.goto(harnessUrl('wave=3&start=wave&phase=paused', 'nodev')),
    )
    yield* sceneReady(paused)
    yield* wait(300)
    yield* press(paused, DPAD_DOWN)
    yield* shotOf(paused, 'paused')
    yield* press(paused, B)
    const resumed = yield* deviceView(paused)
    check(
      resumed.phase._tag !== 'Paused',
      `B did not resume from pause (${resumed.phase._tag})`,
    )
    yield* closePage(paused)

    yield* finish(
      problems,
      'A controller walks every menu: focus, A, B, and the bumpers.',
    )
  }),
)
