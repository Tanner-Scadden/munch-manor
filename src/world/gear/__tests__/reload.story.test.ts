import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Arsenal,
  type CarriedGun,
  type Difficulty,
  type Model,
  Phase,
  Reload,
} from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import {
  FIRE_INTERVAL_MS,
  FIXED_STEP_MS,
  IDLE_RELOAD_MS,
  PISTOL_MAGAZINE,
  PISTOL_RELOAD_MS,
  PREPARATION_MS,
} from '../../../shared/constants'
import { DISTANT_SPAWN, withArsenal } from '../../../test/model.fixture'
import {
  APPLICATION,
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
} from '../../../test/testing'
import { focusOf, modifyFocus } from '../../party/party'
import { WEAPONS } from '../weapons'

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
  modifyFocus(base, {
    player: player =>
      withPistol(player, pistol => ({ ...pistol, loaded: pistolLoaded })),
  })

const smg = (loaded: number): CarriedGun => ({
  kind: 'Smg',
  loaded,
  tier: 0,
  kills: 0,
})

const reloadingMs = (reload: Reload): Option.Option<number> =>
  Reload.match(reload, {
    Ready: () => Option.none(),
    Reloading: ({ remainingMs }) => Option.some(remainingMs),
  })

const spareLoaded = (arsenal: Arsenal): Option.Option<number> =>
  Option.map(maybeSpareGun(arsenal), ({ loaded }) => loaded)

describe('magazines', () => {
  it.effect('the pistol fires its magazine, then stops and reloads', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(fighting, 2)),
      holdFire,
      ...ticks(1 + TICKS_PER_SHOT, FRAME_MS),
      Story.model(({ seats: [{ player }], stats }) => {
        expect(stats.shotsFired).toBe(2)
        expect(pistolOf(player).loaded).toBe(0)
      }),
      ...ticks(TICKS_PER_SHOT, FRAME_MS),
      Story.model(({ seats: [{ player }], stats, frameEvents }) => {
        expect(stats.shotsFired).toBe(2)
        expect(tagsOf(frameEvents)).toEqual(
          expect.arrayContaining(['DryFired', 'ReloadStarted']),
        )
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
      }),
      ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
      Story.model(({ stats, frameEvents }) => {
        expect(stats.shotsFired).toBe(2)
        expect(tagsOf(frameEvents)).not.toContain('Fired')
      }),
    ),
  )

  it.effect(
    'a reload takes the reload time, then the trigger fires again',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withPistolLoaded(fighting, 0)),
        holdFire,
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }], stats }) => {
          expect(stats.shotsFired).toBe(0)
          expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
        }),
        ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
        Story.model(({ seats: [{ player }], stats }) => {
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
        Story.model(({ seats: [{ player }], stats, frameEvents }) => {
          expect(tagsOf(frameEvents)).toEqual(
            expect.arrayContaining(['Reloaded', 'Fired']),
          )
          expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
          expect(stats.shotsFired).toBe(1)
          expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE - 1)
        }),
      ),
  )

  it.effect(
    'an empty magazine reloads on its own without a dry click when the trigger is up',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withPistolLoaded(fighting, 0)),
        tick(FRAME_MS),
        Story.model(({ seats: [{ player }], frameEvents }) => {
          expect(tagsOf(frameEvents)).toContain('ReloadStarted')
          expect(tagsOf(frameEvents)).not.toContain('DryFired')
          expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
        }),
      ),
  )

  it.effect(
    'the pistol never runs out: it reloads magazine after magazine',
    () => {
      const magazines = 3
      const magazineTicks =
        PISTOL_MAGAZINE * TICKS_PER_SHOT +
        PISTOL_RELOAD_TICKS +
        countdownTicks(100)
      return Story.story(
        APPLICATION,
        Story.given(fighting),
        holdFire,
        ...ticks(magazines * magazineTicks, FRAME_MS),
        Story.model(({ seats: [{ player }], stats }) => {
          expect(stats.shotsFired).toBeGreaterThan(magazines * PISTOL_MAGAZINE)
          expect(player.arsenal._tag).toBe('OneGun')
          expect(pistolOf(player).loaded).toBeGreaterThan(0)
        }),
      )
    },
  )

  it.effect(
    'a bought gun never runs out either: an empty SMG reloads a full magazine',
    () => {
      const magazine = WEAPONS.Smg.magazine
      return Story.story(
        APPLICATION,
        Story.given(withArsenal(fighting, holdingSecond(smg(magazine)))),
        holdFire,
        ...ticks(SMG_FIRING_TICKS, FRAME_MS),
        releaseFire,
        Story.model(({ seats: [{ player }] }) => {
          expect(spareLoaded(player.arsenal)).toEqual(Option.some(0))
          expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
        }),
        ...ticks(countdownTicks(WEAPONS.Smg.reloadMs), FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(spareLoaded(player.arsenal)).toEqual(Option.some(magazine))
        }),
      )
    },
  )
})

