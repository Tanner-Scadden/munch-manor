import { Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import {
  type Bullet,
  type Model,
  Phase,
  Pierce,
  ZombieState,
} from '../../../app/model'
import { FIXED_STEP_MS } from '../../../shared/constants'
import {
  DISTANT_SPAWN,
  crewInWave,
  freshRunModel,
  pastTimedBreaks,
  placeSeat,
  playingModel,
  veteranFighting,
  withFeatsOf,
  withKeys,
  withZombies,
} from '../../../test/model.fixture'
import {
  APPLICATION,
  BELOW_KITCHEN_DOOR,
  HOLD_TICKS,
  doomed,
  holdEnter,
  holdFire,
  steppedWorld,
  tick,
  ticks,
  zombieOf,
} from '../../../test/testing'
import { START_LEVEL } from '../../level/arena'
import { EXIT_RULES } from '../../level/exits'
import { focusOf, maybePlayerAt, modifyFocus } from '../../party/party'
import { Feat, freshTally } from '../../schema/worldSchema'
import { goalOf, progressOf } from '../feats'

// Feats (src/world/feats/feats.ts): each player's own tally, fed once a
// tick from what the tick did: kills by who made them and with what, hearts
// lost, a wave cleared, a room bought open, and the valve turned.

const FRAME_MS = FIXED_STEP_MS

// NOTE: a run with no cases, so a kill opens nothing and plays no sound
// a test does not expect.
const caseless = (model: Model): Model =>
  modifyFields(model, { cases: () => [] })

describe('kill feats, one player', () => {
  it.effect(
    'a pistol kill counts as a kill, a kill with the pistol, a kill of its kind, and a streak',
    () =>
      Story.story(
        APPLICATION,
        Story.given(caseless(withZombies(playingModel, [doomed]))),
        holdFire,
        tick(FRAME_MS),
        Story.model(current => {
          const { feats } = focusOf(current)
          expect(feats.kills).toBe(1)
          expect(feats.killsWith.Pistol).toBe(1)
          expect(feats.killsOf.Shambler).toBe(1)
          expect(feats.streak).toBe(1)
          expect(feats.bestStreak).toBe(1)
          expect(feats.kitchenKills).toBe(0)
          expect(
            progressOf(feats, Feat.KillsWith({ armament: 'Pistol', count: 5 })),
          ).toBe(1)
          expect(
            progressOf(feats, Feat.KillsOf({ kind: 'Runner', count: 5 })),
          ).toBe(0)
        }),
      ),
  )

  it.effect('a knife kill counts as a kill with the knife', () =>
    Story.story(
      APPLICATION,
      Story.given(
        caseless(
          modifyFocus(
            withZombies(playingModel, [
              zombieOf(
                'Shambler',
                900,
                START_LEVEL.start.x + 10,
                START_LEVEL.start.y,
                { hp: 1, speed: 0 },
              ),
            ]),
            {
              player: player => modifyFields(player, { wield: () => 'Melee' }),
            },
          ),
        ),
      ),
      holdFire,
      ...ticks(3, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).feats.killsWith.Knife).toBe(1)
        expect(focusOf(current).feats.killsWith.Pistol).toBe(0)
      }),
    ),
  )

  it.effect(
    "zombies a Kaboomer's blast takes with it count for the player nearest",
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          caseless(
            withZombies(playingModel, [
              modifyFields(zombieOf('Exploder', 900, 60, 40, { speed: 0 }), {
                hp: () => 0,
                state: () => ZombieState.Fusing({ remainingMs: 1 }),
              }),
              zombieOf('Shambler', 901, 66, 40, { hp: 1, speed: 0 }),
            ]),
          ),
        ),
        ...ticks(3, FRAME_MS),
        Story.model(current => {
          expect(focusOf(current).feats.blastKills).toBe(1)
          expect(
            progressOf(focusOf(current).feats, Feat.OwnBlast({ count: 3 })),
          ).toBe(1)
        }),
      ),
  )
})

