// The Profile pass: each tab of the Profile (Look, Name, Account in each link
// step, Settings and its reset question) on a desktop, a landscape phone, and
// upright phones (390, 360, and 375 wide), as `s37-<TAG>-<viewport>-<scene>.png`. It exits with 1 on
// a phone button under 48 px, a text field under 16 px (iOS zooms in on
// those), a row of Look options that leaves one alone on a line or runs
// past its page, or the Profile past the screen's edge.
//   TAG=after bun run heavy -- bun tools/audit/shots37.ts
import { Array, Effect, String } from 'effect'
import type { Page } from 'playwright-core'

import { runHarnessAudit } from './harnessServer'
import {
  DESKTOP_1280,
  PHONE_844,
  UPRIGHT_360,
  UPRIGHT_375,
  UPRIGHT_390,
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
import { attempt } from './page'

const PICKABLE_VIEWPORTS: ReadonlyArray<Viewport> = [
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_360, name: 'p360' },
  { ...UPRIGHT_375, name: 'p375' },
]

type Scene = Readonly<{
  name: string
  query: string
  click?: ReadonlyArray<string>
}>

const LOOK = 'look=Slim,Ponytail,Red,Tan,Teal,Hoodie,Rainbow,,Glasses'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'look', query: `profile=look&${LOOK}` },
  ...Array.map(['Hair', 'Outfit'], section => ({
    name: `look-${String.toLowerCase(section)}`,
    query: `profile=look&looksection=${section}&${LOOK}`,
  })),
  // NOTE: the first option of every row chosen, at the page's left edge.
  {
    name: 'look-first',
    query: 'profile=look&look=Slim,Short,Black,Fair,Blue',
  },
  { name: 'name-empty', query: 'profile=name' },
  { name: 'name', query: 'profile=name&name=Dr. Chomp' },
  { name: 'account-local', query: 'profile=account' },
  { name: 'account', query: 'profile=account&sync=synced&devices=2' },
  {
    name: 'account-syncing',
    query: 'profile=account&sync=offline&devices=3',
  },
  {
    name: 'account-showing',
    query: 'profile=account&sync=synced&link=showing',
  },
  {
    name: 'account-entering',
    query: 'profile=account&sync=synced&link=entering',
  },
  {
    name: 'account-linked',
    query: 'profile=account&sync=synced&devices=2&link=linked',
  },
  {
    name: 'account-failed',
    query: 'profile=account&sync=synced&link=failed',
  },
  // NOTE: rank on the plate: a Wood badge part way up, then a long way up.
  { name: 'look-rank', query: `profile=look&${LOOK}&rank=1850` },
  { name: 'name-rank-high', query: 'profile=name&name=Dr. Chomp&rank=52000' },
  { name: 'settings', query: 'profile=settings&fit=full&rotate' },
  {
    name: 'settings-reset',
    query: 'profile=settings',
    click: ['#reset-tutorial'],
  },
]

