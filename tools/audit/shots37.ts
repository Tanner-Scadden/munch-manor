// The Profile pass: each tab of the Profile (Look, Name, Account in each link
// step, Settings and its reset question) on a desktop, a landscape phone, and
// upright phones (390, 360, and 375 wide), as `s37-<TAG>-<viewport>-<scene>.png`. It exits with 1 on
// a phone button under 48 px, a text field under 16 px (iOS zooms in on
// those), a row of Look options that leaves one alone on a line or runs
// past its page, or the Profile past the screen's edge.
//   TAG=after bun run heavy -- bun tools/audit/shots37.ts
import type { Page } from 'playwright-core'

import {
  DESKTOP_1280,
  PHONE_844,
  TAG,
  UPRIGHT_360,
  UPRIGHT_375,
  UPRIGHT_390,
  type Viewport,
  deviceQuery,
  finish,
  harnessQuery,
  isPickedScene,
  launch,
  pickViewports,
  scenePages,
  settleAnimations,
  shot,
  useHarness,
} from './lib'

const VIEWPORTS = pickViewports([
  { ...DESKTOP_1280, name: 'd1280' },
  { ...PHONE_844, name: 'l844' },
  { ...UPRIGHT_390, name: 'p390' },
  { ...UPRIGHT_360, name: 'p360' },
  { ...UPRIGHT_375, name: 'p375' },
])

type Scene = Readonly<{
  name: string
  query: string
  click?: ReadonlyArray<string>
}>

const LOOK = 'look=Slim,Ponytail,Red,Tan,Teal,Hoodie,Rainbow,,Glasses'

const SCENES: ReadonlyArray<Scene> = [
  { name: 'look', query: `profile=look&${LOOK}` },
  ...['Hair', 'Outfit'].map(section => ({
    name: `look-${section.toLowerCase()}`,
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

const problems: Array<string> = []

const checkLayout = async (page: Page, viewport: Viewport, where: string) => {
  const found = await page.evaluate(() => {
    const panel = document.querySelector('.profile')
    const box = panel?.getBoundingClientRect()
    const buttons = [
      ...document.querySelectorAll('.profile-dialog button'),
    ].map(button => {
      const rect = button.getBoundingClientRect()
      return {
        label: button.getAttribute('aria-label') ?? button.textContent.trim(),
        width: rect.width,
        height: rect.height,
        isShown: rect.width > 0 && rect.height > 0,
      }
    })
    const fields = [...document.querySelectorAll('.profile-dialog input')].map(
      input => ({
        id: input.id,
        size: Number.parseFloat(getComputedStyle(input).fontSize),
      }),
    )
    const wrappedRows = [...document.querySelectorAll('.look-row')]
      .filter(row => {
        // NOTE: the chosen option grows a little, so only a whole line
        // of difference is a wrap.
        const tops = [...row.querySelectorAll('button')].map(
          button => button.getBoundingClientRect().top,
        )
        // NOTE: a long list takes even lines (balancedColumns in
        // src/characterView.ts); what must never happen is an option
        // left on a line of its own, or a line not much more than half
        // as full as the first.
        const lines = new Map<number, number>()
        for (const top of tops) {
          const line = [...lines.keys()].find(
            seen => Math.abs(seen - top) <= 20,
          )
          lines.set(line ?? top, (lines.get(line ?? top) ?? 0) + 1)
        }
        const counts = [...lines.entries()]
          .sort(([a], [b]) => a - b)
          .map(([, count]) => count)
        const first = counts[0] ?? 0
        return counts.some(
          count => (count === 1 && first > 1) || count * 2 < first,
        )
      })
      .map(row => row.querySelector('.look-row-label')?.textContent ?? '?')
    const clippedRows = [...document.querySelectorAll('.look-row')]
      .filter(row => {
        const pageBox = row.closest('.profile-page')?.getBoundingClientRect()
        return (
          pageBox !== undefined &&
          [...row.querySelectorAll('button')].some(
            button => button.getBoundingClientRect().right > pageBox.right + 1,
          )
        )
      })
      .map(row => row.querySelector('.look-row-label')?.textContent ?? '?')
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
  })
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
}

await useHarness()
const browser = await launch()
const pages = scenePages(browser, ['nodev'])
for (const viewport of VIEWPORTS) {
  for (const scene of SCENES) {
    if (!isPickedScene(scene.name)) {
      continue
    }
    const page = await pages.open(
      viewport,
      harnessQuery(scene.query, deviceQuery(viewport)),
    )
    await page.waitForSelector('.profile-dialog[open] .profile-page', {
      timeout: 15000,
    })
    await settleAnimations(page)
    for (const selector of scene.click ?? []) {
      await page.click(selector)
      await settleAnimations(page)
    }
    const where = `${viewport.name} ${scene.name}`
    await checkLayout(page, viewport, where)
    await shot(page, `s37-${TAG}-${viewport.name}-${scene.name}`)
    pages.release(page)
  }
}
await pages.close()
await browser.close()
finish(problems, 'Every Profile tab fits, with big enough buttons and fields.')
