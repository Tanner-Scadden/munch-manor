// The knife and two gun slots pass: the knife in hand mid-slash into a
// Groaner, the HUD's slots with the pistol traded for a Pressure Cooker and
// the melee slot on their right (with a gun in hand, and with the knife),
// the Clang Pan in the melee slot, the row in a break with the trap and
// hold-to-buy buttons up and mid-wave at the stall, and the shop's GUNS tab
// offering the Pop Pistol back for $0, on a 1280x720 desktop, an 844x390
// phone on its side, and 360x800, 390x844, and 430x932 phones held upright,
// as `s40-<TAG>-<viewport>-<scene>.png`. It checks that the knife in hand
// stabs on the trigger, that the guns are centered with the melee slot on
// their right and on touch the reload button past it, all in one row (the
// reload button square in portrait), each a thumb wide, none covering
// another or the buttons over the row, all on screen, and that the shop
// offers the pistol for $0. Exits with 1 on any miss.
//   TAG=after bun run heavy -- --shared bun tools/audit/shots40.ts
// ONLY picks scenes, such as `ONLY=slash`, and VIEWPORTS picks screens.
import { Array, Console, Effect, Option, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_360,
  UPRIGHT_390,
  UPRIGHT_430,
  type Viewport,
  auditTag,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  openBrowser,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
} from './lib'
import { type AuditFailed, attempt } from './page'
import { FIGHTING, LEARNED } from './scenes'

// NOTE: the shot screens plus the narrowest and widest phones held
// upright, where the portrait row is tightest and loosest.
const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_360, name: 'p360' },
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_430, name: 'p430' },
])

type Scene = Readonly<{
  name: string
  query: string
  act?: (
    page: Page,
    problems: Array<string>,
    label: string,
    viewport: Viewport,
  ) => Effect.Effect<void, AuditFailed>
}>

const rowCheck = (
  page: Page,
  problems: Array<string>,
  label: string,
  viewport: Viewport,
) =>
  checkSlots(
    page,
    problems,
    label,
    viewport.isPhone,
    viewport.height > viewport.width,
  )

type Edges = Readonly<{
  left: number
  right: number
  top: number
  bottom: number
}>

type Box = Edges & Readonly<{ name: string }>

const overlaps = (a: Edges, b: Edges): boolean =>
  a.left < b.right - 1 &&
  a.right > b.left + 1 &&
  a.top < b.bottom - 1 &&
  a.bottom > b.top + 1

// NOTE: the HUD row (changed at the owner's request on 2026-10-30): the two
// guns centered on the screen, the melee slot on their right, and on touch
// the reload button past it, all in one row (in portrait the slots stack
// and the reload button is square). Every target is a thumb wide, none
// covers another, and all are on screen. A desktop has no reload button: R
// reloads.
const checkSlots = (
  page: Page,
  problems: Array<string>,
  label: string,
  isTouch: boolean,
  isPortrait: boolean,
): Effect.Effect<void, AuditFailed> =>
  Effect.gen(function* () {
    const { boxes, stage } = yield* attempt(() =>
      page.evaluate(() => {
        const edgesOf = (element: Element, name: string) => {
          const { left, right, top, bottom } = element.getBoundingClientRect()
          return { name, left, right, top, bottom }
        }
        const faceOf = (element: Element) =>
          element.querySelector('.reload-face') ?? element
        const stageBox = document
          .querySelector('.hud-tap-stage')
          ?.getBoundingClientRect()
        return {
          boxes: [
            ...globalThis.Array.from(
              document.querySelectorAll('.gun-slot-button'),
              element =>
                edgesOf(element, element.getAttribute('data-slot') ?? ''),
            ),
            ...globalThis.Array.from(
              document.querySelectorAll('.reload-button'),
              element => edgesOf(element, 'Reload'),
            ),
            ...globalThis.Array.from(
              document.querySelectorAll('.reload-button'),
              element => edgesOf(faceOf(element), 'ReloadFace'),
            ),
            ...globalThis.Array.from(
              document.querySelectorAll(
                '.gun-cluster-side button, .gun-cluster-top button',
              ),
              element =>
                edgesOf(
                  element,
                  element.getAttribute('aria-label') ?? 'button',
                ),
            ),
          ],
          stage:
            stageBox === undefined
              ? null
              : { left: stageBox.left, right: stageBox.right },
        }
      }),
    )
    const find = (name: string): Box | undefined =>
      Option.getOrUndefined(Array.findFirst(boxes, box => box.name === name))
    const first = find('First')
    const second = find('Second')
    const knife = find('Melee')
    const reload = find('Reload')
    const face = find('ReloadFace')
    if (first === undefined || second === undefined || knife === undefined) {
      problems.push(
        `${label}: missing a slot (${Array.join(
          Array.map(boxes, box => box.name),
          ', ',
        )})`,
      )
      return
    }
    if (stage !== null) {
      const middle = (stage.left + stage.right) / 2
      const gunsMiddle = (first.left + second.right) / 2
      if (Math.abs(gunsMiddle - middle) > 3) {
        problems.push(
          `${label}: the guns are ${Math.round(gunsMiddle - middle)} px off the screen's middle`,
        )
      }
    }
    if (second.right > knife.left + 1 || first.right > second.left + 1) {
      problems.push(`${label}: the melee slot is not right of the guns`)
    }
    if (Math.abs(first.top - knife.top) > 1) {
      problems.push(`${label}: the melee slot is not in the guns' row`)
    }
    if (isTouch) {
      if (reload === undefined || face === undefined) {
        problems.push(`${label}: no reload button on touch`)
      } else {
        if (reload.left < knife.right - 1) {
          problems.push(`${label}: the reload button is not right of the melee`)
        }
        if (Math.abs(face.bottom - knife.bottom) > 1) {
          problems.push(`${label}: the reload button is not in the row`)
        }
        if (
          isPortrait &&
          Math.abs(face.right - face.left - (face.bottom - face.top)) > 1
        ) {
          problems.push(`${label}: the reload button is not square`)
        }
      }
      if (
        reload !== undefined &&
        (reload.right - reload.left < 47 || reload.bottom - reload.top < 47)
      ) {
        problems.push(`${label}: the reload button is under a thumb's 48 px`)
      }
    } else if (reload !== undefined) {
      problems.push(`${label}: a reload button on a desktop`)
    }
    const others = Array.filter(
      boxes,
      box =>
        !Array.contains(
          ['First', 'Second', 'Melee', 'Reload', 'ReloadFace'],
          box.name,
        ),
    )
    Array.forEach([first, second, knife], box => {
      if (isTouch && box.right - box.left < 47) {
        problems.push(`${label}: ${box.name} is under a thumb's 48 px`)
      }
    })
    const targets = [
      first,
      second,
      knife,
      ...(reload === undefined ? [] : [reload]),
      ...others,
    ]
    Array.forEach(targets, (a, index) =>
      Array.forEach(Array.drop(targets, index + 1), b => {
        if (overlaps(a, b)) {
          problems.push(`${label}: ${a.name} covers ${b.name}`)
        }
      }),
    )
    const size = page.viewportSize()
    if (
      size !== null &&
      Array.some(
        targets,
        box =>
          box.left < 0 ||
          box.top < 0 ||
          box.right > size.width ||
          box.bottom > size.height,
      )
    ) {
      problems.push(`${label}: a slot is off screen`)
    }
  })

