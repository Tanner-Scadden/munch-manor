import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR, isSolidAt } from './arena'
import { FIXED_STEP_MS } from './constants'
import { CRAWLER_RULES, drawSurfacingSpot } from './crawler'
import { doorCounts, floorCounts, rollSpawns } from './endlessWaves'
import { update } from './main'
import { Message } from './message'
import {
  Frenzy,
  type Model,
  Phase,
  type PlannedSpawn,
  type Zombie,
  ZombieAction,
  ZombieState,
  initialModel,
} from './model'
import { bulletInto, hasEvent, tick, ticks } from './testing'

const FRAME_MS = FIXED_STEP_MS
const CENTER_X = PARLOUR.width / 2
const CENTER_Y = PARLOUR.height / 2
const CRAWLER_ID = 20

const framesFor = (ms: number): number => Math.ceil(ms / FRAME_MS)

const spawnOf = (
  kind: PlannedSpawn['kind'],
  atMs: number,
  pack: number,
): PlannedSpawn => ({
  atMs,
  kind,
  door: 'East',
  offset: 0,
  speedScale: 1,
  hpScale: 1,
  pack,
  formation: 'Trickle',
})

const DISTANT_SPAWN = spawnOf('Shambler', 1e9, 999)

const waveWith = (
  spawns: ReadonlyArray<PlannedSpawn>,
  zombies: ReadonlyArray<Zombie> = [],
): Model =>
  modifyFields(initialModel, {
    maybeSurface: () =>
      Option.some({ left: 0, top: 0, width: 800, height: 400 }),
    phase: () =>
      Phase.Wave({ wave: 7, elapsedMs: 0, spawns: [...spawns, DISTANT_SPAWN] }),
    zombies: () => zombies,
  })

const crawlerAt = (x: number, y: number, action: ZombieAction): Zombie => ({
  id: CRAWLER_ID,
  kind: 'Crawler',
  x,
  y,
  speed: 0,
  hp: 2,
  maxHp: 2,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action,
  frenzy: Frenzy.Calm(),
})

const crawlerIn = (current: Model): Zombie =>
  Option.getOrThrow(
    Array.findFirst(current.zombies, zombie => zombie.kind === 'Crawler'),
  )

const distanceToPlayer = (current: Model, zombie: Zombie): number =>
  Math.hypot(zombie.x - current.player.x, zombie.y - current.player.y)

