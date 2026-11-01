// Plays co-op through the real game UI, in headless Chrome, two to three
// players each in their own browser context (their own device key, so
// their own player), against a build whose VITE_API_ORIGIN has the room
// Worker and VITE_COOP=On: a local workerd (tools/mp-dev/local.ts) or a pull
// request preview. Each page starts with a save that has finished the
// tutorial. The first creates a room from the CO-OP tile; the rest join from
// its `?room=` link; every seat shows; everyone presses READY and the run
// opens as the game's own scene. Then the real game: everyone walks and
// sees the others move, presses READY to start wave 1 early, and shoots
// zombies with the mouse; the last player walks into the zombies until they
// go down and the first walks over and stands still to revive them; the
// wave is cleared, the next break opens the stall, and the first player
// walks in and buys; everyone presses READY again. One page reloads and
// rejoins its seat; one leaves. It reports each page's round trip, what came
// down a second, and how far its own player was corrected. With QUICK=1, two
// fresh pages then press QUICK PLAY, take the offer to start with two after
// 45 s, and must land in one room. Screenshots go to
// `tools/audit/shots/coop-e2e-*.png`. VIEWPORT=p390 or l844 shoots a phone
// held upright or sideways instead of a desktop (the walking and shooting
// use keys and the mouse either way). PICK=Endless,Hard has the host pick
// that mode and difficulty in the lobby (after a guest's READY, which the
// pick takes back) and checks every page plays it. NET=200,50,2 puts each
// page behind a bad link: a 200 ms round trip, up to 50 ms of jitter, and
// 2% of messages held a round trip more (at least 200 ms) as a lost TCP
// segment's resend would be, order kept (the page's WebSockets are
// wrapped; Chrome's own throttling leaves WebSockets alone). It reports
// hit registration (the hits each page saw its own tracers make against
// the hits the room confirmed), stalls (gaps of 200 ms or more with
// nothing from the room), and resyncs (a message that would not apply).
// Run it through the heavy guard, as a Shared job (one context per page):
//   bun run heavy -- --shared bun tools/audit/coop.ts http://localhost:4398/ [players]
import { Array, Order, Schema, pipe } from 'effect'
import type { Page } from 'playwright-core'

import { type Readout } from '@game/coop/readout'

import {
  BASE,
  IS_QUICK,
  PICK_DIFFICULTY,
  PICK_MODE,
  PLAYERS,
} from './coop/config'
import { type Held, heldOf, playFor, stopAll } from './coop/controllers'
import {
  RANKS,
  VIEWPORT,
  VIEWPORT_NAME,
  browser,
  check,
  contexts,
  filledSeats,
  openPlayer,
  problems,
  roomCodeOf,
  shot,
  until,
} from './coop/players'
import {
  type Seat,
  isOnArena,
  netOf,
  ownSeatOf,
  readoutOf,
  slotOf,
} from './coop/readouts'
import { awaitGame, finish, nowMs, pollUntil, wait } from './lib'
import { evaluateAs } from './page'

// HEROES

// NOTE: each page plays a different hero, unlocked by the rank its save holds
// (RANKS 3, 8, 10 reach the Handyman at 3, the Track Star at 6, the Penny
// Pincher at 10). The host picks at home, through the home menu's pill and
// picker; each guest picks in the lobby, through the lobby's own pill. Every
// page must then see the others' prop icons in the lobby, and the room must
// seat each slot as its hero.
const HEROES = ['Handyman', 'TrackStar', 'PennyPincher'] as const

const pickAtHome = async (page: Page, hero: string) => {
  await page.click('.home-calling')
  await page.click(`.calling-card[data-calling="${hero}"]`)
}

const pickInLobby = async (page: Page, hero: string) => {
  await page.click('#coop-calling-pill')
  await page.click(`.coop-calling-picker .calling-card[data-calling="${hero}"]`)
}

// NOTE: the hero each filled seat shows, in seat order; YOU shows none.
const heroesSeenBy = (page: Page) =>
  evaluateAs(page, Schema.Array(Schema.String), () =>
    globalThis.Array.from(
      document.querySelectorAll('.coop-seat:not([data-state="Empty"])'),
      seat =>
        seat.querySelector('.coop-calling')?.getAttribute('data-calling') ??
        'You',
    ),
  )

// ROOM BY CODE