describe('manual reload', () => {
  it.effect('R reloads a part-empty pistol and drops its magazine', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(fighting, 3)),
      press('KeyR'),
      Story.model(({ seats: [{ player }], particles }) => {
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
        expect(Array.map(particles, ({ kind }) => kind)).toContain('Clip')
      }),
      release('KeyR'),
      ...ticks(PISTOL_RELOAD_TICKS - 1, FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(pistolOf(player).loaded).toBe(3)
      }),
      tick(FRAME_MS),
      Story.model(({ seats: [{ player }], frameEvents }) => {
        expect(tagsOf(frameEvents)).toContain('Reloaded')
        expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
      }),
    ),
  )

  it.effect('R does nothing with a full magazine or mid-reload', () =>
    Effect.gen(function* () {
      const midReload = modifyFocus(withPistolLoaded(fighting, 3), {
        player: player =>
          modifyFields(player, {
            reload: () =>
              Reload.Reloading({
                remainingMs: 400,
                durationMs: PISTOL_RELOAD_MS,
              }),
          }),
      })
      const fullSmg = withArsenal(
        fighting,
        holdingSecond(smg(WEAPONS.Smg.magazine)),
      )
      yield* Effect.forEach([fighting, midReload, fullSmg], start =>
        Story.story(
          APPLICATION,
          Story.given(start),
          press('KeyR'),
          Story.model(({ seats: [{ player }] }) => {
            expect(player).toEqual(focusOf(start).player)
          }),
        ),
      )
    }),
  )

  it.effect('the reload button reloads like R', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(fighting, 1)),
      Story.message(Message.ClickedReloadButton()),
      Story.model(({ seats: [{ player }] }) => {
        expect(reloadingMs(player.reload)).toEqual(
          Option.some(PISTOL_RELOAD_MS),
        )
      }),
    ),
  )

  it.effect('R reloads during preparation and does not start the wave', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(preparing, 4)),
      press('KeyR'),
      Story.model(({ seats: [{ player }], phase }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(Reload.isAnyOf(['Reloading'])(player.reload)).toBe(true)
      }),
    ),
  )
})

describe('reload pauses', () => {
  it.effect('a reload does not progress while the game is paused', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(fighting, 3)),
      press('KeyR'),
      ...ticks(4, FRAME_MS),
      press('Escape'),
      release('Escape'),
      ...ticks(PISTOL_RELOAD_TICKS * 2, FRAME_MS),
      press('KeyR'),
      Story.model(({ seats: [{ player }], phase }) => {
        expect(Phase.isAnyOf(['Paused'])(phase)).toBe(true)
        expect(reloadingMs(player.reload)).toEqual(
          aboutMs(PISTOL_RELOAD_MS - 4 * FRAME_MS),
        )
      }),
      press('Escape'),
      ...ticks(PISTOL_RELOAD_TICKS - 4, FRAME_MS),
      Story.model(({ seats: [{ player }] }) => {
        expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
      }),
    ),
  )
})

describe('swapping', () => {
  it.effect(
    'swapping guns cancels the reload, and each gun keeps its own magazine',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          withPistolLoaded(withArsenal(fighting, holdingFirst(smg(30))), 3),
        ),
        press('KeyR'),
        ...ticks(PISTOL_RELOAD_TICKS - 2, FRAME_MS),
        press('KeyQ'),
        release('KeyQ'),
        Story.model(({ seats: [{ player }] }) => {
          expect(Arsenal.isAnyOf(['HoldingSecond'])(player.arsenal)).toBe(true)
          expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        }),
        ...ticks(PISTOL_RELOAD_TICKS, FRAME_MS),
        Story.model(({ seats: [{ player }] }) => {
          expect(pistolOf(player).loaded).toBe(3)
          expect(spareLoaded(player.arsenal)).toEqual(Option.some(30))
        }),
        press('KeyQ'),
        Story.model(({ seats: [{ player }] }) => {
          expect(Arsenal.isAnyOf(['HoldingFirst'])(player.arsenal)).toBe(true)
          expect(pistolOf(player).loaded).toBe(3)
          expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
        }),
      ),
  )
})

