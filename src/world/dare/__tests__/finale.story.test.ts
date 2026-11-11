import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, RunMode } from '../../../app/model'
import { PLAYER_MAX_HP, PREPARATION_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  FRONT_DOOR_SILL,
  crewInWave,
  escaping,
  onHard,
  placeSeat,
  quietWave,
  withDareThings,
  withFinale,
  withSeatLife,
  withZombies,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  startWave,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { levelOf } from '../../level/arena'
import { targetsOf } from '../../party/party'
import { DIFFICULTIES } from '../../run/difficulty'
import { withWorld } from '../../schema/world'
import { Boss, BreakClock, Life, ZombieState } from '../../schema/worldSchema'
import { hpScaleFor } from '../../waves/endlessWaves'
import { FINAL_WAVE, WAVE_PLANS } from '../../waves/wavePlans'
import { beginPreparation } from '../../waves/waves'
import { BOSS_RULES } from '../../zombies/bossRules'
import { ZOMBIE_KINDS, scaledHp } from '../../zombies/zombies'
import { dareCardOf } from '../dare'
import { DareKind, type DareThing, DareThingState, Finale } from '../dareSchema'
import { FINALE_RULES, isAtFrontDoor, isHouseHungry } from '../finale'

// The finale (src/world/dare/finale.ts): the list done, Uncle Chunk at the
// front door at the next wave with the finale's health, his big key bursting
// out of him as he falls and flying into the lock, the door open at once,
// then out through it.

const FRAME_MS = 1000 / 60

const found = (id: number, kind: DareThing['kind']): DareThing => ({
  id,
  kind,
  state: DareThingState.Found({ slot: 0 }),
})

const hidden = (id: number, kind: DareThing['kind']): DareThing => ({
  id,
  kind,
  state: DareThingState.Hidden({ x: 5000, y: 5000, workedMs: 0 }),
})

const LIST_DONE: ReadonlyArray<DareThing> = [
  found(0, 'SilverSpoon'),
  found(1, 'MusicBox'),
]

// NOTE: a campaign break before `wave`, its spawns rolled as the game rolls
// them, with these things in the house.
const breakBefore = (wave: number, things: ReadonlyArray<DareThing>): Model =>
  withWorld(withDareThings(asVeteran(quietWave(wave - 1)), things), world =>
    beginPreparation(world, wave, PREPARATION_MS),
  )

const maybeWaiting = (model: Model) =>
  Option.liftPredicate(model.boss, Boss.guards.Waiting)

const spawnsOf = (model: Model) =>
  Phase.isAnyOf(['Wave', 'Preparation'])(model.phase) ? model.phase.spawns : []

// NOTE: a wave early in the run: with no wave floor, he comes the wave
// after the list is done, however early that is.
const EARLY_WAVE = 4

describe('Uncle Chunk at the front door', () => {
  it.effect('never comes while the list is still being hunted', () =>
    Story.story(
      APPLICATION,
      Story.given(
        breakBefore(3, [found(0, 'SilverSpoon'), hidden(1, 'MusicBox')]),
      ),
      tick(FRAME_MS),
      startWave,
      Story.model(current => {
        expect(current.dare.finale).toEqual(Finale.Hunting())
        expect(current.boss).toEqual(Boss.Absent())
      }),
    ),
  )

  it.effect(
    'a list done mid-wave on Triple Dare brings him at the next wave, never during it',
    () =>
      Effect.gen(function* () {
        const doneInWave = yield* Story.story(
          APPLICATION,
          Story.given(
            onHard(withDareThings(asVeteran(quietWave(3)), LIST_DONE)),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(current.dare.finale).toEqual(Finale.Summoned())
            expect(current.boss).toEqual(Boss.Absent())
            expect(isHouseHungry(current)).toBe(true)
          }),
          ...ticks(30, FRAME_MS),
          Story.model(current => {
            expect(current.boss).toEqual(Boss.Absent())
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            withWorld(doneInWave, world =>
              beginPreparation(world, 4, PREPARATION_MS),
            ),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(current.boss).toEqual(Boss.Absent())
          }),
          startWave,
          Story.model(current => {
            expect(Phase.isAnyOf(['Wave'])(current.phase)).toBe(true)
            expect(
              Option.map(maybeWaiting(current), ({ door }) => door),
            ).toEqual(Option.some('Front'))
          }),
        )
      }),
  )

  it.effect(
    'with the list done in a break he comes as its wave starts, through the front door only',
    () =>
      Story.story(
        APPLICATION,
        Story.given(breakBefore(EARLY_WAVE, LIST_DONE)),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.dare.finale).toEqual(Finale.Summoned())
          expect(current.boss).toEqual(Boss.Absent())
        }),
        startWave,
        Story.model(current => {
          const waiting = Option.getOrThrow(maybeWaiting(current))
          expect(waiting.door).toBe('Front')
          expect(waiting.waitBelow).toBe(spawnsOf(current).length)
          expect(levelOf(current).doorIds).not.toContain('Front')
        }),
        tick(FRAME_MS),
        Story.model(current => {
          expect(Boss.guards.Arriving(current.boss)).toBe(true)
        }),
        ...ticks(Math.ceil(BOSS_RULES.entranceMs / FRAME_MS) + 1, FRAME_MS),
        Story.model(current => {
          expect(Boss.guards.Fighting(current.boss)).toBe(true)
          const chunk = Option.getOrThrow(
            Array.findFirst(current.zombies, ({ kind }) => kind === 'Boss'),
          )
          const front = levelOf(current).doors.Front.center
          expect(Math.abs(chunk.x - front.x)).toBeLessThan(10)
          expect(chunk.y).toBeLessThan(front.y)
          expect(front.y - chunk.y).toBeLessThan(30)
        }),
      ),
  )

  it.effect(
    'his health is the wave he comes on times the finale scale, from wave 10 along the Endless curve',
    () =>
      Effect.gen(function* () {
        const hpOn = (wave: number) =>
          Story.story(
            APPLICATION,
            Story.given(breakBefore(wave, LIST_DONE)),
            tick(FRAME_MS),
            startWave,
          ).pipe(
            Effect.map(current => Option.getOrThrow(maybeWaiting(current)).hp),
          )
        const early = yield* hpOn(EARLY_WAVE)
        const late = yield* hpOn(FINAL_WAVE + 4)
        const { healthScale } = DIFFICULTIES.Normal
        const finaleScale = FINALE_RULES.chunkHealthScale.Normal
        expect(early).toBe(
          Math.round(
            scaledHp(
              ZOMBIE_KINDS.Boss.hp,
              (WAVE_PLANS[EARLY_WAVE - 1]?.hpScale ?? 1) * healthScale,
            ) * finaleScale,
          ),
        )
        expect(late).toBe(
          Math.round(
            scaledHp(
              ZOMBIE_KINDS.Boss.hp,
              hpScaleFor(FINAL_WAVE + 4) * healthScale,
            ) * finaleScale,
          ),
        )
        expect(late).toBeGreaterThan(early)
      }),
  )

  it.effect(
    'on Triple Dog Dare the house is hungrier from the first thing found',
    () =>
      Effect.sync(() => {
        const oneFound = breakBefore(4, [
          found(0, 'SilverSpoon'),
          hidden(1, 'MusicBox'),
        ])
        const onNightmare = modifyFields(oneFound, {
          difficulty: setting =>
            modifyFields(setting, { chosen: () => 'Nightmare' as const }),
        })
        expect(isHouseHungry(oneFound)).toBe(false)
        expect(isHouseHungry(onNightmare)).toBe(true)
        const noneFound = modifyFields(
          breakBefore(4, [hidden(0, 'SilverSpoon')]),
          {
            difficulty: setting =>
              modifyFields(setting, { chosen: () => 'Nightmare' as const }),
          },
        )
        expect(isHouseHungry(noneFound)).toBe(false)
      }),
  )

  it.effect('the house is hungrier once the list is done', () =>
    Effect.sync(() => {
      const hunting = breakBefore(4, [hidden(0, 'SilverSpoon')])
      const hungry = withWorld(
        withFinale(withDareThings(quietWave(3), LIST_DONE), Finale.Summoned()),
        world => beginPreparation(world, 4, PREPARATION_MS),
      )
      expect(spawnsOf(hungry).length).toBe(
        Math.floor(spawnsOf(hunting).length * FINALE_RULES.hungryCountScale),
      )
    }),
  )
})

