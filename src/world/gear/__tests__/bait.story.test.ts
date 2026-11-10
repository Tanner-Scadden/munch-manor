import { Array, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import {
  Frenzy,
  Invulnerability,
  type Model,
  Phase,
  type Vector,
  type Zombie,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { DISTANT_SPAWN } from '../../../test/model.fixture'
import { APPLICATION, ticks, westPlank, zombieOf } from '../../../test/testing'
import { MANOR } from '../../level/arena'
import { modifyFocus } from '../../party/party'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import { TRAPS } from '../traps'

const FRAME_MS = 50
const SPEED = 20

// NOTE: in line with the dining room's West door, at its top left.
const WEST_Y = MANOR.doors.West.center.y
const NEAR_WEST_PLANK: Vector = { x: 45, y: WEST_Y }
const FAR_FROM_PLANKS: Vector = { x: 95, y: WEST_Y }
const PLAYER_AT: Vector = { x: 250, y: 90 }

const fightingWith = (zombie: Zombie): Model =>
  modifyFocus(
    modifyFields(initialModel, {
      maybeSurface: () =>
        Option.some({ left: 0, top: 0, width: 800, height: 400 }),
      phase: () =>
        Phase.Wave({ wave: 4, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
      traps: () => [westPlank],
      zombies: () => [zombie],
    }),
    {
      player: player =>
        modifyFields(player, {
          x: () => PLAYER_AT.x,
          y: () => PLAYER_AT.y,
          invulnerability: () =>
            Invulnerability.Invulnerable({ remainingMs: 1e9, durationMs: 1e9 }),
        }),
    },
  )

const onlyZombie = (current: Model): Zombie =>
  Option.getOrThrow(Array.head(current.zombies))

const plankHp = (current: Model): number =>
  Option.match(Array.head(current.traps), {
    onNone: () => 0,
    onSome: ({ hp }) => hp,
  })

describe('planks as bait', () => {
  it.effect(
    'a Groaner near a Plank Pile walks over and chews it instead of chasing the player',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          fightingWith(
            zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
              speed: SPEED,
            }),
          ),
        ),
        ...ticks(20, FRAME_MS),
        Story.model(current => {
          expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x - 10)
        }),
        ...ticks(40, FRAME_MS),
        Story.model(current => {
          expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 3)
          expect(onlyZombie(current).x).toBeLessThan(NEAR_WEST_PLANK.x)
        }),
      ),
  )

  it.effect('a Big Lug is drawn too, and chews much faster', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          zombieOf('Tank', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(60, FRAME_MS),
      Story.model(current => {
        expect(plankHp(current)).toBeLessThan(TRAPS.Barricade.hp - 10)
      }),
    ),
  )

  it.effect('a Hotfoot ignores the plank and goes for the player', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          zombieOf('Runner', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 10)
        expect(plankHp(current)).toBe(TRAPS.Barricade.hp)
      }),
    ),
  )

  it.effect('a Kaboomer and a Big Leaguer ignore the plank too', () => {
    expect(ZOMBIE_KINDS.Exploder.bait).toBe('Ignores')
    expect(ZOMBIE_KINDS.Thrower.bait).toBe('Ignores')
    return Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          zombieOf('Thrower', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 3)
        expect(plankHp(current)).toBe(TRAPS.Barricade.hp)
      }),
    )
  })

  it.effect('a frenzied Groaner only has eyes for the player', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
            speed: SPEED,
            frenzy: Frenzy.Frenzied({ pack: 1, apartMs: 0 }),
          }),
        ),
      ),
      ...ticks(10, FRAME_MS),
      Story.model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
      }),
    ),
  )

  it.effect('a Groaner beyond the pull radius chases the player', () =>
    Story.story(
      APPLICATION,
      Story.given(
        fightingWith(
          zombieOf('Shambler', 50, FAR_FROM_PLANKS.x, FAR_FROM_PLANKS.y, {
            speed: SPEED,
          }),
        ),
      ),
      ...ticks(20, FRAME_MS),
      Story.model(current => {
        expect(onlyZombie(current).x).toBeGreaterThan(FAR_FROM_PLANKS.x + 10)
      }),
    ),
  )

  it.effect(
    'a Groaner nearer the player than the plank goes for the player',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFocus(
            fightingWith(
              zombieOf('Shambler', 50, NEAR_WEST_PLANK.x, NEAR_WEST_PLANK.y, {
                speed: SPEED,
              }),
            ),
            {
              player: player =>
                modifyFields(player, { x: () => 70, y: () => WEST_Y }),
            },
          ),
        ),
        ...ticks(10, FRAME_MS),
        Story.model(current => {
          expect(onlyZombie(current).x).toBeGreaterThan(NEAR_WEST_PLANK.x + 5)
        }),
      ),
  )
})