// NOTE: runs in the page, which has no Effect: plain loops, so no native
// Array method is left for the Effect rules to flag.
const readProfile = () => {
  const panel = document.querySelector('.profile')
  const box = panel?.getBoundingClientRect()
  const buttons: Array<{
    label: string
    width: number
    height: number
    isShown: boolean
  }> = []
  for (const button of document.querySelectorAll('.profile-dialog button')) {
    const rect = button.getBoundingClientRect()
    buttons.push({
      // NOTE: runs in the page, where effect's String is not loaded.
      // @effect-diagnostics-next-line preferEffectString:off
      label: button.getAttribute('aria-label') ?? button.textContent.trim(),
      width: rect.width,
      height: rect.height,
      isShown: rect.width > 0 && rect.height > 0,
    })
  }
  const fields: Array<{ id: string; size: number }> = []
  for (const input of document.querySelectorAll('.profile-dialog input')) {
    fields.push({
      id: input.id,
      size: Number.parseFloat(getComputedStyle(input).fontSize),
    })
  }
  const labelOf = (row: Element) =>
    row.querySelector('.look-row-label')?.textContent ?? '?'
  const wrappedRows: Array<string> = []
  const clippedRows: Array<string> = []
  for (const row of document.querySelectorAll('.look-row')) {
    // NOTE: the chosen option grows a little, so only a whole line of
    // difference is a wrap. A long list takes even lines (balancedColumns in
    // src/characterView.ts); what must never happen is an option left on a
    // line of its own, or a line not much more than half as full as the
    // first.
    const lines = new Map<number, number>()
    for (const button of row.querySelectorAll('button')) {
      const top = button.getBoundingClientRect().top
      let line = top
      for (const seen of lines.keys()) {
        if (Math.abs(seen - top) <= 20) {
          line = seen
          break
        }
      }
      lines.set(line, (lines.get(line) ?? 0) + 1)
    }
    const counts: Array<number> = []
    for (const top of [...lines.keys()].sort((a, b) => a - b)) {
      counts.push(lines.get(top) ?? 0)
    }
    const first = counts[0] ?? 0
    for (const count of counts) {
      if ((count === 1 && first > 1) || count * 2 < first) {
        wrappedRows.push(labelOf(row))
        break
      }
    }
    const pageBox = row.closest('.profile-page')?.getBoundingClientRect()
    if (pageBox !== undefined) {
      for (const button of row.querySelectorAll('button')) {
        if (button.getBoundingClientRect().right > pageBox.right + 1) {
          clippedRows.push(labelOf(row))
          break
        }
      }
    }
  }
  return {
    wrappedRows,
    clippedRows,
    box:
      box !== undefined
        ? {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
          }
        : null,
    buttons,
    fields,
    width: innerWidth,
    height: innerHeight,
  }
}

const checkLayout = (
  page: Page,
  viewport: Viewport,
  where: string,
  problems: Array<string>,
) =>
  Effect.gen(function* () {
    const found = yield* attempt(() => page.evaluate(readProfile))
    if (found.box === null) {
      problems.push(`${where}: no Profile open`)
      return
    }
    if (
      found.box.left < 0 ||
      found.box.top < 0 ||
      found.box.right > found.width ||
      found.box.bottom > found.height
    ) {
      problems.push(`${where}: the Profile is past the screen's edge`)
    }
    for (const label of found.wrappedRows) {
      problems.push(
        `${where}: the ${label} row of the Look tab leaves an option alone`,
      )
    }
    for (const label of found.clippedRows) {
      problems.push(
        `${where}: the ${label} row of the Look tab runs off its page`,
      )
    }
    for (const field of found.fields) {
      if (field.size < 16) {
        problems.push(`${where}: #${field.id} is ${field.size}px, under 16px`)
      }
    }
    if (viewport.isPhone) {
      for (const button of found.buttons) {
        if (button.isShown && (button.width < 47.5 || button.height < 47.5)) {
          problems.push(
            `${where}: "${button.label}" is ${Math.round(button.width)}x${Math.round(button.height)}`,
          )
        }
      }
    }
  })

runHarnessAudit(
  Effect.gen(function* () {
    const tag = yield* auditTag
    const viewports = yield* pickViewports(PICKABLE_VIEWPORTS)
    const problems: Array<string> = []
    const browser = yield* openBrowser
    const pages = scenePages(browser, ['nodev'])
    for (const viewport of viewports) {
      for (const scene of SCENES) {
        if (!(yield* isPickedScene(scene.name))) {
          continue
        }
        const page = yield* pages.open(
          viewport,
          harnessQuery(scene.query, deviceQuery(viewport)),
        )
        yield* attempt(() =>
          page.waitForSelector('.profile-dialog[open] .profile-page', {
            timeout: 15000,
          }),
        )
        yield* settleAnimations(page)
        for (const selector of scene.click ?? []) {
          yield* attempt(() => page.click(selector))
          yield* settleAnimations(page)
        }
        const where = `${viewport.name} ${scene.name}`
        yield* checkLayout(page, viewport, where, problems)
        yield* shot(page, `s37-${tag}-${viewport.name}-${scene.name}`)
        pages.release(page)
      }
    }
    yield* pages.close
    yield* finish(
      problems,
      'Every Profile tab fits, with big enough buttons and fields.',
    )
  }),
)
