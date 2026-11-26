import { Array, Effect, Option } from 'effect'

import { UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  DifficultyCard,
  type Model,
  Phase,
  RunMode,
  Trap,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { withBests } from '../../../domain/run'
import { endlessBannerOf } from '../../../screens/game/overlay'
import { bestsFor } from '../../../screens/home/home'
import {
  PACK_WARNING_MS,
  ZOMBIE_ALIVE_MAX,
  ZOMBIE_DYING_MS,
  ZOMBIE_MAX_HP,
} from '../../../shared/constants'
import { pistolOnly } from '../../../test/arsenals'
import { plannedSpawn, withKeys } from '../../../test/model.fixture'
import {
  MUZZLE_X,
  RESTART_GRACE_TICKS,
  bulletInto,
  checkModel,
  doomed,
  modelAfter,
  openLobbyByKey,
  press,
  resolveFocusLobby,
  scoring,
  send,
  startRunFromHome,
  steps,
  throughIntro,
  tick,
  ticks,
  ticksFor,
  zombieAt,
} from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { TRAPS } from '../../gear/traps'
import { STARTING_PISTOL } from '../../gear/weapons'
import { START_LEVEL } from '../../level/arena'
import { modifyFocus } from '../../party/party'
import { DIFFICULTIES, breakMsOf } from '../../run/difficulty'
import { Arsenal } from '../../schema/worldSchema'
import { ZOMBIE_KINDS } from '../../zombies/zombies'
import {
  endlessTankCount,
  endlessZombieCount,
  hpScaleFor,
  rollSpawns,
} from '../endlessWaves'
import { FINAL_WAVE } from '../wavePlans'

const FRAME_MS = 50
const GRACE_TICK_MS = 50
const readyModel: Model = UiStruct.evolve(initialModel, {
  difficultyCard: () => DifficultyCard.Seen,
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const waitOutGrace = () => ticks(RESTART_GRACE_TICKS, GRACE_TICK_MS)

const clearingFinalWave = (mode: RunMode): Model =>
  UiStruct.evolve(readyModel, {
    mode: () => mode,
    phase: () => Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 0, spawns: [] }),
    zombies: () => [doomed],
    bullets: () => [bulletInto(500, doomed)],
  })

const PLANK_PILE: Trap = Trap.Barricade({
  id: 900,
  door: 'West',
  hp: 21,
  maxHp: TRAPS.Barricade.hp,
  hitRemainingMs: 0,
})

const victorious: Model = modifyFocus(
  UiStruct.evolve(withKeys(readyModel, 4), {
    phase: () => Phase.Escaped({ wave: 10 }),
    traps: () => [PLANK_PILE],
    stats: scoring(4200),
  }),
  {
    trapStock: () => ({ Barricade: 1, Turret: 1 }),
    player: player =>
      UiStruct.evolve(player, {
        hp: () => 3,
        arsenal: () =>
          Arsenal.HoldingSecond({
            first: { ...STARTING_PISTOL, tier: 1, kills: 40 },
            second: { kind: 'Smg', loaded: 40, tier: 2, kills: 120 },
          }),
      }),
  },
)

const preparationWave = (phase: Phase): Option.Option<number> =>
  Option.map(
    Option.liftPredicate(phase, Phase.guards.Preparation),
    ({ wave }) => wave,
  )

describe('choosing a mode', () => {
  it.effect('the lobby plays the chosen mode, and E switches it', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        asVeteran(readyModel),
        steps(
          startRunFromHome,
          checkModel(({ mode, phase }) => {
            expect(mode).toEqual(RunMode.Campaign())
            expect(preparationWave(phase)).toEqual(Option.some(1))
          }),
        ),
      )
      yield* modelAfter(
        asVeteran(readyModel),
        steps(
          openLobbyByKey,
          press('KeyE'),
          resolveFocusLobby(),
          checkModel(({ home, phase }) => {
            expect(home.mode).toBe('Endless')
            expect(Phase.guards.Ready(phase)).toBe(true)
          }),
          press('Enter'),
          throughIntro,
          checkModel(({ mode, phase, seats: [{ player }] }) => {
            expect(mode).toEqual(RunMode.Endless())
            expect(preparationWave(phase)).toEqual(Option.some(1))
            expect(player.arsenal).toEqual(pistolOnly())
          }),
        ),
      )
    }),
  )

  it.effect('the mode buttons start the mode they name', () =>
    Effect.gen(function* () {
      yield* modelAfter(
        readyModel,
        steps(
          send(Message.ClickedEndlessButton()),
          throughIntro,
          checkModel(({ mode, phase }) => {
            expect(mode).toEqual(RunMode.Endless())
            expect(preparationWave(phase)).toEqual(Option.some(1))
          }),
        ),
      )
      yield* modelAfter(
        UiStruct.evolve(readyModel, { mode: () => RunMode.Endless() }),
        steps(
          send(Message.ClickedCampaignButton()),
          checkModel(({ mode }) => {
            expect(mode).toEqual(RunMode.Campaign())
          }),
        ),
      )
    }),
  )

  it.effect(
    'after Game Over, E starts a fresh endless run once the grace has passed',
    () =>
      modelAfter(
        UiStruct.evolve(withKeys(readyModel, 3), {
          phase: () => Phase.GameOver({ wave: 6 }),
        }),
        steps(
          press('KeyE'),
          checkModel(({ phase }) => {
            expect(Phase.guards.GameOver(phase)).toBe(true)
          }),
          waitOutGrace(),
          press('KeyE'),
          throughIntro,
          checkModel(({ mode, phase, keys }) => {
            expect(mode).toEqual(RunMode.Endless())
            expect(preparationWave(phase)).toEqual(Option.some(1))
            expect(keys.held).toBe(0)
          }),
        ),
      ),
  )
})

