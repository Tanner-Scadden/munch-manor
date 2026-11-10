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
import {
  Array,
  Clock,
  Console,
  Effect,
  Option,
  Order,
  Schema,
  pipe,
} from 'effect'
import type { Page } from 'playwright-core'

import { type Readout } from '@game/features/coop/readout'

import { coopConfig } from './coop/config'
import { type Held, heldOf, playFor, stopAll } from './coop/controllers'
import {
  RANKS,
  check,
  contexts,
  filledSeats,
  openPlayer,
  problems,
  roomCodeOf,
  shot,
  until,
  untilWithin,
  viewportName,
  viewportOf,
} from './coop/players'
import { type Seat, isOnArena, netOf, readoutOf, slotOf } from './coop/readouts'
import {
  awaitGame,
  countOf,
  finish,
  openBrowser,
  pollUntil,
  runAudit,
  wait,
} from './lib'
import { attempt, evaluateAs, failWith } from './page'

// HEROES

// NOTE: each page plays a different hero, unlocked by the rank its save holds
// (RANKS 6, 8, 10 reach the Handyman at 3, the Track Star at 6, the Penny
// Pincher at 10) and bought with the Bones that rank's veteran grant pays (75,
// 122, 180: the heroes cost 60, 100, 150). The host picks at home, through the
// single player lobby's hero card and picker; each guest picks in the lobby,
// through the lobby's own pill. A hero for sale is tried on by its card and
// bought with the picker's BUY pill. Every page must then see the others' prop
// icons in the lobby, and the room must seat each slot as its hero.
const HEROES = ['Handyman', 'TrackStar', 'PennyPincher'] as const

// NOTE: buys the hero just tried on when it is for sale, then closes the
// picker if it is still open.
const buyAndClose = (page: Page) =>
  Effect.gen(function* () {
    const buy = page.locator('.calling-buy:not([disabled])').first()
    if (yield* attempt(() => buy.isVisible())) {
      yield* attempt(() => buy.click())
    }
    const isPickerOpen = yield* attempt(() =>
      page.locator('.calling-card').first().isVisible(),
    )
    if (isPickerOpen) {
      yield* attempt(() => page.keyboard.press('Escape'))
    }
  })

const pickAtHome = (page: Page, hero: string) =>
  Effect.gen(function* () {
    yield* attempt(() => page.click('#home-play'))
    yield* attempt(() => page.click('#lobby-hero'))
    yield* attempt(() => page.click(`.calling-card[data-calling="${hero}"]`))
    yield* buyAndClose(page)
    yield* attempt(() => page.click('#lobby-back'))
  })

const pickInLobby = (page: Page, hero: string) =>
  Effect.gen(function* () {
    yield* attempt(() => page.click('#coop-calling-pill'))
    yield* attempt(() =>
      page.click(`.coop-calling-picker .calling-card[data-calling="${hero}"]`),
    )
    yield* buyAndClose(page)
  })

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

const headOf = (page: Page, who: 'Me' | 'Other') =>
  attempt(() =>
    page
      .locator(`.coop-seat[data-me="${who}"] .coop-seat-head`)
      .nth(0)
      .evaluate(element => getComputedStyle(element).backgroundImage),
  )

const rankOn = (page: Page, who: 'Me' | 'Other') =>
  attempt(() =>
    page.locator(`.coop-seat[data-me="${who}"] .coop-rank`).first().innerText(),
  )

const positionsOn = (page: Page) =>
  Effect.map(
    readoutOf(page),
    readout =>
      new Map(Array.map(readout?.players ?? [], seat => [seat.slot, seat])),
  )

const seatOf = (readout: Readout | undefined, slot: number) =>
  Option.getOrUndefined(
    Array.findFirst(readout?.players ?? [], seat => seat.slot === slot),
  )