describe('the idle reload below Hard', () => {
  const IDLE_TICKS = countdownTicks(IDLE_RELOAD_MS)

  const on = (base: Model, chosen: Difficulty): Model =>
    modifyFields(base, {
      difficulty: difficulty =>
        modifyFields(difficulty, { chosen: () => chosen }),
    })

  const isReloadingNow = ({ seats: [{ player }] }: Model) =>
    Reload.isAnyOf(['Reloading'])(player.reload)

  it.effect(
    'on Easy and Normal a part-empty gun reloads once the trigger rests',
    () =>
      Effect.forEach(['Easy', 'Normal'] as const, chosen =>
        Story.story(
          APPLICATION,
          Story.given(on(withPistolLoaded(fighting, 3), chosen)),
          ...ticks(IDLE_TICKS - 1, FRAME_MS),
          Story.model(current => {
            expect(isReloadingNow(current)).toBe(false)
          }),
          tick(FRAME_MS),
          Story.model(current => {
            expect(tagsOf(current.frameEvents)).toContain('ReloadStarted')
            expect(tagsOf(current.frameEvents)).not.toContain('DryFired')
            expect(reloadingMs(focusOf(current).player.reload)).toEqual(
              Option.some(PISTOL_RELOAD_MS),
            )
          }),
          ...ticks(PISTOL_RELOAD_TICKS, FRAME_MS),
          Story.model(({ seats: [{ player }] }) => {
            expect(pistolOf(player).loaded).toBe(PISTOL_MAGAZINE)
            expect(Reload.isAnyOf(['Ready'])(player.reload)).toBe(true)
          }),
        ),
      ),
  )

  it.effect('on Hard and Nightmare a part-empty gun waits for R', () =>
    Effect.forEach(['Hard', 'Nightmare'] as const, chosen =>
      Story.story(
        APPLICATION,
        Story.given(on(withPistolLoaded(fighting, 3), chosen)),
        ...ticks(IDLE_TICKS * 3, FRAME_MS),
        Story.model(current => {
          expect(isReloadingNow(current)).toBe(false)
          expect(pistolOf(focusOf(current).player).loaded).toBe(3)
        }),
      ),
    ),
  )

  it.effect(
    'the rest starts when the trigger lets go, not while it fires',
    () =>
      Story.story(
        APPLICATION,
        Story.given(withPistolLoaded(fighting, PISTOL_MAGAZINE)),
        holdFire,
        ...ticks(IDLE_TICKS * 2, FRAME_MS),
        Story.model(current => {
          expect(current.stats.shotsFired).toBeGreaterThan(1)
          expect(pistolOf(focusOf(current).player).loaded).toBeGreaterThan(0)
          expect(isReloadingNow(current)).toBe(false)
        }),
        releaseFire,
        ...ticks(IDLE_TICKS - 1, FRAME_MS),
        Story.model(current => {
          expect(isReloadingNow(current)).toBe(false)
        }),
        tick(FRAME_MS),
        Story.model(current => {
          expect(isReloadingNow(current)).toBe(true)
        }),
      ),
  )

  it.effect('a full magazine stays put', () =>
    Effect.gen(function* () {
      const fullSmg = withArsenal(
        fighting,
        holdingSecond(smg(WEAPONS.Smg.magazine)),
      )
      yield* Effect.forEach([fighting, fullSmg], start =>
        Story.story(
          APPLICATION,
          Story.given(start),
          ...ticks(IDLE_TICKS * 2, FRAME_MS),
          Story.model(current => {
            expect(isReloadingNow(current)).toBe(false)
          }),
        ),
      )
    }),
  )

  it.effect('the knife in hand keeps the rest from counting', () =>
    Story.story(
      APPLICATION,
      Story.given(withPistolLoaded(fighting, 3)),
      press('KeyF'),
      release('KeyF'),
      ...ticks(IDLE_TICKS * 2, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.wield).toBe('Melee')
        expect(isReloadingNow(current)).toBe(false)
      }),
      press('KeyQ'),
      release('KeyQ'),
      ...ticks(IDLE_TICKS - 1, FRAME_MS),
      Story.model(current => {
        expect(focusOf(current).player.wield).toBe('Gun')
        expect(isReloadingNow(current)).toBe(false)
      }),
      tick(FRAME_MS),
      Story.model(current => {
        expect(isReloadingNow(current)).toBe(true)
      }),
    ),
  )

  it.effect('a gun swapped into hand waits its own full rest', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withPistolLoaded(withArsenal(fighting, holdingSecond(smg(30))), 3),
      ),
      ...ticks(IDLE_TICKS * 2, FRAME_MS),
      press('KeyQ'),
      release('KeyQ'),
      ...ticks(IDLE_TICKS - 1, FRAME_MS),
      Story.model(current => {
        expect(
          Arsenal.isAnyOf(['HoldingFirst'])(focusOf(current).player.arsenal),
        ).toBe(true)
        expect(isReloadingNow(current)).toBe(false)
      }),
      tick(FRAME_MS),
      Story.model(current => {
        expect(isReloadingNow(current)).toBe(true)
      }),
    ),
  )
})
