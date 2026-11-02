import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import {
  PACK_WARNING_MS,
  PREPARATION_MS,
  ZOMBIE_ALIVE_MAX,
  ZOMBIE_DYING_MS,
  ZOMBIE_MAX_HP,
} from './constants'
import { DIFFICULTIES } from './difficulty'
import {
  endlessTankCount,
  endlessZombieCount,
  hpScaleFor,
  rollSpawns,
} from './endlessWaves'
import { bestsFor, withBests } from './home'
import { update } from './main'
import { Message } from './message'
import {
  DifficultyCard,
  type Model,
  Phase,
  RunMode,
  Trap,
  initialModel,
} from './model'
import { plannedSpawn } from './model.fixture'
import { endlessBannerOf } from './screens'
import { scoreOf } from './stats'
import {
  MUZZLE_X,
  RESTART_GRACE_TICKS,
  bulletInto,
  doomed,
  holdingSecond,
  openLobbyByKey,
  pistolOf,
  pistolOnly,
  press,
  resolveFocusLobby,
  scoring,
  startRunFromHome,
  tick,
  ticksFor,
  zombieAt,
} from './testing'
import { asVeteran } from './veteran'
import { FINAL_WAVE } from './wavePlans'
import { STARTING_PISTOL } from './weapons'
import { ZOMBIE_KINDS } from './zombies'

const FRAME_MS = 50
const GRACE_TICK_MS = 50
const readyModel: Model = modifyFields(initialModel, {
  difficultyCard: () => DifficultyCard.Seen(),
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
})

const waitOutGrace = () =>
  Array.makeBy(RESTART_GRACE_TICKS, () => tick(GRACE_TICK_MS))

const clearingFinalWave = (mode: RunMode): Model =>
  modifyFields(readyModel, {
    mode: () => mode,
    phase: () => Phase.Wave({ wave: FINAL_WAVE, elapsedMs: 0, spawns: [] }),
    zombies: () => [doomed],
    bullets: () => [bulletInto(500, doomed)],
  })

const PLANK_PILE: Trap = Trap.Barricade({
  id: 900,
  door: 'West',
  hp: 21,
  hitRemainingMs: 0,
})

const victorious: Model = modifyFields(readyModel, {
  phase: () => Phase.Victory(),
  wallet: () => ({ balance: 412, earned: 1900, shown: 412 }),
  traps: () => [PLANK_PILE],
  trapStock: () => ({ Barricade: 1, Turret: 1 }),
  stats: scoring(4200),
  player: player =>
    modifyFields(player, {
      hp: () => 3,
      arsenal: () =>
        holdingSecond(
          { kind: 'Smg', rounds: 210, loaded: 40, tier: 2 },
          { ...STARTING_PISTOL, tier: 1 },
        ),
    }),
})

const preparationWave = (phase: Phase): Option.Option<number> =>
  Option.map(
    Option.liftPredicate(phase, Phase.guards.Preparation),
    ({ wave }) => wave,
  )

describe('choosing a mode', () => {
  test('the lobby plays the chosen mode, and E switches it', () => {
    story(
      update,
      given(asVeteran(readyModel)),
      startRunFromHome,
      model(({ mode, phase }) => {
        expect(mode).toEqual(RunMode.Campaign())
        expect(preparationWave(phase)).toEqual(Option.some(1))
      }),
    )
    story(
      update,
      given(asVeteran(readyModel)),
      openLobbyByKey,
      press('KeyE'),
      resolveFocusLobby(),
      model(({ home, phase }) => {
        expect(home.mode).toBe('Endless')
        expect(Phase.guards.Ready(phase)).toBe(true)
      }),
      press('Enter'),
      model(({ mode, phase, player }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(preparationWave(phase)).toEqual(Option.some(1))
        expect(player.arsenal).toEqual(pistolOnly())
      }),
    )
  })

  test('the mode buttons start the mode they name', () => {
    story(
      update,
      given(readyModel),
      message(Message.ClickedEndlessButton()),
      model(({ mode, phase }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(preparationWave(phase)).toEqual(Option.some(1))
      }),
    )
    story(
      update,
      given(modifyFields(readyModel, { mode: () => RunMode.Endless() })),
      message(Message.ClickedCampaignButton()),
      model(({ mode }) => {
        expect(mode).toEqual(RunMode.Campaign())
      }),
    )
  })

  test('after Game Over, E starts a fresh endless run once the grace has passed', () => {
    story(
      update,
      given(
        modifyFields(readyModel, {
          phase: () => Phase.GameOver({ wave: 6 }),
          wallet: () => ({ balance: 300, earned: 900, shown: 300 }),
        }),
      ),
      press('KeyE'),
      model(({ phase }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
      }),
      ...waitOutGrace(),
      press('KeyE'),
      model(({ mode, phase, wallet }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(preparationWave(phase)).toEqual(Option.some(1))
        expect(wallet.balance).toBe(0)
      }),
    )
  })
})