describe('campaign and endless after the tuned waves', () => {
  it.effect('the campaign carries on past its tuned waves, from the ramp', () =>
    modelAfter(
      clearingFinalWave(RunMode.Campaign()),
      steps(
        tick(FRAME_MS),
        checkModel(({ phase }) => {
          expect(preparationWave(phase)).toEqual(Option.some(FINAL_WAVE + 1))
        }),
      ),
    ),
  )

  it.effect('endless carries on past wave 8 into a tougher wave 9', () =>
    modelAfter(
      clearingFinalWave(RunMode.Endless()),
      steps(
        tick(FRAME_MS),
        checkModel(({ phase }) => {
          const preparation = Option.getOrThrow(
            Option.liftPredicate(phase, Phase.guards.Preparation),
          )
          expect(preparation.wave).toBe(FINAL_WAVE + 1)
          expect(preparation.remainingMs).toBe(breakMsOf('Normal'))
          expect(preparation.spawns.length).toBe(
            endlessZombieCount(FINAL_WAVE + 1),
          )
          expect(
            Array.every(
              preparation.spawns,
              ({ hpScale }) =>
                hpScale ===
                hpScaleFor(FINAL_WAVE + 1) * DIFFICULTIES.Normal.healthScale,
            ),
          ).toBe(true)
        }),
      ),
    ),
  )

  test('endless health, zombie count, and Big Lugs keep growing', () => {
    expect(hpScaleFor(FINAL_WAVE)).toBe(1)
    const waves = Array.makeBy(10, index => FINAL_WAVE + 1 + index)
    Array.forEach(Array.drop(waves, 1), wave => {
      expect(hpScaleFor(wave)).toBeGreaterThan(hpScaleFor(wave - 1))
      expect(hpScaleFor(wave) - hpScaleFor(wave - 1)).toBeGreaterThan(
        hpScaleFor(wave - 1) - hpScaleFor(wave - 2),
      )
      expect(endlessZombieCount(wave)).toBeGreaterThan(
        endlessZombieCount(wave - 1),
      )
      expect(endlessTankCount(wave)).toBeGreaterThanOrEqual(
        endlessTankCount(wave - 1),
      )
    })
    expect(endlessTankCount(FINAL_WAVE + 7)).toBeGreaterThan(
      endlessTankCount(FINAL_WAVE + 1),
    )
    const tanksIn = (wave: number) =>
      Array.filter(rollSpawns(7, wave)[1], ({ kind }) => kind === 'Tank').length
    expect(tanksIn(FINAL_WAVE + 7)).toBeGreaterThan(tanksIn(FINAL_WAVE))
  })

  it.effect(
    'an endless zombie spawns with its health scaled by the wave',
    () => {
      const wave = FINAL_WAVE + 5
      const scaled = Math.round(ZOMBIE_KINDS.Tank.hp * hpScaleFor(wave))
      return modelAfter(
        UiStruct.evolve(readyModel, {
          mode: () => RunMode.Endless(),
          phase: () =>
            Phase.Wave({
              wave,
              elapsedMs: 0,
              spawns: [
                {
                  atMs: 0,
                  kind: 'Tank',
                  door: 'North',
                  offset: 0,
                  speedScale: 1,
                  hpScale: hpScaleFor(wave),
                  pack: 0,
                  formation: 'Squad',
                },
                plannedSpawn(1e9),
              ],
            }),
        }),
        steps(
          tick(FRAME_MS),
          checkModel(({ zombies }) => {
            expect(Array.map(zombies, ({ hp, maxHp }) => [hp, maxHp])).toEqual([
              [scaled, scaled],
            ])
            expect(scaled).toBeGreaterThan(ZOMBIE_KINDS.Tank.hp)
          }),
        ),
      )
    },
  )

  it.effect(
    'no more than the alive cap are in the room, and the rest queue at the door',
    () => {
      const crowd = ZOMBIE_ALIVE_MAX + 14
      return modelAfter(
        UiStruct.evolve(readyModel, {
          mode: () => RunMode.Endless(),
          phase: () =>
            Phase.Wave({
              wave: FINAL_WAVE + 6,
              elapsedMs: 0,
              spawns: Array.makeBy(crowd, () => plannedSpawn(0)),
            }),
        }),
        steps(
          tick(FRAME_MS),
          checkModel(({ zombies, phase }) => {
            expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX)
            const wave = Option.getOrThrow(
              Option.liftPredicate(phase, Phase.guards.Wave),
            )
            expect(wave.spawns.length).toBe(crowd - ZOMBIE_ALIVE_MAX)
          }),
          ...Array.makeBy(20, () => tick(FRAME_MS)),
          checkModel(({ zombies }) => {
            expect(zombies.length).toBeLessThanOrEqual(ZOMBIE_ALIVE_MAX)
          }),
        ),
      )
    },
  )

  it.effect(
    'a pack waits to warn while the room is full, then warns as soon as a place frees up and walks in when the warning ends',
    () => {
      const full = Array.makeBy(ZOMBIE_ALIVE_MAX, index =>
        zombieAt(index + 1, 30 + (index % 6) * 8, 30 + index, {
          hp: ZOMBIE_MAX_HP,
        }),
      )
      const victim = zombieAt(999, MUZZLE_X, START_LEVEL.start.y, { hp: 1 })
      const pending = (phase: Phase): Option.Option<number> =>
        Option.map(
          Option.liftPredicate(phase, Phase.guards.Wave),
          ({ spawns }) => spawns.length,
        )
      return modelAfter(
        UiStruct.evolve(readyModel, {
          mode: () => RunMode.Endless(),
          phase: () =>
            Phase.Wave({
              wave: FINAL_WAVE + 2,
              elapsedMs: 0,
              spawns: [plannedSpawn(0)],
            }),
          zombies: () => [...Array.take(full, ZOMBIE_ALIVE_MAX - 1), victim],
          bullets: () => [bulletInto(500, victim)],
        }),
        steps(
          tick(FRAME_MS),
          checkModel(({ phase, pacing }) => {
            expect(pending(phase)).toEqual(Option.some(1))
            expect(pacing.warnedPacks).toEqual([])
          }),
          ticksFor(ZOMBIE_DYING_MS + FRAME_MS, FRAME_MS),
          checkModel(({ phase, pacing, zombies }) => {
            expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX - 1)
            expect(pacing.warnedPacks).toEqual([0])
            expect(pending(phase)).toEqual(Option.some(1))
          }),
          ticksFor(PACK_WARNING_MS, FRAME_MS),
          checkModel(({ phase, zombies }) => {
            expect(pending(phase)).toEqual(Option.some(0))
            expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX)
          }),
        ),
      )
    },
  )

  test('endless spawn plans are the same for the same seed and differ for another', () => {
    Array.forEach([FINAL_WAVE + 1, FINAL_WAVE + 4, FINAL_WAVE + 12], wave => {
      const [firstState, first] = rollSpawns(4242, wave)
      const [secondState, second] = rollSpawns(4242, wave)
      const [, other] = rollSpawns(777, wave)
      expect(second).toEqual(first)
      expect(secondState).toBe(firstState)
      expect(other).not.toEqual(first)
    })
  })
})