const program = Effect.gen(function* () {
  const config = yield* coopConfig
  const viewportNameValue = yield* viewportName
  const viewport = viewportOf(viewportNameValue)
  const browser = yield* openBrowser
  const players = config.players
  const pickMode = config.pickMode
  const pickDifficulty = config.pickDifficulty
  const heroLine = Array.join(Array.take(HEROES, players), ',')

  // ROOM BY CODE

  yield* Console.log(
    `Co-op through the game UI at ${config.base}, ${players} players, ${viewportNameValue}`,
  )
  const host = yield* openPlayer(browser, 'host', 0)
  yield* attempt(() => host.goto(config.base))
  yield* awaitGame(host)
  yield* pickAtHome(host, HEROES[0])
  yield* attempt(() => host.click('#home-coop'))
  yield* until(
    'the CO-OP tile opens the hub',
    attempt(() => host.getByRole('button', { name: /Quick play/ }).isVisible()),
  )
  yield* shot(host, 'hub')
  yield* attempt(() =>
    host.getByRole('button', { name: 'Make a room for friends' }).click(),
  )
  yield* until(
    'NEW ROOM lands in a lobby with a code',
    Effect.map(roomCodeOf(host), roomCode => roomCode.length === 5),
  )
  const code = yield* roomCodeOf(host)
  yield* Console.log(`  room ${code}`)
  yield* check(
    new URL(host.url()).searchParams.get('room') === code,
    'the address carries the room code',
  )

  const guests: Array<Page> = []
  for (const index of globalThis.Array.from(
    { length: players - 1 },
    (_, i) => i,
  )) {
    const guest = yield* openPlayer(browser, `guest ${index + 1}`, index + 1)
    const link = new URL(config.base)
    link.searchParams.set('room', code)
    yield* attempt(() => guest.goto(link.href))
    yield* awaitGame(guest)
    guests.push(guest)
  }
  const firstGuest = guests[0]
  const lastGuest = Option.getOrUndefined(Array.last(guests))
  if (firstGuest === undefined || lastGuest === undefined) {
    return yield* failWith('No guest page')
  }
  const everyone = [host, ...guests]
  const helds: Array<Held> = Array.map(everyone, () => ({
    keys: new Set(),
    firing: false,
  }))

  for (const [index, page] of everyone.entries()) {
    yield* until(
      `player ${index + 1} sees ${players} seats filled`,
      Effect.map(filledSeats(page), filled => filled === players),
    )
  }
  for (const [index, page] of guests.entries()) {
    yield* pickInLobby(page, HEROES[index + 1] ?? 'Handyman')
  }
  for (const [index, page] of everyone.entries()) {
    yield* until(
      `player ${index + 1} sees every hero's prop in the lobby`,
      Effect.map(
        heroesSeenBy(page),
        heroes => Array.join(heroes, ',') === heroLine,
      ),
    )
  }
  const hostKicks = yield* countOf(host, '.coop-kick')
  yield* check(hostKicks === players - 1, 'the host can kick each guest')
  const guestKicks = yield* countOf(firstGuest, '.coop-kick')
  yield* check(guestKicks === 0, 'a guest cannot kick')
  yield* shot(host, 'lobby-host')

  const hostHead = yield* headOf(host, 'Me')
  const guestHead = yield* headOf(firstGuest, 'Me')
  yield* check(
    hostHead !== guestHead,
    'the host and the guest wear different looks',
  )
  const hostSeesGuest = (yield* headOf(host, 'Other')) === guestHead
  yield* check(
    hostSeesGuest && (yield* headOf(firstGuest, 'Other')) === hostHead,
    'each page draws the other player in their own look',
  )

  const ranksRead =
    (yield* rankOn(host, 'Me')) === `${RANKS[0]}` &&
    (yield* rankOn(host, 'Other')) === `${RANKS[1]}` &&
    (yield* rankOn(firstGuest, 'Me')) === `${RANKS[1]}` &&
    (yield* rankOn(firstGuest, 'Other')) === `${RANKS[0]}`
  yield* check(
    ranksRead,
    'each page reads the other players rank beside their name',
  )

  if (pickMode !== undefined && pickDifficulty !== undefined) {
    yield* attempt(() =>
      firstGuest.getByRole('button', { name: 'READY' }).click(),
    )
    yield* until(
      'a guest READY stamps on the host',
      Effect.map(countOf(host, '.coop-stamp'), count => count === 1),
    )
    yield* attempt(() =>
      host.getByRole('button', { name: pickMode, exact: true }).click(),
    )
    yield* attempt(() =>
      host.getByRole('button', { name: pickDifficulty, exact: true }).click(),
    )
    for (const [index, page] of everyone.entries()) {
      yield* until(
        `player ${index + 1} sees ${pickMode} on ${pickDifficulty}`,
        Effect.map(
          countOf(
            page,
            `.coop-picks[aria-label="${pickMode}, ${pickDifficulty}"]`,
          ),
          count => count === 1,
        ),
      )
    }
    yield* until(
      'the pick takes back the READY stamps',
      Effect.map(countOf(host, '.coop-stamp'), count => count === 0),
    )
    yield* shot(host, 'picks-host')
    yield* shot(firstGuest, 'picks-guest')
  }

  for (const page of Array.dropRight(everyone, 1)) {
    yield* attempt(() => page.getByRole('button', { name: 'READY' }).click())
  }
  yield* until(
    'the READY stamps show on the host',
    Effect.map(countOf(host, '.coop-stamp'), count => count === players - 1),
  )
  yield* attempt(() => lastGuest.getByRole('button', { name: 'READY' }).click())

  for (const [index, page] of everyone.entries()) {
    yield* until(
      `player ${index + 1} plays the room's World in the game's own scene`,
      Effect.gen(function* () {
        const readout = yield* readoutOf(page)
        return (
          readout?.players.length === players &&
          (yield* isOnArena(page)) &&
          (yield* attempt(() => page.locator('.game-canvas').isVisible()))
        )
      }),
    )
  }
  for (const [index, page] of everyone.entries()) {
    const maybeReadout = yield* readoutOf(page)
    const seated =
      maybeReadout === undefined
        ? undefined
        : pipe(
            maybeReadout.players,
            Array.sort(Order.mapInput(Order.Number, (seat: Seat) => seat.slot)),
            Array.map(seat => seat.calling),
          )
    yield* check(
      (seated === undefined ? undefined : Array.join(seated, ',')) === heroLine,
      `player ${index + 1} sees the room seat ${Array.join(Array.take(HEROES, players), ', ')} (${seated === undefined ? undefined : Array.join(seated, ', ')})`,
    )
  }
  if (pickMode !== undefined && pickDifficulty !== undefined) {
    for (const [index, page] of everyone.entries()) {
      const readout = yield* readoutOf(page)
      yield* check(
        readout?.mode === pickMode && readout.difficulty === pickDifficulty,
        `player ${index + 1} plays ${pickMode} on ${pickDifficulty} (${readout?.mode} on ${readout?.difficulty})`,
      )
    }
  }
  yield* wait(400)
  yield* shot(host, 'countdown')

  // THE INTRO

  // NOTE: the room's first run opens on the whole intro
  // (src/world/run/arrival.ts). A key skips each page's own drawing to the
  // door, and the room's slam starts the first break for everyone at once.
  for (const page of everyone) {
    yield* attempt(() => page.keyboard.press('Escape'))
  }
  yield* untilWithin(
    "the room's slam starts the first break on every page",
    Effect.map(Effect.forEach(everyone, readoutOf), readouts =>
      Array.every(readouts, readout => readout?.phase === 'Preparation'),
    ),
    25_000,
  )
  const netsOfEveryone = Effect.forEach(everyone, netOf, {
    concurrency: 'unbounded',
  })
  const startNet = yield* netsOfEveryone
  const startedMs = yield* Clock.currentTimeMillis

  // NOTE: the link is measured over the fight, while the room still sends,
  // or until now on a phone, which only fights for its pictures.
  const linkNow = Effect.gen(function* () {
    const nets = yield* netsOfEveryone
    const atMs = yield* Clock.currentTimeMillis
    return { nets, atMs }
  })
  let linkAtEnd: Effect.Success<typeof linkNow> | undefined

  // WALKING

  // NOTE: everyone holds their key until the guest's page draws every player
  // moved, not for a fixed time: on a slow link the others' steps come down
  // late, and a reading taken after a fixed wait missed them.
  const before = yield* positionsOn(firstGuest)
  const walkKeyOf = (index: number) => (index % 2 === 0 ? 'KeyD' : 'KeyA')
  yield* Effect.forEach(
    everyone,
    (page, index) => attempt(() => page.keyboard.down(walkKeyOf(index))),
    { concurrency: 'unbounded', discard: true },
  )
  const movedOn = (page: Page) =>
    Effect.map(positionsOn(page), positions =>
      Array.filter(
        [...positions.values()],
        seat => Math.abs(seat.x - (before.get(seat.slot)?.x ?? seat.x)) > 10,
      ),
    )
  const { last: moved } = yield* pollUntil(
    movedOn(firstGuest).pipe(
      Effect.orElseSucceed((): ReadonlyArray<Seat> => []),
    ),
    seats => seats.length === players,
    100,
    10_000,
  )
  yield* Effect.forEach(
    everyone,
    (page, index) => attempt(() => page.keyboard.up(walkKeyOf(index))),
    { concurrency: 'unbounded', discard: true },
  )
  const guestSlot = yield* slotOf(firstGuest)
  yield* check(
    Array.filter(moved, seat => seat.slot !== guestSlot).length === players - 1,
    `a guest sees the ${players - 1} others walk`,
  )
  yield* check(
    Array.some(moved, seat => seat.slot === guestSlot),
    'a guest walks its own player, predicted',
  )
  yield* shot(firstGuest, 'walked')

  // READY STARTS THE WAVE

  for (const page of everyone) {
    yield* attempt(() => page.keyboard.press('Enter'))
  }
  yield* untilWithin(
    'READY from everyone starts wave 1 before its clock',
    Effect.map(readoutOf(host), readout => readout?.phase === 'Wave'),
    4000,
  )

  // NOTE: a phone draws the upright or sideways layout with its own camera,
  // so the scripted mouse aim (which reads the desktop's still parlour) is
  // off there: on a phone the players fight a while for the pictures, and
  // the desktop run checks the kills, the revive, the break, and the shop.
  const isPhone = viewportNameValue !== 'd1280'
  const stopEveryone = Effect.forEach(
    everyone,
    (page, index) =>
      heldOf(helds, index).pipe(Effect.flatMap(held => stopAll(page, held))),
    { concurrency: 'unbounded', discard: true },
  )

  if (isPhone) {
    yield* playFor(
      everyone,
      helds,
      () => 'Fight',
      -1,
      Effect.succeed(false),
      12_000,
    )
    // NOTE: keys made each phone a keyboard; a tap makes it a touch screen
    // again, which draws the phone's own layout and its touch controls.
    for (const [index, page] of everyone.entries()) {
      const held = yield* heldOf(helds, index)
      yield* stopAll(page, held)
      yield* attempt(() =>
        page.touchscreen.tap(viewport.width / 2, viewport.height * 0.45),
      )
    }
    yield* wait(500)
    yield* shot(host, 'wave')
    yield* shot(firstGuest, 'wave-guest')
  } else {
    // THE FIGHT AND A REVIVE

    const killsOn = (page: Page) =>
      Effect.map(readoutOf(page), readout =>
        Array.reduce(
          readout?.players ?? [],
          0,
          (sum, seat) => sum + seat.kills,
        ),
      )

    const shotKills = yield* playFor(
      everyone,
      helds,
      () => 'Fight',
      -1,
      Effect.map(killsOn(host), kills => kills >= 3),
      60_000,
    )
    yield* check(
      shotKills,
      'the players shoot zombies, each kill to its shooter',
    )
    // NOTE: kept in case the run ends before the revive's reading below.
    linkAtEnd = yield* linkNow
    yield* shot(host, 'fight')
    yield* shot(firstGuest, 'fight-guest')

    const feeder = everyone.length - 1
    const feederSlot = yield* slotOf(lastGuest)
    const feederLife = Effect.map(
      readoutOf(host),
      readout => seatOf(readout, feederSlot)?.life,
    )
    // NOTE: the others guard meanwhile, firing only at what comes at them, or
    // they shoot the zombies before any reaches the feeder.
    const downed = yield* playFor(
      everyone,
      helds,
      index => (index === feeder ? 'Feed' : 'Guard'),
      feederSlot,
      Effect.map(feederLife, life => life === 'Downed'),
      90_000,
    )
    yield* check(downed, 'a player who walks into the zombies goes down')
    if (downed) {
      yield* shot(host, 'downed')
      const revived = yield* playFor(
        everyone,
        helds,
        index => (index === 0 ? 'Revive' : index === feeder ? 'Idle' : 'Fight'),
        feederSlot,
        Effect.map(feederLife, life => life === 'Standing'),
        12_000,
      )
      yield* check(
        revived,
        'a teammate standing still beside them revives them',
      )
      yield* shot(host, 'revived')
    }

    const linkAfterRevive = yield* linkNow
    if (Array.every(linkAfterRevive.nets, net => net !== undefined)) {
      linkAtEnd = linkAfterRevive
    }

    // THE BREAK, THE STALL, AND READY

    // NOTE: everyone clears the rest of the wave. A teammate left standing
    // idle was eaten, and then the host alone, and the party wiped back to
    // the lobby. The break's bonus pays for something at the stall. A wipe
    // ends the step at once (no readout off the arena) and says so.
    const isBreak = (readout: Readout | undefined) =>
      readout?.phase === 'Preparation' && readout.wave === 2
    yield* playFor(
      everyone,
      helds,
      () => 'Fight',
      -1,
      Effect.gen(function* () {
        if (!(yield* isOnArena(host))) {
          return true
        }
        const readout = yield* readoutOf(host)
        return isBreak(readout)
      }),
      180_000,
    )
    const isStillOn = yield* isOnArena(host)
    yield* check(isStillOn, 'the party lives through wave 1')
    const afterWave = yield* readoutOf(host)
    yield* check(
      isBreak(afterWave),
      'the wave is cleared and the next break opens',
    )
    yield* stopEveryone
    yield* shot(host, 'break')

    // NOTE: the shop is gone (docs/ESCAPE_PLAN.md, layer 7): the cleared
    // wave put a key on the crew's one ring, which every page reads alike.
    const hostKeys = (yield* readoutOf(host))?.keys ?? 0
    const guestKeys = (yield* readoutOf(firstGuest))?.keys ?? -1
    yield* check(
      hostKeys >= 1 && hostKeys === guestKeys,
      `the crew shares one key ring (${hostKeys} keys)`,
    )

    for (const page of everyone) {
      yield* attempt(() => page.keyboard.press('Enter'))
    }
    yield* untilWithin(
      'READY over everyone shows, then wave 2 starts',
      Effect.map(
        readoutOf(host),
        readout => readout?.phase === 'Wave' && readout.wave === 2,
      ),
      6000,
    )
  }

  // THE LINK

  const endNet = linkAtEnd ?? (yield* linkNow)
  const seconds = (endNet.atMs - startedMs) / 1000
  for (const [index, net] of endNet.nets.entries()) {
    const start = startNet[index]
    if (net === undefined || start === undefined) {
      yield* Console.log(
        `  player ${index + 1}: no link readout (not in the run)`,
      )
      continue
    }
    const kbps = (net.bytesIn - start.bytesIn) / 1024 / seconds
    const inputs = (net.inputsOut - start.inputsOut) / seconds
    yield* Console.log(
      `  player ${index + 1}: round trip ${net.rttMs} ms, down ${kbps.toFixed(2)} KB/s over ${net.framesIn - start.framesIn} messages (${((net.framesIn - start.framesIn) / seconds).toFixed(1)} a second), up ${inputs.toFixed(1)} inputs a second, ${net.corrections} corrections (at most ${net.correctionPx} px)`,
    )
    yield* Console.log(
      `  player ${index + 1}: hits seen ${net.lookedHits - start.lookedHits}, confirmed ${net.confirmedHits - start.confirmedHits}; drawn ${net.delayMs} ms behind; ${net.stalls - start.stalls} stalls, ${net.resyncs - start.resyncs} resyncs (the longest gap all session ${net.longestStallMs} ms)`,
    )
    yield* check(net.rttMs > 0, `player ${index + 1} measured a round trip`)
  }

  // REJOIN

  const rejoiner = firstGuest
  const rejoinSlot = yield* slotOf(rejoiner)
  yield* attempt(() => rejoiner.reload())
  yield* awaitGame(rejoiner)
  yield* until(
    'a reloaded guest rejoins its seat from the address',
    Effect.gen(function* () {
      return (
        (yield* slotOf(rejoiner)) === rejoinSlot &&
        (yield* readoutOf(rejoiner))?.players.length === players
      )
    }),
  )
  yield* shot(rejoiner, 'rejoined')

  // LEAVE

  const leaver = lastGuest
  yield* attempt(() =>
    leaver.getByRole('button', { name: 'Leave the room' }).click(),
  )
  yield* until(
    'LEAVE lands back on the hub',
    attempt(() =>
      leaver.getByRole('button', { name: /Quick play/ }).isVisible(),
    ),
  )
  yield* check(
    new URL(leaver.url()).searchParams.get('room') === null,
    'leaving clears the room from the address',
  )

  // QUICK PLAY

  if (config.isQuick) {
    const quickOne = yield* openPlayer(browser, 'quick 1', 0)
    const quickTwo = yield* openPlayer(browser, 'quick 2', 0)
    const quick = [quickOne, quickTwo]
    for (const page of quick) {
      yield* attempt(() => page.goto(config.base))
      yield* awaitGame(page)
      yield* attempt(() => page.click('#home-coop'))
      yield* attempt(() =>
        page.getByRole('button', { name: /Quick play/ }).click(),
      )
    }
    yield* until(
      'two queued players see two heads',
      Effect.map(
        countOf(quickOne, '.coop-queue-seat[data-state="Filled"]'),
        count => count === 2,
      ),
    )
    yield* shot(quickOne, 'queue')
    yield* untilWithin(
      'the offer to start with two comes',
      attempt(() => quickOne.locator('.coop-offer-start').isVisible()),
      60_000,
    )
    for (const page of quick) {
      yield* attempt(() => page.locator('.coop-offer-start').click())
    }
    for (const [index, page] of quick.entries()) {
      yield* until(
        `quick player ${index + 1} lands in a lobby`,
        Effect.map(filledSeats(page), filled => filled === 2),
      )
    }
    const quickOneCode = yield* roomCodeOf(quickOne)
    yield* check(
      quickOneCode === (yield* roomCodeOf(quickTwo)),
      'both quick players share one room',
    )
  }

  for (const context of contexts) {
    yield* attempt(() => context.close())
  }
  yield* finish(
    problems,
    'Co-op played a real wave through the game UI with no problems.',
  )
})

runAudit(program)
