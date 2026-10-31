import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  PISTOL_MAGAZINE,
  PISTOL_RELOAD_MS,
  PREPARATION_MS,
} from './constants'
import { update } from './main'
import { Message } from './message'
import {
  Arsenal,
  type CarriedGun,
  type Model,
  Phase,
  Reload,
  ShopState,
  initialModel,
} from './model'
import { DISTANT_SPAWN, withArsenal } from './model.fixture'
import {
  countdownTicks,
  holdFire,
  holdingFirst,
  holdingSecond,
  maybeSpareGun,
  pistolOf,
  press,
  release,
  releaseFire,
  tagsOf,
  tick,
  ticks,
  withPistol,
} from './testing'
import { WEAPONS } from './weapons'

const FRAME_MS = FIXED_STEP_MS
const TICKS_PER_SHOT = countdownTicks(FIRE_INTERVAL_MS)
const PISTOL_RELOAD_TICKS = countdownTicks(PISTOL_RELOAD_MS)
const SMG_FIRING_TICKS = countdownTicks(3000)

// NOTE: a countdown of whole ticks of 1000/60 ms lands a hair off the
// round number.
const aboutMs = (ms: number) => Option.some(expect.closeTo(ms, 6))

const fighting: Model = modifyFields(initialModel, {
  maybeSurface: () => Option.some({ left: 0, top: 0, width: 800, height: 400 }),
  phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
})

const preparing: Model = modifyFields(fighting, {
  phase: () =>
    Phase.Preparation({
      wave: 2,
      remainingMs: 15_000,
      durationMs: PREPARATION_MS,
      spawns: [DISTANT_SPAWN],
    }),
})

const withPistolLoaded = (base: Model, pistolLoaded: number): Model =>
  modifyFields(base, {
    player: player =>
      withPistol(player, pistol => ({ ...pistol, loaded: pistolLoaded })),
  })

const smg = (rounds: number, loaded: number): CarriedGun => ({
  kind: 'Smg',
  rounds,
  loaded,
  tier: 0,
})

const reloadingMs = (reload: Reload): Option.Option<number> =>
  Reload.match(reload, {
    Ready: () => Option.none(),
    Reloading: ({ remainingMs }) => Option.some(remainingMs),
  })

const spareRounds = (
  arsenal: Arsenal,
): Option.Option<Readonly<{ rounds: number; loaded: number }>> =>
  Option.map(maybeSpareGun(arsenal), ({ rounds, loaded }) => ({
    rounds,
    loaded,
  }))

describe('magazines', () => {
  test('the pistol fires its magazine, then stops and reloads', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 2)),
      holdFire,
      ...ticks(1 + TICKS_PER_SHOT, FRAME_MS),
      model(({ player, stats }) => {
        expect(stats.shotsFired).toBe(2)
        expect(pistolOf(player).loaded).toBe(0)
      }),
      ...ticks(TICKS_PER_SHOT, FRAME_MS),
      model(({ player, stats, frameEvents }) => {
        expect(stats.shotsFired).toBe(2)
        expect(tagsOf(frameEvents)).toEqual(
          expect.arrayContaining(['DryFired', 'ReloadStarted']),
        )
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
      }),
      ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
      model(({ stats, frameEvents }) => {
        expect(stats.shotsFired).toBe(2)
        expect(tagsOf(frameEvents)).not.toContain('Fired')
      }),
    )
  })

  test('a reload takes the reload time, then the trigger fires again', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 0)),
      holdFire,
      tick(FRAME_MS),
      model(({ player, stats }) => {
        expect(stats.shotsFired).toBe(0)
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
      ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
      model(({ player, stats }) => {
        expect(stats.shotsFired).toBe(0)
        expect(pistolOf(player).loaded).toBe(0)
        expect(
          Option.exists(
            reloadingMs(player.reload),
            remainingMs => remainingMs > 0 && remainingMs <= FRAME_MS,
          ),
        ).toBe(true)
      }),
      tick(FRAME_MS),
      model(({ player, stats, frameEvents }) => {
        expect(tagsOf(frameEvents)).toEqual(
          expect.arrayContaining(['Reloaded', 'Fired']),
        )
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        expect(stats.shotsFired).toBe(1)
        expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE - 1)
      }),
    )
  })

  test('an empty magazine reloads on its own without a dry click when the trigger is up', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 0)),
      tick(FRAME_MS),
      model(({ player, frameEvents }) => {
        expect(tagsOf(frameEvents)).toContain('ReloadStarted')
        expect(tagsOf(frameEvents)).not.toContain('DryFired')
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    )
  })

  test('the pistol never runs out: it reloads magazine after magazine', () => {
    const magazines = 3
    const magazineTicks =
      PISTOL_MAGAZINE * TICKS_PER_SHOT +
      PISTOL_RELOAD_TICKS +
      countdownTicks(100)
    story(
      update,
      given(fighting),
      holdFire,
      ...ticks(magazines * magazineTicks, FRAME_MS),
      model(({ player, stats }) => {
        expect(stats.shotsFired).toBeGreaterThan(magazines * PISTOL_MAGAZINE)
        expect(player.arsenal._tag).toBe('OneGun')
        expect(pistolOf(player).rounds).toBe(0)
        expect(pistolOf(player).loaded).toBeGreaterThan(0)
      }),
    )
  })

  test('the SMG loads its magazine from its limited rounds', () => {
    const magazine = WEAPONS.Smg.magazine
    story(
      update,
      given(withArsenal(fighting, holdingSecond(smg(magazine + 10, magazine)))),
      holdFire,
      ...ticks(SMG_FIRING_TICKS, FRAME_MS),
      releaseFire,
      model(({ player }) => {
        expect(spareRounds(player.arsenal)).toEqual(
          Option.some({ rounds: 10, loaded: 0 }),
        )
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
      ...ticks(countdownTicks(WEAPONS.Smg.reloadMs), FRAME_MS),
      model(({ player }) => {
        expect(spareRounds(player.arsenal)).toEqual(
          Option.some({ rounds: 10, loaded: 10 }),
        )
      }),
    )
  })
})