describe('after an escape', () => {
  it.effect('K keeps nothing going: an escape is the end of the run', () =>
    modelAfter(
      victorious,
      steps(
        waitOutGrace(),
        press('KeyK'),
        checkModel(({ phase, mode }) => {
          expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
          expect(mode).toEqual(RunMode.Campaign())
        }),
      ),
    ),
  )

  it.effect(
    'only the first endless wave of a run says they got beefier, later ones show a heart pip',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          clearingFinalWave(RunMode.Endless()),
          steps(
            tick(FRAME_MS),
            checkModel(({ phase }) => {
              expect(
                Option.map(preparationWave(phase), endlessBannerOf),
              ).toEqual(Option.some('Explained'))
            }),
          ),
        )
        expect(endlessBannerOf(FINAL_WAVE)).toBe('None')
        expect(endlessBannerOf(FINAL_WAVE + 2)).toBe('Pip')
        expect(endlessBannerOf(FINAL_WAVE + 7)).toBe('Pip')
      }),
  )

  it.effect('Enter on an escape starts a fresh campaign', () =>
    modelAfter(
      victorious,
      steps(
        waitOutGrace(),
        press('Enter'),
        throughIntro,
        checkModel(({ mode, phase, keys, traps }) => {
          expect(mode).toEqual(RunMode.Campaign())
          expect(preparationWave(phase)).toEqual(Option.some(1))
          expect(keys.held).toBe(0)
          expect(traps).toEqual([])
        }),
      ),
    ),
  )

  it.effect(
    'a stray tap, click, or other key on an escape keeps the run waiting for a choice',
    () =>
      modelAfter(
        victorious,
        steps(
          waitOutGrace(),
          send(
            Message.PressedPointer({
              pointerId: 3,
              device: 'Touch',
              clientX: 400,
              clientY: 200,
            }),
          ),
          send(Message.ReleasedPointer({ pointerId: 3 })),
          send(
            Message.PressedPointer({
              pointerId: 1,
              device: 'Mouse',
              clientX: 300,
              clientY: 150,
            }),
          ),
          send(Message.ReleasedPointer({ pointerId: 1 })),
          press('KeyW'),
          press('KeyQ'),
          checkModel(({ phase, keys, traps }) => {
            expect(phase).toEqual(Phase.Escaped({ wave: 10 }))
            expect(keys).toEqual(victorious.keys)
            expect(traps).toEqual([PLANK_PILE])
          }),
        ),
      ),
  )

  it.effect('a tap on Game Over, beside its buttons, starts nothing', () =>
    modelAfter(
      UiStruct.evolve(readyModel, {
        phase: () => Phase.GameOver({ wave: 4 }),
      }),
      steps(
        waitOutGrace(),
        send(
          Message.PressedPointer({
            pointerId: 3,
            device: 'Touch',
            clientX: 400,
            clientY: 200,
          }),
        ),
        checkModel(({ phase }) => {
          expect(Phase.guards.GameOver(phase)).toBe(true)
        }),
      ),
    ),
  )
})