console.log(
  `Co-op through the game UI at ${BASE}, ${PLAYERS} players, ${VIEWPORT_NAME}`,
)
const host = await openPlayer('host')
await host.goto(BASE)
await awaitGame(host)
await pickAtHome(host, HEROES[0])
await host.click('#home-coop')
await until('the CO-OP tile opens the hub', () =>
  host.getByRole('button', { name: /Quick play/ }).isVisible(),
)
await shot(host, 'hub')
await host.getByRole('button', { name: 'Make a room for friends' }).click()
await until(
  'NEW ROOM lands in a lobby with a code',
  async () => (await roomCodeOf(host)).length === 5,
)
const code = await roomCodeOf(host)
console.log(`  room ${code}`)
check(
  new URL(host.url()).searchParams.get('room') === code,
  'the address carries the room code',
)

const guests: Array<Page> = []
for (const index of globalThis.Array.from(
  { length: PLAYERS - 1 },
  (_, i) => i,
)) {
  const guest = await openPlayer(`guest ${index + 1}`, index + 1)
  const link = new URL(BASE)
  link.searchParams.set('room', code)
  await guest.goto(link.href)
  await awaitGame(guest)
  guests.push(guest)
}
const firstGuest = guests[0]
const lastGuest = guests.at(-1)
if (firstGuest === undefined || lastGuest === undefined) {
  throw new Error('No guest page')
}
const everyone = [host, ...guests]
const helds: Array<Held> = everyone.map(() => ({
  keys: new Set(),
  firing: false,
}))

for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} sees ${PLAYERS} seats filled`,
    async () => (await filledSeats(page)) === PLAYERS,
  )
}
for (const [index, page] of guests.entries()) {
  await pickInLobby(page, HEROES[index + 1] ?? 'Handyman')
}
for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} sees every hero's prop in the lobby`,
    async () =>
      (await heroesSeenBy(page)).join() === HEROES.slice(0, PLAYERS).join(),
  )
}
check(
  (await host.locator('.coop-kick').count()) === PLAYERS - 1,
  'the host can kick each guest',
)
check(
  (await firstGuest.locator('.coop-kick').count()) === 0,
  'a guest cannot kick',
)
await shot(host, 'lobby-host')

const headOf = (page: Page, who: 'Me' | 'Other', at = 0) =>
  page
    .locator(`.coop-seat[data-me="${who}"] .coop-seat-head`)
    .nth(at)
    .evaluate(element => getComputedStyle(element).backgroundImage)
const hostHead = await headOf(host, 'Me')
const guestHead = await headOf(firstGuest, 'Me')
check(hostHead !== guestHead, 'the host and the guest wear different looks')
check(
  (await headOf(host, 'Other')) === guestHead &&
    (await headOf(firstGuest, 'Other')) === hostHead,
  'each page draws the other player in their own look',
)

const rankOn = (page: Page, who: 'Me' | 'Other') =>
  page.locator(`.coop-seat[data-me="${who}"] .coop-rank`).first().innerText()
check(
  (await rankOn(host, 'Me')) === `${RANKS[0]}` &&
    (await rankOn(host, 'Other')) === `${RANKS[1]}` &&
    (await rankOn(firstGuest, 'Me')) === `${RANKS[1]}` &&
    (await rankOn(firstGuest, 'Other')) === `${RANKS[0]}`,
  'each page reads the other players rank beside their name',
)

if (PICK_MODE !== undefined && PICK_DIFFICULTY !== undefined) {
  await firstGuest.getByRole('button', { name: 'READY' }).click()
  await until(
    'a guest READY stamps on the host',
    async () => (await host.locator('.coop-stamp').count()) === 1,
  )
  await host.getByRole('button', { name: PICK_MODE, exact: true }).click()
  await host.getByRole('button', { name: PICK_DIFFICULTY, exact: true }).click()
  for (const [index, page] of everyone.entries()) {
    await until(
      `player ${index + 1} sees ${PICK_MODE} on ${PICK_DIFFICULTY}`,
      async () =>
        (await page
          .locator(`.coop-picks[aria-label="${PICK_MODE}, ${PICK_DIFFICULTY}"]`)
          .count()) === 1,
    )
  }
  await until(
    'the pick takes back the READY stamps',
    async () => (await host.locator('.coop-stamp').count()) === 0,
  )
  await shot(host, 'picks-host')
  await shot(firstGuest, 'picks-guest')
}