describe('campaign and endless after wave 8', () => {
  test('the campaign still ends in Victory after wave 8', () => {
    story(
      update,
      given(clearingFinalWave(RunMode.Campaign())),
      tick(FRAME_MS),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
    )
  })

  test('endless carries on past wave 8 into a tougher wave 9', () => {
    story(
      update,
      given(clearingFinalWave(RunMode.Endless())),
      tick(FRAME_MS),
      model(({ phase }) => {
        const preparation = Option.getOrThrow(
          Option.liftPredicate(phase, Phase.guards.Preparation),
        )
        expect(preparation.wave).toBe(FINAL_WAVE + 1)
        expect(preparation.remainingMs).toBe(PREPARATION_MS)
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
    )
  })

  test('endless health, zombie count, and Big Lugs keep growing', () => {
    expect(hpScaleFor(FINAL_WAVE)).toBe(1)
    const waves = Array.makeBy(10, index => FINAL_WAVE + 1 + index)
    Array.forEach(Array.drop(waves, 1), wave => {
      expect(hpScaleFor(wave)).toBeGreaterThan(hpScaleFor(wave - 1))
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

  test('an endless zombie spawns with its health scaled by the wave', () => {
    const wave = FINAL_WAVE + 5
    const scaled = Math.round(ZOMBIE_KINDS.Tank.hp * hpScaleFor(wave))
    story(
      update,
      given(
        modifyFields(readyModel, {
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
      ),
      tick(FRAME_MS),
      model(({ zombies }) => {
        expect(Array.map(zombies, ({ hp, maxHp }) => [hp, maxHp])).toEqual([
          [scaled, scaled],
        ])
        expect(scaled).toBeGreaterThan(ZOMBIE_KINDS.Tank.hp)
      }),
    )
  })

  test('no more than the alive cap are in the room, and the rest queue at the door', () => {
    const crowd = ZOMBIE_ALIVE_MAX + 14
    story(
      update,
      given(
        modifyFields(readyModel, {
          mode: () => RunMode.Endless(),
          phase: () =>
            Phase.Wave({
              wave: FINAL_WAVE + 6,
              elapsedMs: 0,
              spawns: Array.makeBy(crowd, () => plannedSpawn(0)),
            }),
        }),
      ),
      tick(FRAME_MS),
      model(({ zombies, phase }) => {
        expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX)
        const wave = Option.getOrThrow(
          Option.liftPredicate(phase, Phase.guards.Wave),
        )
        expect(wave.spawns.length).toBe(crowd - ZOMBIE_ALIVE_MAX)
      }),
      ...Array.makeBy(20, () => tick(FRAME_MS)),
      model(({ zombies }) => {
        expect(zombies.length).toBeLessThanOrEqual(ZOMBIE_ALIVE_MAX)
      }),
    )
  })

  test('a pack waits to warn while the room is full, then warns as soon as a place frees up and walks in when the warning ends', () => {
    const full = Array.makeBy(ZOMBIE_ALIVE_MAX, index =>
      zombieAt(index + 1, 30 + (index % 6) * 8, 30 + index, {
        hp: ZOMBIE_MAX_HP,
      }),
    )
    const victim = zombieAt(999, MUZZLE_X, PARLOUR.height / 2, { hp: 1 })
    const pending = (phase: Phase): Option.Option<number> =>
      Option.map(
        Option.liftPredicate(phase, Phase.guards.Wave),
        ({ spawns }) => spawns.length,
      )
    story(
      update,
      given(
        modifyFields(readyModel, {
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
      ),
      tick(FRAME_MS),
      model(({ phase, pacing }) => {
        expect(pending(phase)).toEqual(Option.some(1))
        expect(pacing.warnedPacks).toEqual([])
      }),
      ...ticksFor(ZOMBIE_DYING_MS + FRAME_MS, FRAME_MS),
      model(({ phase, pacing, zombies }) => {
        expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX - 1)
        expect(pacing.warnedPacks).toEqual([0])
        expect(pending(phase)).toEqual(Option.some(1))
      }),
      ...ticksFor(PACK_WARNING_MS, FRAME_MS),
      model(({ phase, zombies }) => {
        expect(pending(phase)).toEqual(Option.some(0))
        expect(zombies.length).toBe(ZOMBIE_ALIVE_MAX)
      }),
    )
  })

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

describe('keep going from Victory', () => {
  test('K continues the same run into endless wave 9 with money, guns, and traps', () => {
    story(
      update,
      given(victorious),
      press('KeyK'),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.Victory())
      }),
      ...waitOutGrace(),
      press('KeyK'),
      model(({ mode, phase, wallet, player, traps, trapStock, stats }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(preparationWave(phase)).toEqual(Option.some(FINAL_WAVE + 1))
        expect(wallet).toEqual(victorious.wallet)
        expect(player.arsenal).toEqual(victorious.player.arsenal)
        expect(pistolOf(player).tier).toBe(1)
        expect(player.hp).toBe(3)
        expect(traps).toEqual([PLANK_PILE])
        expect(trapStock).toEqual({ Barricade: 1, Turret: 1 })
        expect(scoreOf(stats)).toBe(4200)
      }),
    )
  })

  test('the Keep going button does the same', () => {
    story(
      update,
      given(victorious),
      ...waitOutGrace(),
      message(Message.ClickedKeepGoingButton()),
      model(({ mode, phase, wallet, traps }) => {
        expect(mode).toEqual(RunMode.Endless())
        expect(preparationWave(phase)).toEqual(Option.some(FINAL_WAVE + 1))
        expect(wallet.balance).toBe(412)
        expect(traps).toEqual([PLANK_PILE])
      }),
    )
  })

  test('only the first endless wave of a run says they got beefier, later ones show a heart pip', () => {
    story(
      update,
      given(victorious),
      ...waitOutGrace(),
      message(Message.ClickedKeepGoingButton()),
      model(({ phase }) => {
        expect(Option.map(preparationWave(phase), endlessBannerOf)).toEqual(
          Option.some('Explained'),
        )
      }),
    )
    expect(endlessBannerOf(FINAL_WAVE)).toBe('None')
    expect(endlessBannerOf(FINAL_WAVE + 2)).toBe('Pip')
    expect(endlessBannerOf(FINAL_WAVE + 7)).toBe('Pip')
  })

  test('Enter on Victory still starts a fresh campaign', () => {
    story(
      update,
      given(victorious),
      ...waitOutGrace(),
      press('Enter'),
      model(({ mode, phase, wallet, traps }) => {
        expect(mode).toEqual(RunMode.Campaign())
        expect(preparationWave(phase)).toEqual(Option.some(1))
        expect(wallet.balance).toBe(0)
        expect(traps).toEqual([])
      }),
    )
  })

  test('a stray tap, click, or other key on Victory keeps the run waiting for a choice', () => {
    story(
      update,
      given(victorious),
      ...waitOutGrace(),
      message(
        Message.PressedPointer({
          pointerId: 3,
          device: 'Touch',
          clientX: 400,
          clientY: 200,
        }),
      ),
      message(Message.ReleasedPointer({ pointerId: 3 })),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: 300,
          clientY: 150,
        }),
      ),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      press('KeyW'),
      press('KeyQ'),
      model(({ phase, wallet, traps }) => {
        expect(phase).toEqual(Phase.Victory())
        expect(wallet).toEqual(victorious.wallet)
        expect(traps).toEqual([PLANK_PILE])
      }),
      press('KeyK'),
      model(({ phase, mode }) => {
        expect(preparationWave(phase)).toEqual(Option.some(FINAL_WAVE + 1))
        expect(mode).toEqual(RunMode.Endless())
      }),
    )
  })

  test('a tap on Game Over, beside its buttons, starts nothing', () => {
    story(
      update,
      given(
        modifyFields(readyModel, { phase: () => Phase.GameOver({ wave: 4 }) }),
      ),
      ...waitOutGrace(),
      message(
        Message.PressedPointer({
          pointerId: 3,
          device: 'Touch',
          clientX: 400,
          clientY: 200,
        }),
      ),
      model(({ phase }) => {
        expect(Phase.guards.GameOver(phase)).toBe(true)
      }),
    )
  })

  test('K does nothing outside Victory', () => {
    story(
      update,
      given(
        modifyFields(readyModel, { phase: () => Phase.GameOver({ wave: 4 }) }),
      ),
      ...waitOutGrace(),
      press('KeyK'),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 4 }))
      }),
    )
  })
})

