// Plays past the wave 1 practice gate in headless Chrome, reloads, and checks
// that the on-device save brought the player back with the gate open and
// the sound still muted. The save lives in SQLite now (see sqlite.ts for the
// storage itself), so this reads it back only through the game.
//   BASE=http://localhost:4173/ bun save.ts
import { GAME, desktop, launch, wait } from './lib'

const BASE = process.env['BASE'] ?? GAME
const GATE_NOTE = 'The wave waits until you try moving, aiming, and firing.'

const browser = await launch()
const page = await desktop(browser)
const failures: Array<string> = []
const check = (isOk: boolean, label: string) => {
  console.log(`${isOk ? 'ok  ' : 'FAIL'} ${label}`)
  if (!isOk) {
    failures.push(label)
  }
}

const status = () =>
  page.evaluate(
    () => document.querySelector('[role="status"].sr-only')?.textContent ?? '',
  )

// NOTE: the Sound toggle in the home menu's settings shows the setting.
const isMutedOnHome = async () => {
  await page.click('#home-settings')
  const sound = page.locator(
    '.setting-toggle:has(.setting-label:text-is("Sound"))',
  )
  return (await sound.getAttribute('aria-pressed')) === 'false'
}

const awaitSplashGone = () =>
  page.waitForFunction(() => document.getElementById('splash') === null, {
    timeout: 30_000,
  })

await page.goto(BASE)
await awaitSplashGone()
await page.reload()
await awaitSplashGone()

await page.click('.home-play')
await wait(300)
// NOTE: a first visit asks for a difficulty before the first run.
await page.getByRole('button', { name: /^normal/i }).click()
await page.keyboard.press('KeyM')
await wait(300)
check(
  (await status()).includes(GATE_NOTE),
  'a new player meets the practice gate',
)

await wait(2600)
await page.keyboard.down('KeyD')
await wait(700)
await page.keyboard.up('KeyD')
const canvas = await page.locator('.game-surface').boundingBox()
if (canvas !== null) {
  await page.mouse.move(
    canvas.x + canvas.width * 0.8,
    canvas.y + canvas.height * 0.3,
  )
  for (const _ of [1, 2, 3, 4, 5]) {
    await page.mouse.down()
    await wait(120)
    await page.mouse.up()
    await wait(250)
  }
}
await wait(400)
check(!(await status()).includes(GATE_NOTE), 'moving and firing opens the gate')
await wait(500)

await page.reload()
await awaitSplashGone()
await page.click('.home-play')
await wait(300)
// NOTE: a player past the practice gate gets the lobby, and START plays.
await page.click('#lobby-start')
await wait(300)
check(
  !(await status()).includes(GATE_NOTE),
  'after a reload the gate stays open',
)
await page.reload()
await awaitSplashGone()
check(await isMutedOnHome(), 'after a reload the sound is still muted')

await browser.close()
if (failures.length > 0) {
  process.exit(1)
}