for (const page of everyone.slice(0, -1)) {
  await page.getByRole('button', { name: 'READY' }).click()
}
await until(
  'the READY stamps show on the host',
  async () => (await host.locator('.coop-stamp').count()) === PLAYERS - 1,
)
await lastGuest.getByRole('button', { name: 'READY' }).click()

for (const [index, page] of everyone.entries()) {
  await until(
    `player ${index + 1} plays the room's World in the game's own scene`,
    async () =>
      (await readoutOf(page))?.players.length === PLAYERS &&
      (await isOnArena(page)) &&
      (await page.locator('.game-canvas').isVisible()),
  )
}
for (const [index, page] of everyone.entries()) {
  const maybeReadout = await readoutOf(page)
  const seated =
    maybeReadout === undefined
      ? undefined
      : pipe(
          maybeReadout.players,
          Array.sort(Order.mapInput(Order.Number, (seat: Seat) => seat.slot)),
          Array.map(seat => seat.calling),
        )
  check(
    seated?.join() === HEROES.slice(0, PLAYERS).join(),
    `player ${index + 1} sees the room seat ${HEROES.slice(0, PLAYERS).join(', ')} (${seated?.join(', ')})`,
  )
}
if (PICK_MODE !== undefined && PICK_DIFFICULTY !== undefined) {
  for (const [index, page] of everyone.entries()) {
    const readout = await readoutOf(page)
    check(
      readout?.mode === PICK_MODE && readout.difficulty === PICK_DIFFICULTY,
      `player ${index + 1} plays ${PICK_MODE} on ${PICK_DIFFICULTY} (${readout?.mode} on ${readout?.difficulty})`,
    )
  }
}
await wait(400)
await shot(host, 'countdown')
const startNet = await Promise.all(everyone.map(netOf))
const startedMs = nowMs()

// NOTE: the link is measured over the fight, while the room still sends,
// or until now on a phone, which only fights for its pictures.
const linkNow = async () => ({
  nets: await Promise.all(everyone.map(netOf)),
  atMs: nowMs(),
})
let linkAtEnd: Awaited<ReturnType<typeof linkNow>> | undefined

// WALKING

const positionsOn = async (page: Page) =>
  new Map((await readoutOf(page))?.players.map(seat => [seat.slot, seat]) ?? [])