describe('best wave this session', () => {
  const dyingIn = (base: Model, wave: number): Model =>
    modifyFields(base, {
      mode: () => RunMode.Endless(),
      phase: () =>
        Phase.Wave({ wave, elapsedMs: 0, spawns: [plannedSpawn(1e9)] }),
      player: player => modifyFields(player, { hp: () => 0 }),
    })

  test('an endless death records the best wave, and a worse run keeps it', () => {
    story(
      update,
      given(dyingIn(readyModel, 12)),
      tick(FRAME_MS),
      model(current => {
        expect(current.phase).toEqual(Phase.GameOver({ wave: 12 }))
        expect(bestsFor(current).maybeBestEndlessWave).toEqual(Option.some(12))
      }),
    )
    story(
      update,
      given(
        dyingIn(
          withBests(readyModel, bests =>
            modifyFields(bests, {
              maybeBestEndlessWave: () => Option.some(14),
            }),
          ),
          10,
        ),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(bestsFor(current).maybeBestEndlessWave).toEqual(Option.some(14))
      }),
      ...waitOutGrace(),
      press('KeyE'),
      model(current => {
        expect(current.mode).toEqual(RunMode.Endless())
        expect(bestsFor(current).maybeBestEndlessWave).toEqual(Option.some(14))
      }),
    )
  })

  test('a campaign death leaves the endless best alone', () => {
    story(
      update,
      given(
        modifyFields(dyingIn(readyModel, 5), {
          mode: () => RunMode.Campaign(),
        }),
      ),
      tick(FRAME_MS),
      model(current => {
        expect(bestsFor(current).maybeBestEndlessWave).toEqual(Option.none())
      }),
    )
  })
})
