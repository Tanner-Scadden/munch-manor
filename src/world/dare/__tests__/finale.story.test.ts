import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { type Model, Phase, RunMode } from '../../../app/model'
import { PREPARATION_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  FRONT_DOOR_SILL,
  crewInWave,
  escaping,
  placeSeat,
  quietWave,
  withDareThings,
  withFinale,
  withPlayerAt,
  withSeatLife,
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
import { DIFFICULTIES } from '../../run/difficulty'
import { withWorld } from '../../schema/world'
import {
  Boss,
  BreakClock,
  Life,
  ZombieState,
} from '../../schema/worldSchema'
import { hpScaleFor } from '../../waves/endlessWaves'
import { FINAL_WAVE } from '../../waves/wavePlans'
import { beginPreparation } from '../../waves/waves'
import { BOSS_RULES } from '../../zombies/boss'
import { ZOMBIE_KINDS, scaledHp } from '../../zombies/zombies'
import { dareCardOf, isHatFound, maybeLyingAt } from '../dare'
import { type DareThing, DareThingState, Finale } from '../dareSchema'
import { FINALE_RULES, isAtFrontDoor } from '../finale'

// The finale (src/world/dare/finale.ts): the list done, Uncle Chunk at the
// front door at the next wave with that wave's health, his hat on the card
// and the door unlocking while the waves press, then out through it.

const FRAME_MS = 1000 / 60

const found = (id: number, kind: DareThing['kind']): DareThing => ({
  id,
  kind,
  isAsked: true,
  state: DareThingState.Found({ slot: 0 }),
})

const hidden = (id: number, kind: DareThing['kind']): DareThing => ({
  id,
  kind,
  isAsked: true,
  state: DareThingState.Hidden({ x: 5000, y: 5000 }),
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

describe('Uncle Chunk at the front door', () => {
  it.effect('never comes while the list is still being hunted', () =>
    Story.story(
      APPLICATION,
      Story.given(breakBefore(3, [found(0, 'SilverSpoon'), hidden(1, 'MusicBox')])),
      tick(FRAME_MS),
      startWave,
      Story.model(current => {
        expect(current.dare.finale).toEqual(Finale.Hunting())
        expect(current.boss).toEqual(Boss.Absent())
      }),
    ),
  )

  it.effect(
    'with the list done he comes at the next wave, through the front door only',
    () =>
      Story.story(
        APPLICATION,
        Story.given(breakBefore(3, LIST_DONE)),
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
    'his health is the wave he comes on, from wave 10 along the Endless curve',
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
        const early = yield* hpOn(3)
        const late = yield* hpOn(FINAL_WAVE + 4)
        const { healthScale } = DIFFICULTIES.Normal
        expect(early).toBe(scaledHp(ZOMBIE_KINDS.Boss.hp, healthScale))
        expect(late).toBe(
          scaledHp(
            ZOMBIE_KINDS.Boss.hp,
            hpScaleFor(FINAL_WAVE + 4) * healthScale,
          ),
        )
        expect(late).toBeGreaterThan(early)
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

describe('his hat', () => {
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

  it.effect('falls where he does, on the card still to fill', () =>
    Story.story(
      APPLICATION,
      Story.given(chunkFalling(summoned)),
      tick(FRAME_MS),
      Story.model(current => {
        const hat = Option.getOrThrow(
          Array.findFirst(current.dareThings, ({ kind }) => kind === 'PartyHat'),
        )
        expect(Option.isSome(maybeLyingAt(hat, levelOf(current)))).toBe(true)
        expect(isHatFound(current)).toBe(false)
        expect(Array.last(dareCardOf(current))).toEqual(
          Option.some({ kind: 'PartyHat', isFound: false }),
        )
      }),
    ),
  )

  it.effect('taken, it fills the card and starts the door unlocking', () =>
    Story.story(
      APPLICATION,
      Story.given(withPlayerAt(chunkFalling(summoned), 150, 120)),
      tick(FRAME_MS),
      tick(FRAME_MS),
      Story.model(current => {
        expect(isHatFound(current)).toBe(true)
        expect(Array.last(dareCardOf(current))).toEqual(
          Option.some({ kind: 'PartyHat', isFound: true }),
        )
        expect(current.dare.finale).toMatchObject({
          _tag: 'Unlocking',
          durationMs: FINALE_RULES.unlockMs,
        })
        expect(
          Array.some(
            current.frameEvents,
            ({ _tag }) => _tag === 'FrontDoorUnlocking',
          ),
        ).toBe(true)
      }),
    ),
  )

  it.effect('the door unlocks only while a wave is on, then swings open', () =>
    Effect.gen(function* () {
      const unlocking = (phase: Phase, remainingMs: number): Model =>
        withFinale(
          modifyFields(withDareThings(quietWave(6), LIST_DONE), {
            phase: () => phase,
          }),
          Finale.Unlocking({
            remainingMs,
            durationMs: FINALE_RULES.unlockMs,
          }),
        )
      yield* Story.story(
        APPLICATION,
        Story.given(
          unlocking(
            Phase.Preparation({
              wave: 7,
              remainingMs: PREPARATION_MS,
              durationMs: PREPARATION_MS,
              spawns: [DISTANT_SPAWN],
              clock: BreakClock.Waiting({ elapsedMs: 0 }),
            }),
            10_000,
          ),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.dare.finale).toEqual(
            Finale.Unlocking({
              remainingMs: 10_000,
              durationMs: FINALE_RULES.unlockMs,
            }),
          )
        }),
      )
      yield* Story.story(
        APPLICATION,
        Story.given(
          unlocking(
            Phase.Wave({ wave: 7, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
            FRAME_MS / 2,
          ),
        ),
        tick(FRAME_MS),
        Story.model(current => {
          expect(current.dare.finale).toEqual(Finale.Open({ out: [] }))
          expect(
            Array.some(current.frameEvents, ({ _tag }) =>
              _tag === 'FrontDoorOpened',
            ),
          ).toBe(true)
        }),
      )
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
      Finale.Open({ out: [] }),
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
          Finale.Unlocking({
            remainingMs: 30_000,
            durationMs: FINALE_RULES.unlockMs,
          }),
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
            expect(current.dare.finale).toEqual(Finale.Open({ out: [0] }))
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
            expect(current.dare.finale).toEqual(Finale.Open({ out: [0, 1] }))
          }),
        )
      }),
  )
})

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