// NOTE: everyone holds their key until the guest's page draws every player
// moved, not for a fixed time: on a slow link the others' steps come down
// late, and a reading taken after a fixed wait missed them.
const before = await positionsOn(firstGuest)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.down(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
const movedOn = async (page: Page) =>
  [...(await positionsOn(page)).values()].filter(
    seat => Math.abs(seat.x - (before.get(seat.slot)?.x ?? seat.x)) > 10,
  )
const { last: moved } = await pollUntil(
  () => movedOn(firstGuest).catch(() => []),
  seats => seats.length === PLAYERS,
  100,
  10_000,
)
await Promise.all(
  everyone.map((page, index) =>
    page.keyboard.up(index % 2 === 0 ? 'KeyD' : 'KeyA'),
  ),
)
const guestSlot = await slotOf(firstGuest)
check(
  moved.filter(seat => seat.slot !== guestSlot).length === PLAYERS - 1,
  `a guest sees the ${PLAYERS - 1} others walk`,
)
check(
  moved.some(seat => seat.slot === guestSlot),
  'a guest walks its own player, predicted',
)
await shot(firstGuest, 'walked')

// READY STARTS THE WAVE

for (const page of everyone) {
  await page.keyboard.press('Enter')
}
await until(
  'READY from everyone starts wave 1 before its clock',
  async () => (await readoutOf(host))?.phase === 'Wave',
  4000,
)

// NOTE: a phone draws the upright or sideways layout with its own camera,
// so the scripted mouse aim (which reads the desktop's still parlour) is
// off there: on a phone the players fight a while for the pictures, and
// the desktop run checks the kills, the revive, the break, and the shop.
const isPhone = VIEWPORT_NAME !== 'd1280'

if (isPhone) {
  await playFor(
    everyone,
    helds,
    () => 'Fight',
    -1,
    async () => false,
    12_000,
  )
  // NOTE: keys made each phone a keyboard; a tap makes it a touch screen
  // again, which draws the phone's own layout and its touch controls.
  for (const [index, page] of everyone.entries()) {
    await stopAll(page, heldOf(helds, index))
    await page.touchscreen.tap(VIEWPORT.width / 2, VIEWPORT.height * 0.45)
  }
  await wait(500)
  await shot(host, 'wave')
  await shot(firstGuest, 'wave-guest')
} else {
  // THE FIGHT AND A REVIVE

  const killsOn = async (page: Page) =>
    (await readoutOf(page))?.players.reduce(
      (sum, seat) => sum + seat.kills,
      0,
    ) ?? 0

  const shotKills = await playFor(
    everyone,
    helds,
    () => 'Fight',
    -1,
    async () => (await killsOn(host)) >= 3,
    60_000,
  )
  check(shotKills, 'the players shoot zombies, each kill to its shooter')
  // NOTE: kept in case the run ends before the revive's reading below.
  linkAtEnd = await linkNow()
  await shot(host, 'fight')
  await shot(firstGuest, 'fight-guest')

  const feeder = everyone.length - 1
  const feederSlot = await slotOf(lastGuest)
  // NOTE: the others guard meanwhile, firing only at what comes at them, or
  // they shoot the zombies before any reaches the feeder.
  const downed = await playFor(
    everyone,
    helds,
    index => (index === feeder ? 'Feed' : 'Guard'),
    feederSlot,
    async () =>
      (await readoutOf(host))?.players.find(seat => seat.slot === feederSlot)
        ?.life === 'Downed',
    90_000,
  )
  check(downed, 'a player who walks into the zombies goes down')
  if (downed) {
    await shot(host, 'downed')
    const revived = await playFor(
      everyone,
      helds,
      index => (index === 0 ? 'Revive' : index === feeder ? 'Idle' : 'Fight'),
      feederSlot,
      async () =>
        (await readoutOf(host))?.players.find(seat => seat.slot === feederSlot)
          ?.life === 'Standing',
      12_000,
    )
    check(revived, 'a teammate standing still beside them revives them')
    await shot(host, 'revived')
  }

  const linkAfterRevive = await linkNow()
  if (linkAfterRevive.nets.every(net => net !== undefined)) {
    linkAtEnd = linkAfterRevive
  }

  // THE BREAK, THE STALL, AND READY

  // NOTE: everyone clears the rest of the wave. A teammate left standing
  // idle was eaten, and then the host alone, and the party wiped back to
  // the lobby. The break's bonus pays for something at the stall. A wipe
  // ends the step at once (no readout off the arena) and says so.
  const isBreak = (readout: Readout | undefined) =>
    readout?.phase === 'Preparation' && readout.wave === 2
  await playFor(
    everyone,
    helds,
    () => 'Fight',
    -1,
    async () => !(await isOnArena(host)) || isBreak(await readoutOf(host)),
    180_000,
  )
  check(await isOnArena(host), 'the party lives through wave 1')
  check(
    isBreak(await readoutOf(host)),
    'the wave is cleared and the next break opens',
  )
  await Promise.all(
    everyone.map((page, index) => stopAll(page, heldOf(helds, index))),
  )
  await shot(host, 'break')

  const moneyBefore = (await ownSeatOf(host))?.money ?? 0
  const atStall = await playFor(
    everyone,
    helds,
    index => (index === 0 ? 'Shop' : 'Idle'),
    -1,
    async () => (await ownSeatOf(host))?.shop === 'Browsing',
    15_000,
  )
  check(atStall, 'the host walks into the stall')
  await Promise.all(
    everyone.map((page, index) => stopAll(page, heldOf(helds, index))),
  )
  const shopOpen = await until(
    'one shop dialog opens, for the host only',
    async () =>
      (await host.locator('dialog#shop').count()) === 1 &&
      (await host.locator('dialog[open]').count()) === 1 &&
      (await firstGuest.locator('.shop-dialog[open]').count()) === 0,
  )
  if (shopOpen) {
    await shot(host, 'shop')
    const available = host.locator(
      '.shop-dialog[open] li[data-verdict="available"] button',
    )
    const tabs = host.locator('.shop-dialog[open] .shop-tab')
    for (const index of globalThis.Array.from(
      { length: await tabs.count() },
      (_, i) => i,
    )) {
      if ((await available.count()) > 0) {
        break
      }
      await tabs.nth(index).click()
      await until(
        `shop tab ${index + 1} opens`,
        async () =>
          (await tabs.nth(index).getAttribute('aria-selected')) === 'true',
        5000,
      )
    }
    if ((await available.count()) > 0) {
      await shot(host, 'shop-tab')
      await available.first().click()
      await until(
        'a purchase goes to the room and the money comes off',
        async () => ((await ownSeatOf(host))?.money ?? 0) < moneyBefore,
        5000,
      )
    } else {
      console.log(`  note nothing affordable with $${moneyBefore}`)
    }
    await host.keyboard.press('Escape')
    await until(
      'closing the shop tells the room',
      async () => (await ownSeatOf(host))?.shop !== 'Browsing',
      5000,
    )
  }

  for (const page of everyone) {
    await page.keyboard.press('Enter')
  }
  await until(
    'READY over everyone shows, then wave 2 starts',
    async () => {
      const readout = await readoutOf(host)
      return readout?.phase === 'Wave' && readout.wave === 2
    },
    6000,
  )
}

// THE LINK

const endNet = linkAtEnd ?? (await linkNow())
const seconds = (endNet.atMs - startedMs) / 1000
for (const [index, net] of endNet.nets.entries()) {
  const start = startNet[index]
  if (net === undefined || start === undefined) {
    console.log(`  player ${index + 1}: no link readout (not in the run)`)
    continue
  }
  const kbps = (net.bytesIn - start.bytesIn) / 1024 / seconds
  const inputs = (net.inputsOut - start.inputsOut) / seconds
  console.log(
    `  player ${index + 1}: round trip ${net.rttMs} ms, down ${kbps.toFixed(2)} KB/s over ${net.framesIn - start.framesIn} messages (${((net.framesIn - start.framesIn) / seconds).toFixed(1)} a second), up ${inputs.toFixed(1)} inputs a second, ${net.corrections} corrections (at most ${net.correctionPx} px)`,
  )
  console.log(
    `  player ${index + 1}: hits seen ${net.lookedHits - start.lookedHits}, confirmed ${net.confirmedHits - start.confirmedHits}; drawn ${net.delayMs} ms behind; ${net.stalls - start.stalls} stalls, ${net.resyncs - start.resyncs} resyncs (the longest gap all session ${net.longestStallMs} ms)`,
  )
  check(net.rttMs > 0, `player ${index + 1} measured a round trip`)
}

// REJOIN

const rejoiner = firstGuest
const rejoinSlot = await slotOf(rejoiner)
await rejoiner.reload()
await awaitGame(rejoiner)
await until(
  'a reloaded guest rejoins its seat from the address',
  async () =>
    (await slotOf(rejoiner)) === rejoinSlot &&
    (await readoutOf(rejoiner))?.players.length === PLAYERS,
)
await shot(rejoiner, 'rejoined')

// LEAVE

const leaver = lastGuest
await leaver.getByRole('button', { name: 'Leave the room' }).click()
await until('LEAVE lands back on the hub', () =>
  leaver.getByRole('button', { name: /Quick play/ }).isVisible(),
)
check(
  new URL(leaver.url()).searchParams.get('room') === null,
  'leaving clears the room from the address',
)

// QUICK PLAY

if (IS_QUICK) {
  const quickOne = await openPlayer('quick 1')
  const quickTwo = await openPlayer('quick 2')
  const quick = [quickOne, quickTwo]
  for (const page of quick) {
    await page.goto(BASE)
    await awaitGame(page)
    await page.click('#home-coop')
    await page.getByRole('button', { name: /Quick play/ }).click()
  }
  await until(
    'two queued players see two heads',
    async () =>
      (await quickOne
        .locator('.coop-queue-seat[data-state="Filled"]')
        .count()) === 2,
  )
  await shot(quickOne, 'queue')
  await until(
    'the offer to start with two comes',
    () => quickOne.locator('.coop-offer-start').isVisible(),
    60_000,
  )
  for (const page of quick) {
    await page.locator('.coop-offer-start').click()
  }
  for (const [index, page] of quick.entries()) {
    await until(
      `quick player ${index + 1} lands in a lobby`,
      async () => (await filledSeats(page)) === 2,
    )
  }
  check(
    (await roomCodeOf(quickOne)) === (await roomCodeOf(quickTwo)),
    'both quick players share one room',
  )
}

for (const context of contexts) {
  await context.close()
}
await browser.close()
finish(
  problems,
  'Co-op played a real wave through the game UI with no problems.',
)
