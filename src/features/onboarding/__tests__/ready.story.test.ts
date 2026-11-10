import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import {
  Frenzy,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
} from '../../../app/model'
import { clientToView } from '../../../render/screen'
import { FIXED_STEP_MS, RESTART_GRACE_MS } from '../../../shared/constants'
import { DISTANT_SPAWN, newPlayerCardSeen } from '../../../test/model.fixture'
import {
  APPLICATION,
  SHOWN_TICKS,
  SURFACE,
  hintIds,
  holdFire,
  mouseDown,
  press,
  release,
  releaseFire,
  throughIntro,
  throughIntroByTap,
  ticks,
  touchDown,
} from '../../../test/testing'
import { modifyFocus } from '../../../world/party/party'
import { accuracyPercent, totalKills } from '../../../world/run/stats'
import { ZOMBIE_KINDS } from '../../../world/zombies/zombies'
import {
  hintIcons,
  hintWords,
  isStartWaveBeckoning,
  shownGhostSticks,
  shownHints,
} from '../onboarding'

const FRAME_MS = FIXED_STEP_MS
const TICK_MS = 50
const MOVE_TICKS = 10
const FIRE_TICKS = 30

const SURFACE_VIEW_X = (clientX: number): number =>
  Option.getOrThrow(clientToView(SURFACE, { x: clientX, y: 200 })).x

const hintTexts = (current: Model): ReadonlyArray<string> =>
  Array.map(shownHints(current), ({ id }) =>
    Array.join(
      [...hintIcons(id, current.lastDevice), hintWords(id, current.lastDevice)],
      ' ',
    ),
  )

describe('input device', () => {
  it.effect(
    'switches between touch and keyboard and mouse with the last input used',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newPlayerCardSeen),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('KeyboardMouse')
        }),
        touchDown(3, 100, 200),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('Touch')
        }),
        press('KeyW'),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('KeyboardMouse')
        }),
        touchDown(4, 600, 200),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('Touch')
        }),
        mouseDown(600, 200),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('KeyboardMouse')
        }),
        Story.message(
          Message.CompletedDetectInputDevice({ touchControls: 'Allowed' }),
        ),
        Story.model(({ lastDevice }) => {
          expect(lastDevice).toBe('Touch')
        }),
      ),
  )

  it.effect('a touch on a screen bigger than a phone acts like the mouse', () =>
    Story.story(
      APPLICATION,
      Story.given(newPlayerCardSeen),
      Story.message(
        Message.CompletedDetectInputDevice({ touchControls: 'Blocked' }),
      ),
      Story.model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      Story.message(Message.ClickedCampaignButton()),
      throughIntro,
      touchDown(3, 100, 200),
      Story.model(({ lastDevice, input }) => {
        expect(lastDevice).toBe('KeyboardMouse')
        expect(input.moveStick._tag).toBe('Idle')
        expect(input.mouseButton._tag).toBe('Held')
        expect(Option.map(input.maybeMouseInView, ({ x }) => x)).toStrictEqual(
          Option.some(SURFACE_VIEW_X(100)),
        )
      }),
      Story.message(
        Message.MovedPointer({ pointerId: 3, clientX: 400, clientY: 200 }),
      ),
      Story.model(({ input }) => {
        expect(input.moveStick._tag).toBe('Idle')
        expect(Option.map(input.maybeMouseInView, ({ x }) => x)).toStrictEqual(
          Option.some(SURFACE_VIEW_X(400)),
        )
      }),
      Story.message(Message.ReleasedPointer({ pointerId: 3 })),
      Story.model(({ input }) => {
        expect(input.mouseButton._tag).toBe('Released')
      }),
    ),
  )
})