describe('best wave this session', () => {
  const dyingIn = (base: Model, wave: number): Model =>
    modifyFocus(
      UiStruct.evolve(base, {
        mode: () => RunMode.Endless(),
        phase: () =>
          Phase.Wave({ wave, elapsedMs: 0, spawns: [plannedSpawn(1e9)] }),
      }),
      { player: player => UiStruct.evolve(player, { hp: () => 0 }) },
    )

  it.effect(
    'an endless death records the best wave, and a worse run keeps it',
    () =>
      Effect.gen(function* () {
        yield* modelAfter(
          dyingIn(readyModel, 12),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(current.phase).toEqual(Phase.GameOver({ wave: 12 }))
              expect(bestsFor(current).maybeBestEndlessWave).toEqual(
                Option.some(12),
              )
            }),
          ),
        )
        yield* modelAfter(
          dyingIn(
            withBests(readyModel, bests =>
              UiStruct.evolve(bests, {
                maybeBestEndlessWave: () => Option.some(14),
              }),
            ),
            10,
          ),
          steps(
            tick(FRAME_MS),
            checkModel(current => {
              expect(bestsFor(current).maybeBestEndlessWave).toEqual(
                Option.some(14),
              )
            }),
            waitOutGrace(),
            press('KeyE'),
            checkModel(current => {
              expect(current.mode).toEqual(RunMode.Endless())
              expect(bestsFor(current).maybeBestEndlessWave).toEqual(
                Option.some(14),
              )
            }),
          ),
        )
      }),
  )

  it.effect('a campaign death leaves the endless best alone', () =>
    modelAfter(
      UiStruct.evolve(dyingIn(readyModel, 5), {
        mode: () => RunMode.Campaign(),
      }),
      steps(
        tick(FRAME_MS),
        checkModel(current => {
          expect(bestsFor(current).maybeBestEndlessWave).toEqual(Option.none())
        }),
      ),
    ),
  )
})