describe('manual reload', () => {
  test('R reloads a part-empty pistol and drops its magazine', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 3)),
      press('KeyR'),
      model(({ player, particles }) => {
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
        expect(Array.map(particles, ({ kind }) => kind)).toContain('Clip')
      }),
      release('KeyR'),
      ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
      model(({ player }) => {
        expect(pistolOf(player).loaded).toBe(3)
      }),
      tick(FRAME_MS),
      model(({ player, frameEvents }) => {
        expect(tagsOf(frameEvents)).toContain('Reloaded')
        expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
      }),
    )
  })

  test('R does nothing with a full magazine, mid-reload, or with no loose rounds', () => {
    const midReload = modifyFields(withPistolLoaded(fighting, 3), {
      player: player =>
        modifyFields(player, {
          reload: () =>
            Reload.Reloading({
              remainingMs: 400,
              durationMs: PISTOL_RELOAD_MS,
            }),
        }),
    })
    const noLooseRounds = withArsenal(fighting, holdingSecond(smg(12, 12)))
    Array.forEach([fighting, midReload, noLooseRounds], start =>
      story(
        update,
        given(start),
        press('KeyR'),
        model(({ player }) => {
          expect(player).toEqual(start.player)
        }),
      ),
    )
  })

  test('the reload button reloads like R', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 1)),
      message(Message.ClickedReloadButton()),
      model(({ player }) => {
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
      }),
    )
  })

  test('R reloads during preparation and does not start the wave', () => {
    story(
      update,
      given(withPistolLoaded(preparing, 4)),
      press('KeyR'),
      model(({ player, phase }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    )
  })
})

describe('reload pauses', () => {
  test('a reload does not progress while the game is paused', () => {
    story(
      update,
      given(withPistolLoaded(fighting, 3)),
      press('KeyR'),
      ...ticks(4, FRAME_MS),
      press('Escape'),
      release('Escape'),
      ...ticks(PISTOL_RELOAD_TICKS * 2, FRAME_MS),
      press('KeyR'),
      model(({ player, phase }) => {
        expect(Phase.isAnyOf(['Paused'])(phase)).toBe(true)
        expect(reloadingMs(player.reload)).toEqual(
          aboutMs(PISTOL_RELOAD_MS - 4 * FRAME_MS),
        )
      }),
      press('Escape'),
      ...ticks(PISTOL_RELOAD_TICKS - 4, FRAME_MS),
      model(({ player }) => {
        expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
      }),
    )
  })

  test('a reload does not progress while the shop is open', () => {
    const shopping = modifyFields(withPistolLoaded(preparing, 3), {
      shop: () => ShopState.Browsing({ focusedItem: 'Heart' }),
      shopDialog: dialog => ({ ...dialog, isOpen: true }),
      player: player =>
        modifyFields(player, {
          reload: () =>
            Reload.Reloading({
              remainingMs: 400,
              durationMs: PISTOL_RELOAD_MS,
            }),
        }),
    })
    story(
      update,
      given(shopping),
      ...ticks(PISTOL_RELOAD_TICKS, FRAME_MS),
      model(({ player }) => {
        expect(reloadingMs(player.reload)).toEqual(Option.some(400))
        expect(pistolOf(player).loaded).toBe(3)
      }),
    )
  })
})

describe('swapping', () => {
  test('swapping guns cancels the reload, and each gun keeps its own magazine', () => {
    story(
      update,
      given(
        withPistolLoaded(withArsenal(fighting, holdingFirst(smg(90, 30))), 3),
      ),
      press('KeyR'),
      ...ticks(PISTOL_RELOAD_TICKS - 2, FRAME_MS),
      press('KeyQ'),
      release('KeyQ'),
      model(({ player }) => {
        expect(Arsenal.isAnyOf(['HoldingSecond'])(player.arsenal)).toBe(true)
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
      }),
      ...ticks(PISTOL_RELOAD_TICKS, FRAME_MS),
      model(({ player }) => {
        expect(pistolOf(player).loaded).toBe(3)
        expect(spareRounds(player.arsenal)).toEqual(
          Option.some({ rounds: 90, loaded: 30 }),
        )
      }),
      press('KeyQ'),
      model(({ player }) => {
        expect(Arsenal.isAnyOf(['HoldingFirst'])(player.arsenal)).toBe(true)
        expect(pistolOf(player).loaded).toBe(3)
        expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
      }),
    )
  })
})