describe('onboarding hints', () => {
  it.effect(
    'keyboard hints picture the keys and the mouse, then go once each is practised',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newPlayerCardSeen),
        press('Enter'),
        throughIntro,
        release('Enter'),
        Story.model(current => {
          expect(hintIds(current)).toEqual(['Move', 'Fire'])
          expect(hintTexts(current)).toEqual(['Wasd MOVE', 'Mouse AIM + SHOOT'])
        }),
        press('KeyD'),
        ...ticks(MOVE_TICKS, TICK_MS),
        release('KeyD'),
        ...ticks(SHOWN_TICKS, TICK_MS),
        Story.model(current => {
          expect(hintIds(current)).toEqual(['Fire'])
        }),
        Story.message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
        mouseDown(700, 100),
        ...ticks(FIRE_TICKS, TICK_MS),
        Story.message(Message.ReleasedPointer({ pointerId: 1 })),
        Story.model(current => {
          expect(hintIds(current)).toEqual([])
          expect(isStartWaveBeckoning(current)).toBe(true)
        }),
        press('Enter'),
        Story.model(current => {
          expect(Phase.guards.Wave(current.phase)).toBe(true)
          expect(hintIds(current)).toEqual([])
          expect(isStartWaveBeckoning(current)).toBe(false)
        }),
      ),
  )

  it.effect(
    'on touch the ghost sticks teach moving and shooting, then a tap on START WAVE',
    () =>
      Story.story(
        APPLICATION,
        Story.given(newPlayerCardSeen),
        touchDown(1, 700, 200),
        Story.message(Message.ReleasedPointer({ pointerId: 1 })),
        Story.message(Message.ClickedCampaignButton()),
        throughIntroByTap,
        Story.model(current => {
          expect(current.lastDevice).toBe('Touch')
          expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
          expect(hintTexts(current)).toEqual([])
        }),
        touchDown(2, 100, 200),
        Story.message(
          Message.MovedPointer({ pointerId: 2, clientX: 160, clientY: 200 }),
        ),
        ...ticks(MOVE_TICKS, TICK_MS),
        Story.message(Message.ReleasedPointer({ pointerId: 2 })),
        ...ticks(SHOWN_TICKS, TICK_MS),
        Story.model(current => {
          expect(shownGhostSticks(current)).toEqual(['Aim'])
          expect(hintTexts(current)).toEqual([])
        }),
        touchDown(3, 700, 200),
        Story.message(
          Message.MovedPointer({ pointerId: 3, clientX: 760, clientY: 200 }),
        ),
        ...ticks(FIRE_TICKS, TICK_MS),
        Story.message(Message.ReleasedPointer({ pointerId: 3 })),
        Story.model(current => {
          expect(hintTexts(current)).toEqual([])
          expect(isStartWaveBeckoning(current)).toBe(true)
        }),
        Story.message(Message.ClickedStartWaveButton()),
        Story.model(current => {
          expect(hintIds(current)).toEqual([])
          expect(isStartWaveBeckoning(current)).toBe(false)
        }),
      ),
  )
})

const standing = (id: number, kind: ZombieKind, x: number): Zombie => ({
  id,
  kind,
  x,
  y: 90,
  speed: 0,
  hp: ZOMBIE_KINDS[kind].hp,
  maxHp: ZOMBIE_KINDS[kind].hp,
  knockback: { x: 0, y: 0 },
  hitRemainingMs: 0,
  state: ZombieState.Walking(),
  action: ZombieAction.Roaming(),
  frenzy: Frenzy.Calm(),
})

const shootingGallery: Model = modifyFocus(
  modifyFields(newPlayerCardSeen, {
    phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
    zombies: () => [standing(1, 'Shambler', 130), standing(2, 'Runner', 150)],
    nextEntityId: () => 10,
  }),
  {
    player: player =>
      modifyFields(player, {
        x: () => 100,
        y: () => 90,
        facing: () => ({ x: 1, y: 0 }),
      }),
  },
)

const SHOOTING_TICKS = 110

// NOTE: the run's stats after the shooting gallery is shot out.
const shootOut = Story.story(
  APPLICATION,
  Story.given(shootingGallery),
  holdFire,
  ...ticks(SHOOTING_TICKS, FRAME_MS),
  releaseFire,
).pipe(Effect.map(({ stats }) => stats))

describe('run stats', () => {
  it.effect(
    'count kills by kind, shots, hits, and game time, the same every time',
    () =>
      Effect.gen(function* () {
        const stats = yield* shootOut
        const again = yield* shootOut
        expect(again).toEqual(stats)
        expect(stats.kills).toEqual({
          Shambler: 1,
          Runner: 1,
          Tank: 0,
          Exploder: 0,
          Thrower: 0,
          Crawler: 0,
          Boss: 0,
        })
        expect(totalKills(stats)).toBe(2)
        expect(stats.shotsHit).toBe(
          ZOMBIE_KINDS.Shambler.hp + ZOMBIE_KINDS.Runner.hp,
        )
        expect(stats.shotsFired).toBeGreaterThan(stats.shotsHit)
        expect(accuracyPercent(stats)).toBe(
          Math.round((100 * stats.shotsHit) / stats.shotsFired),
        )
        expect(stats.runMs).toBeCloseTo(SHOOTING_TICKS * FRAME_MS, 9)
        expect(stats.heartsLost).toBe(0)
      }),
  )

  it.effect('a new run starts the stats over', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
          stats: stats =>
            modifyFields(stats, { shotsFired: () => 40, runMs: () => 9000 }),
        }),
      ),
      press('Enter'),
      throughIntro,
      Story.model(({ stats, phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.shotsFired).toBe(0)
        expect(stats.runMs).toBe(0)
      }),
    ),
  )

  it.effect('a quick tap right after dying does not restart the run', () =>
    Story.story(
      APPLICATION,
      Story.given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
        }),
      ),
      press('Enter'),
      Story.model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 3 }))
      }),
      ...ticks(Math.ceil(RESTART_GRACE_MS / 50), 50),
      press('Enter'),
      throughIntro,
      Story.model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    ),
  )
})