describe('his big key', () => {
  const chunkFalling = (model: Model): Model =>
    modifyFields(model, {
      zombies: () => [
        modifyFields(zombieOf('Boss', 900, 150, 120, { hp: 0 }), {
          state: () =>
            ZombieState.Dying({ remainingMs: 2000, direction: { x: 1, y: 0 } }),
        }),
      ],
    })

  const summoned = withFinale(
    withDareThings(quietWave(6), LIST_DONE),
    Finale.Summoned(),
  )

  const tagsOf = (model: Model): ReadonlyArray<string> =>
    Array.map(model.frameEvents, ({ _tag }) => _tag)

  it.effect('bursts out of him as he falls and flies for the lock', () =>
    Story.story(
      APPLICATION,
      Story.given(chunkFalling(summoned)),
      tick(FRAME_MS),
      Story.model(current => {
        const chunk = Option.getOrThrow(
          Array.findFirst(current.zombies, ({ id }) => id === 900),
        )
        expect(current.dare.finale).toEqual(
          Finale.KeyFlying({
            from: { x: chunk.x, y: chunk.y },
            remainingMs: FINALE_RULES.keyFlightMs,
            durationMs: FINALE_RULES.keyFlightMs,
          }),
        )
        expect(tagsOf(current)).toContain('BigKeyBurst')
        expect(current.dareThings).toEqual(LIST_DONE)
        expect(dareCardOf(current)).toHaveLength(LIST_DONE.length)
      }),
    ),
  )

  it.effect(
    'the door swings open as it lands, under a second after he falls, with nothing to pick up',
    () =>
      Story.story(
        APPLICATION,
        Story.given(chunkFalling(summoned)),
        tick(FRAME_MS),
        ...ticks(Math.ceil(FINALE_RULES.keyFlightMs / FRAME_MS) + 1, FRAME_MS),
        Story.model(current => {
          expect(FINALE_RULES.keyFlightMs).toBeLessThan(1000)
          expect(current.dare.finale).toEqual(Finale.Open())
          expect(Phase.guards.Wave(current.phase)).toBe(true)
        }),
      ),
  )

  it.effect('it flies in a break too', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withFinale(
          modifyFields(withDareThings(quietWave(6), LIST_DONE), {
            phase: () =>
              Phase.Preparation({
                wave: 7,
                remainingMs: PREPARATION_MS,
                durationMs: PREPARATION_MS,
                spawns: [DISTANT_SPAWN],
                clock: BreakClock.Waiting({ elapsedMs: 0 }),
              }),
          }),
          Finale.KeyFlying({
            from: { x: 150, y: 120 },
            remainingMs: FRAME_MS / 2,
            durationMs: FINALE_RULES.keyFlightMs,
          }),
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.dare.finale).toEqual(Finale.Open())
        expect(tagsOf(current)).toContain('FrontDoorOpened')
      }),
    ),
  )

  it.effect('no hat anywhere: not a thing, not on the card', () =>
    Effect.sync(() => {
      expect(DareKind.literals).not.toContain('PartyHat')
      expect(DareKind.literals).toHaveLength(6)
    }),
  )
})