const SCENES: ReadonlyArray<Scene> = [
  {
    name: 'slash',
    query: `${FIGHTING}&gun=smg&iced=pan&stab&tick=4`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        const knifeCooldownMs = yield* attempt(() =>
          page.evaluate(() => window.__model.seats[0].player.knifeCooldownMs),
        )
        if (knifeCooldownMs <= 0) {
          problems.push(`${label}: the knife in hand did not stab`)
        }
      }),
  },
  {
    name: 'slots',
    query: `${FIGHTING}&first=cooker&gun=smg&tier=2&tick=2`,
    act: rowCheck,
  },
  {
    name: 'knifed',
    query: `${FIGHTING}&first=cooker&gun=smg&tier=2&knife&tick=2`,
    act: (page, problems, label, viewport) =>
      Effect.gen(function* () {
        yield* rowCheck(page, problems, label, viewport)
        const held = yield* attempt(() =>
          page.evaluate(
            () =>
              document
                .querySelector('.gun-slot-button[data-slot="Melee"]')
                ?.getAttribute('data-held') ?? '',
          ),
        )
        if (held !== 'true') {
          problems.push(`${label}: the knife's slot is not held`)
        }
      }),
  },
  {
    name: 'pan',
    query: `${FIGHTING}&first=cooker&gun=smg&pan&tier=1&loaded=9&tick=2`,
    act: (page, problems, label, viewport) =>
      Effect.gen(function* () {
        yield* rowCheck(page, problems, label, viewport)
        const name = yield* attempt(() =>
          page.evaluate(
            () =>
              document
                .querySelector('.gun-slot-button[data-slot="Melee"]')
                ?.getAttribute('aria-label') ?? '',
          ),
        )
        if (!String.includes('Pan')(name)) {
          problems.push(`${label}: the melee slot does not hold the Pan`)
        }
      }),
  },
  {
    name: 'break',
    query: `wave=3&seen=all&first=cooker&gun=smg&money=85&barricades=1&turrets=1&px=70&py=27&${LEARNED}`,
    act: rowCheck,
  },
  {
    name: 'stall',
    query: `${FIGHTING}&gun=smg&loaded=9&rounds=40&money=85&px=240&py=146&tick=2`,
    act: rowCheck,
  },
  {
    name: 'shop',
    query: `wave=5&money=180&first=cooker&gun=smg&tier=1&px=270&py=142&${LEARNED}`,
    act: (page, problems, label) =>
      Effect.gen(function* () {
        const row = yield* attempt(() =>
          page.evaluate(
            () =>
              document
                .querySelector('#shop-item-Pistol')
                ?.getAttribute('aria-label') ?? '',
          ),
        )
        if (!String.includes('$0')(row)) {
          problems.push(`${label}: the shop does not offer the pistol for $0`)
        }
      }),
  },
]

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* VIEWPORTS
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    const problems: Array<string> = []
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        const label = `${viewport.name} ${scene.name}`
        yield* settleAnimations(page)
        if (scene.act !== undefined) {
          yield* scene.act(page, problems, label, viewport)
        }
        yield* shot(page, `s40-${tag}-${viewport.name}-${scene.name}`)
        yield* Console.log(`shot ${label}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(
      problems,
      'The knife and two gun slots pass found no problems.',
    )
  }),
)