describe('skill feats, one player', () => {
  it.effect('a wave cleared with no heart lost counts as a clean wave', () =>
    Story.story(
      APPLICATION,
      Story.given(caseless(veteranFighting)),
      ...ticks(3, FRAME_MS),
      Story.model(current => {
        expect(current.phase._tag).toBe('Preparation')
        expect(focusOf(current).feats.cleanWaves).toBe(1)
        expect(
          progressOf(focusOf(current).feats, Feat.NoHitWave({ count: 1 })),
        ).toBe(1)
      }),
    ),
  )

  it.effect('a wave cleared after a hit counts for nothing', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withFeatsOf(caseless(veteranFighting), tally =>
          modifyFields(tally, { hurtThisWave: () => true }),
        ),
      ),
      ...ticks(3, FRAME_MS),
      Story.model(current => {
        expect(current.phase._tag).toBe('Preparation')
        expect(focusOf(current).feats.cleanWaves).toBe(0)
      }),
    ),
  )

  it.effect('a bite ends the streak and spoils the wave, the best stays', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withFeatsOf(
          caseless(
            withZombies(playingModel, [
              zombieOf(
                'Shambler',
                900,
                START_LEVEL.start.x,
                START_LEVEL.start.y,
                {
                  speed: 0,
                },
              ),
            ]),
          ),
          tally =>
            modifyFields(tally, { streak: () => 5, bestStreak: () => 5 }),
        ),
      ),
      ...ticks(40, FRAME_MS),
      Story.model(current => {
        const { feats, player } = focusOf(current)
        expect(player.hp).toBeLessThan(focusOf(playingModel).player.hp)
        expect(feats.streak).toBe(0)
        expect(feats.bestStreak).toBe(5)
        expect(feats.hurtThisWave).toBe(true)
      }),
    ),
  )
})

describe('exploring feats, one player', () => {
  it.effect('buying the kitchen open counts as opening a room', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFocus(
          modifyFields(withKeys(pastTimedBreaks(freshRunModel()), EXIT_RULES.kitchenKeys), {
            phase: () =>
              Phase.Preparation({
                wave: 3,
                remainingMs: 15_000,
                durationMs: 20_000,
                spawns: [DISTANT_SPAWN],
              }),
          }),
          {
            player: player =>
              modifyFields(player, {
                x: () => BELOW_KITCHEN_DOOR.x,
                y: () => BELOW_KITCHEN_DOOR.y,
              }),
          },
        ),
      ),
      ...holdEnter(HOLD_TICKS),
      Story.model(current => {
        expect(focusOf(current).feats.roomsOpened).toBe(1)
        expect(
          progressOf(focusOf(current).feats, Feat.OpenedRoom({ count: 1 })),
        ).toBe(1)
      }),
    ),
  )

  test('every feat reads its own count, never past its goal', () => {
    const tally = modifyFields(freshTally, {
      markedKeys: () => 9,
      kitchenKills: () => 1,
      firesLit: () => 1,
    })
    expect(progressOf(tally, Feat.KeyFromMarked({ count: 3 }))).toBe(3)
    expect(progressOf(tally, Feat.KitchenKills({ count: 2 }))).toBe(1)
    expect(progressOf(tally, Feat.LitFire())).toBe(1)
    expect(goalOf(Feat.LitFire())).toBe(1)
  })
})

// CO-OP

const crewBullet = (id: number, shooter: number, x: number, y: number) =>
  ({
    id,
    x,
    y,
    velocityX: 1,
    velocityY: 0,
    remainingMs: 900,
    weapon: 'Smg',
    damage: 1,
    knockback: 110,
    glaze: 'Plain',
    pierce: Pierce.Stops(),
    shooter,
  }) satisfies Bullet

describe('feats in co-op', () => {
  test('each player keeps their own tally: a kill counts for the seat that made it', () => {
    const crew = caseless(
      modifyFields(
        placeSeat(placeSeat(crewInWave(2), 0, 40, 150), 1, 40, 160),
        {
          zombies: () => [
            zombieOf('Runner', 900, 200, 60, { hp: 1, speed: 0 }),
            zombieOf('Shambler', 901, 200, 45, { hp: 1, speed: 0 }),
          ],
          bullets: () => [crewBullet(1, 1, 200, 60), crewBullet(2, 1, 200, 45)],
        },
      ),
    )
    const after = steppedWorld(crew, 2)
    const shooter = Option.getOrThrow(maybePlayerAt(after, 1)).feats
    const other = Option.getOrThrow(maybePlayerAt(after, 0)).feats
    expect(shooter.kills).toBe(2)
    expect(shooter.killsWith.Smg).toBe(2)
    expect(shooter.killsOf.Runner).toBe(1)
    expect(other.kills).toBe(0)
  })

  test("a teammate's bite spoils only their own wave", () => {
    const crew = caseless(
      modifyFields(
        placeSeat(placeSeat(crewInWave(2), 0, 40, 150), 1, 200, 100),
        {
          zombies: () => [zombieOf('Shambler', 900, 200, 100, { speed: 0 })],
        },
      ),
    )
    const after = steppedWorld(crew, 40)
    expect(Option.getOrThrow(maybePlayerAt(after, 1)).feats.hurtThisWave).toBe(
      true,
    )
    expect(Option.getOrThrow(maybePlayerAt(after, 0)).feats.hurtThisWave).toBe(
      false,
    )
  })
})