describe('the Ankle Biter', () => {
  test('comes up through the floor after a 1.5 s telegraph, out of reach until then', () => {
    expect(CRAWLER_RULES.surfaceMs).toBe(1500)
    story(
      update,
      given(waveWith([spawnOf('Crawler', 0, 1)])),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'CrawlerStirred')).toBe(true)
        expect(hasEvent(current, 'PackWarned')).toBe(false)
        const crawler = crawlerIn(current)
        expect(crawler.action).toEqual(
          ZombieAction.Burrowed({
            remainingMs: CRAWLER_RULES.surfaceMs,
            durationMs: CRAWLER_RULES.surfaceMs,
          }),
        )
        expect(distanceToPlayer(current, crawler)).toBeGreaterThanOrEqual(
          CRAWLER_RULES.clearPx,
        )
      }),
      ...ticks(framesFor(CRAWLER_RULES.surfaceMs) - 1, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Burrowed'])(crawlerIn(current).action),
        ).toBe(true)
      }),
      ...ticks(1, FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'CrawlerSurfaced')).toBe(true)
        expect(crawlerIn(current).action).toEqual(ZombieAction.Roaming())
      }),
    )
  })

  test('a buried Ankle Biter cannot be shot', () => {
    const buried = crawlerAt(
      CENTER_X + 60,
      CENTER_Y,
      ZombieAction.Burrowed({ remainingMs: 1000, durationMs: 1500 }),
    )
    story(
      update,
      given(
        modifyFields(waveWith([], [buried]), {
          bullets: () => [bulletInto(700, buried, { damage: 5, knockback: 0 })],
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(crawlerIn(current).hp).toBe(2)
        expect(hasEvent(current, 'ZombieHit')).toBe(false)
      }),
    )
  })

  test('never comes up near the player, wherever the player stands', () => {
    const spots = Array.flatMap(
      Array.makeBy(40, index => index * 7919 + 3),
      seed =>
        Array.map(
          [
            { x: 40, y: 40 },
            { x: CENTER_X, y: CENTER_Y },
            { x: 280, y: 150 },
            { x: 300, y: 40 },
          ],
          player => ({
            player,
            spot: drawSurfacingSpot(PARLOUR, seed, player, [])[1],
          }),
        ),
    )
    Array.forEach(spots, ({ player, spot }) => {
      expect(
        Math.hypot(spot.x - player.x, spot.y - player.y),
      ).toBeGreaterThanOrEqual(40)
      expect(isSolidAt(PARLOUR, spot)).toBe(false)
    })
  })

  test('stays under the floor while the player stands on its cracks', () => {
    const ready = crawlerAt(
      CENTER_X + 10,
      CENTER_Y,
      ZombieAction.Burrowed({ remainingMs: 100, durationMs: 1500 }),
    )
    story(
      update,
      given(waveWith([], [ready])),
      ...ticks(40, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Burrowed'])(crawlerIn(current).action),
        ).toBe(true)
        expect(hasEvent(current, 'CrawlerSurfaced')).toBe(false)
      }),
      message(Message.PressedKey({ code: 'KeyA' })),
      ...ticks(50, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Roaming', 'Clinging', 'Winded'])(
            crawlerIn(current).action,
          ),
        ).toBe(true)
      }),
    )
  })

  test('grabs the player by the ankles, slowing them to half speed, then lets go', () => {
    const grabbing = crawlerAt(CENTER_X + 3, CENTER_Y, ZombieAction.Roaming())
    const walked = (start: Model, frames: number) => (current: Model) =>
      Math.abs(current.player.x - start.player.x) / frames

    const free = waveWith([], [])
    const held = waveWith([], [grabbing])
    const clingFrames = Math.floor(CRAWLER_RULES.clingMs / FRAME_MS) - 6
    const freeSpeeds: Array<number> = []
    const heldSpeeds: Array<number> = []

    story(
      update,
      given(free),
      tick(FRAME_MS),
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(clingFrames, FRAME_MS),
      model(current => {
        freeSpeeds.push(walked(free, clingFrames)(current))
      }),
    )

    story(
      update,
      given(held),
      tick(FRAME_MS),
      model(current => {
        expect(hasEvent(current, 'AnklesGrabbed')).toBe(true)
        expect(
          ZombieAction.isAnyOf(['Clinging'])(crawlerIn(current).action),
        ).toBe(true)
        expect(current.player.hp).toBe(initialModel.player.hp)
      }),
      message(Message.PressedKey({ code: 'KeyD' })),
      ...ticks(clingFrames, FRAME_MS),
      model(current => {
        heldSpeeds.push(walked(held, clingFrames)(current))
        expect(distanceToPlayer(current, crawlerIn(current))).toBeLessThan(8)
      }),
      ...ticks(12, FRAME_MS),
      model(current => {
        expect(
          ZombieAction.isAnyOf(['Winded'])(crawlerIn(current).action),
        ).toBe(true)
      }),
    )

    const [freeSpeed] = freeSpeeds
    const [heldSpeed] = heldSpeeds
    expect(heldSpeed).toBeDefined()
    expect(freeSpeed).toBeDefined()
    expect(heldSpeed ?? 0).toBeCloseTo(
      (freeSpeed ?? 0) * CRAWLER_RULES.clingSlow,
      1,
    )
  })

  test('the preview counts Ankle Biters as FLOOR, never at a door', () => {
    Array.forEach([1, 2, 3, 99, 31337], seed => {
      const [, spawns] = rollSpawns(seed, 7)
      const crawlers = Array.filter(spawns, ({ kind }) => kind === 'Crawler')
      expect(floorCounts(spawns)).toEqual([
        { kind: 'Crawler', count: crawlers.length },
      ])
      Array.forEach(doorCounts(spawns, []), ({ kinds }) =>
        Array.forEach(kinds, ({ kind }) => expect(kind).not.toBe('Crawler')),
      )
    })
  })
})