describe('walking out', () => {
  const openWave = (model: Model): Model =>
    withFinale(
      modifyFields(model, {
        phase: () =>
          Phase.Wave({ wave: 8, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      }),
      Finale.Open(),
    )

  it.effect('the sill is inside the front door', () =>
    Effect.sync(() => {
      expect(isAtFrontDoor(levelOf(quietWave(1)), FRONT_DOOR_SILL)).toBe(true)
    }),
  )

  it.effect('one player stepping through the open door is an escape', () =>
    Story.story(
      APPLICATION,
      Story.given(escaping(withDareThings(quietWave(8), LIST_DONE))),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.phase).toEqual(Phase.Escaped({ wave: 8 }))
        expect(current.mode).toEqual(RunMode.Campaign())
      }),
    ),
  )

  it.effect('a shut door lets nobody out', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withFinale(
          escaping(withDareThings(quietWave(8), LIST_DONE)),
          Finale.Summoned(),
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
      }),
    ),
  )

  it.effect(
    'a crew waits for every standing player, and carries the downed one out',
    () =>
      Effect.gen(function* () {
        const crew = openWave(crewInWave(3))
        const downed = Life.Downed({ bleedMs: 20_000, reviveMs: 0, callMs: 0 })
        const firstOut = placeSeat(
          placeSeat(crew, 0, FRONT_DOOR_SILL.x, FRONT_DOOR_SILL.y),
          1,
          60,
          60,
        )
        const waiting = yield* Story.story(
          APPLICATION,
          Story.given(withSeatLife(firstOut, 2, downed)),
          tick(FRAME_MS),
          Story.model(current => {
            expect(Phase.guards.Wave(current.phase)).toBe(true)
            expect(lifeTags(current)).toEqual(['Out', 'Standing', 'Downed'])
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            placeSeat(waiting, 1, FRONT_DOOR_SILL.x + 6, FRONT_DOOR_SILL.y),
          ),
          tick(FRAME_MS),
          Story.model(current => {
            expect(current.phase).toEqual(Phase.Escaped({ wave: 8 }))
            expect(lifeTags(current)).toEqual(['Out', 'Out', 'Downed'])
          }),
        )
      }),
  )

  // NOTE: a crew of three in an open-door wave, the lead stepped out where
  // a Shambler stands on them, the other two inside.
  const leadOut = (): Model =>
    withZombies(
      withSeatLife(
        placeSeat(
          placeSeat(
            placeSeat(
              openWave(crewInWave(3)),
              0,
              FRONT_DOOR_SILL.x,
              FRONT_DOOR_SILL.y,
            ),
            1,
            60,
            60,
          ),
          2,
          70,
          60,
        ),
        0,
        Life.Out(),
      ),
      [zombieOf('Shambler', 900, FRONT_DOOR_SILL.x, FRONT_DOOR_SILL.y)],
    )

  it.effect('a player who stepped out is never hunted or bitten', () =>
    Story.story(
      APPLICATION,
      Story.given(leadOut()),
      ...ticks(30, FRAME_MS),
      Story.model(current => {
        const [out] = current.seats
        expect(out.player.hp).toBe(PLAYER_MAX_HP)
        expect(out.seat.life).toEqual(Life.Out())
        expect(
          Array.map(targetsOf(current), ({ x, y }) => ({ x, y })),
        ).not.toContainEqual({ x: FRONT_DOOR_SILL.x, y: FRONT_DOOR_SILL.y })
      }),
    ),
  )

  it.effect('one who stepped out stays out through a break', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withWorld(withZombies(leadOut(), []), world =>
          beginPreparation(world, 9, PREPARATION_MS),
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(lifeTags(current)).toEqual(['Out', 'Standing', 'Standing'])
      }),
    ),
  )

  it.effect(
    'the last ones in going down after one stepped out is still an escape',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          placeSeat(
            withSeatLife(
              leadOut(),
              2,
              Life.Downed({ bleedMs: 20_000, reviveMs: 0, callMs: 0 }),
            ),
            1,
            60,
            60,
            0,
          ),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.phase).toEqual(Phase.Escaped({ wave: 8 }))
        }),
      ),
  )

  it.effect('a crew all down with nobody out is still a game over', () =>
    Story.story(
      APPLICATION,
      Story.given(
        placeSeat(
          withSeatLife(
            withSeatLife(
              leadOut(),
              0,
              Life.Downed({ bleedMs: 20_000, reviveMs: 0, callMs: 0 }),
            ),
            2,
            Life.Downed({ bleedMs: 20_000, reviveMs: 0, callMs: 0 }),
          ),
          1,
          60,
          60,
          0,
        ),
      ),
      tick(FRAME_MS),
      Story.model(current => {
        expect(current.phase).toEqual(Phase.GameOver({ wave: 8 }))
      }),
    ),
  )
})

const lifeTags = (model: Model): ReadonlyArray<string> =>
  Array.map(model.seats, ({ seat }) => seat.life._tag)

describe('Endless', () => {
  it.effect('has no list, so its finale never starts', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(quietWave(12), {
          mode: () => RunMode.Endless(),
          dare: dare => modifyFields(dare, { list: () => [] }),
        }),
      ),
      ...ticks(3, FRAME_MS),
      Story.model(current => {
        expect(current.dare.finale).toEqual(Finale.Hunting())
        expect(dareCardOf(current)).toEqual([])
      }),
    ),
  )
})
