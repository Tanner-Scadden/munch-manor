import { Array, Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { FIXED_STEP_MS, RESTART_GRACE_MS } from './constants'
import { update } from './main'
import { Message } from './message'
import {
  DifficultyCard,
  Frenzy,
  type Model,
  Phase,
  type Zombie,
  ZombieAction,
  type ZombieKind,
  ZombieState,
  initialModel,
} from './model'
import { DISTANT_SPAWN } from './model.fixture'
import {
  hintIcons,
  hintWords,
  isStartWaveBeckoning,
  shownGhostSticks,
  shownHints,
} from './onboarding'
import { clientToView } from './screen'
import { accuracyPercent, totalKills } from './stats'
import {
  SHOWN_TICKS,
  SURFACE,
  hintIds,
  holdFire,
  mouseDown,
  press,
  release,
  releaseFire,
  ticks,
  touchDown,
} from './testing'
import { ZOMBIE_KINDS } from './zombies'

const FRAME_MS = FIXED_STEP_MS
const TICK_MS = 50
const MOVE_TICKS = 10
const FIRE_TICKS = 30

const SURFACE_VIEW_X = (clientX: number): number =>
  Option.getOrThrow(clientToView(SURFACE, { x: clientX, y: 200 })).x

const readyModel: Model = modifyFields(initialModel, {
  difficultyCard: () => DifficultyCard.Seen(),
  maybeSurface: () => Option.some(SURFACE),
})

const hintTexts = (current: Model): ReadonlyArray<string> =>
  Array.map(shownHints(current), ({ id }) =>
    [
      ...hintIcons(id, current.lastDevice),
      hintWords(id, current.lastDevice),
    ].join(' '),
  )

describe('input device', () => {
  test('switches between touch and keyboard and mouse with the last input used', () => {
    story(
      update,
      given(readyModel),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      touchDown(3, 100, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
      press('KeyW'),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      touchDown(4, 600, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
      mouseDown(600, 200),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      message(Message.CompletedDetectInputDevice({ touchControls: 'Allowed' })),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('Touch')
      }),
    )
  })

  test('a touch on a screen bigger than a phone acts like the mouse', () => {
    story(
      update,
      given(readyModel),
      message(Message.CompletedDetectInputDevice({ touchControls: 'Blocked' })),
      model(({ lastDevice }) => {
        expect(lastDevice).toBe('KeyboardMouse')
      }),
      message(Message.ClickedCampaignButton()),
      touchDown(3, 100, 200),
      model(({ lastDevice, input }) => {
        expect(lastDevice).toBe('KeyboardMouse')
        expect(input.moveStick._tag).toBe('Idle')
        expect(input.mouseButton._tag).toBe('Held')
        expect(Option.map(input.maybeMouseInView, ({ x }) => x)).toStrictEqual(
          Option.some(SURFACE_VIEW_X(100)),
        )
      }),
      message(
        Message.MovedPointer({ pointerId: 3, clientX: 400, clientY: 200 }),
      ),
      model(({ input }) => {
        expect(input.moveStick._tag).toBe('Idle')
        expect(Option.map(input.maybeMouseInView, ({ x }) => x)).toStrictEqual(
          Option.some(SURFACE_VIEW_X(400)),
        )
      }),
      message(Message.ReleasedPointer({ pointerId: 3 })),
      model(({ input }) => {
        expect(input.mouseButton._tag).toBe('Released')
      }),
    )
  })
})

describe('onboarding hints', () => {
  test('keyboard hints picture the keys and the mouse, then go once each is practised', () => {
    story(
      update,
      given(readyModel),
      press('Enter'),
      release('Enter'),
      model(current => {
        expect(hintIds(current)).toEqual(['Move', 'Fire'])
        expect(hintTexts(current)).toEqual(['Wasd MOVE', 'Mouse AIM + SHOOT'])
      }),
      press('KeyD'),
      ...ticks(MOVE_TICKS, TICK_MS),
      release('KeyD'),
      ...ticks(SHOWN_TICKS, TICK_MS),
      model(current => {
        expect(hintIds(current)).toEqual(['Fire'])
      }),
      message(Message.MovedMouse({ clientX: 700, clientY: 100 })),
      mouseDown(700, 100),
      ...ticks(FIRE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      model(current => {
        expect(hintIds(current)).toEqual([])
        expect(isStartWaveBeckoning(current)).toBe(true)
      }),
      press('Enter'),
      model(current => {
        expect(Phase.guards.Wave(current.phase)).toBe(true)
        expect(hintIds(current)).toEqual([])
        expect(isStartWaveBeckoning(current)).toBe(false)
      }),
    )
  })

  test('on touch the ghost sticks teach moving and shooting, then a tap on START WAVE', () => {
    story(
      update,
      given(readyModel),
      touchDown(1, 700, 200),
      message(Message.ReleasedPointer({ pointerId: 1 })),
      message(Message.ClickedCampaignButton()),
      model(current => {
        expect(current.lastDevice).toBe('Touch')
        expect(shownGhostSticks(current)).toEqual(['Move', 'Aim'])
        expect(hintTexts(current)).toEqual([])
      }),
      touchDown(2, 100, 200),
      message(
        Message.MovedPointer({ pointerId: 2, clientX: 160, clientY: 200 }),
      ),
      ...ticks(MOVE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 2 })),
      ...ticks(SHOWN_TICKS, TICK_MS),
      model(current => {
        expect(shownGhostSticks(current)).toEqual(['Aim'])
        expect(hintTexts(current)).toEqual([])
      }),
      touchDown(3, 700, 200),
      message(
        Message.MovedPointer({ pointerId: 3, clientX: 760, clientY: 200 }),
      ),
      ...ticks(FIRE_TICKS, TICK_MS),
      message(Message.ReleasedPointer({ pointerId: 3 })),
      model(current => {
        expect(hintTexts(current)).toEqual([])
        expect(isStartWaveBeckoning(current)).toBe(true)
      }),
      message(Message.ClickedStartWaveButton()),
      model(current => {
        expect(hintIds(current)).toEqual([])
        expect(isStartWaveBeckoning(current)).toBe(false)
      }),
    )
  })
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

const shootingGallery: Model = modifyFields(readyModel, {
  phase: () => Phase.Wave({ wave: 3, elapsedMs: 0, spawns: [DISTANT_SPAWN] }),
  player: player =>
    modifyFields(player, {
      x: () => 100,
      y: () => 90,
      facing: () => ({ x: 1, y: 0 }),
    }),
  zombies: () => [standing(1, 'Shambler', 130), standing(2, 'Runner', 150)],
  nextEntityId: () => 10,
})

const SHOOTING_TICKS = 110

const shootOut = (record: (finished: Model) => void) =>
  story(
    update,
    given(shootingGallery),
    holdFire,
    ...ticks(SHOOTING_TICKS, FRAME_MS),
    releaseFire,
    model(record),
  )

describe('run stats', () => {
  test('count kills by kind, shots, hits, and game time, the same every time', () => {
    const finishes: Array<Model> = []
    shootOut(finished => {
      finishes.push(finished)
    })
    shootOut(finished => {
      finishes.push(finished)
    })

    const [first, second] = finishes
    expect(first?.stats).toEqual(second?.stats)
    const stats = Option.getOrThrow(Option.fromNullishOr(first)).stats
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
  })

  test('a new run starts the stats over', () => {
    story(
      update,
      given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => RESTART_GRACE_MS,
          stats: stats =>
            modifyFields(stats, { shotsFired: () => 40, runMs: () => 9000 }),
        }),
      ),
      press('Enter'),
      model(({ stats, phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
        expect(stats.shotsFired).toBe(0)
        expect(stats.runMs).toBe(0)
      }),
    )
  })

  test('a quick tap right after dying does not restart the run', () => {
    story(
      update,
      given(
        modifyFields(shootingGallery, {
          phase: () => Phase.GameOver({ wave: 3 }),
        }),
      ),
      press('Enter'),
      model(({ phase }) => {
        expect(phase).toEqual(Phase.GameOver({ wave: 3 }))
      }),
      ...ticks(Math.ceil(RESTART_GRACE_MS / 50), 50),
      press('Enter'),
      model(({ phase }) => {
        expect(Phase.guards.Preparation(phase)).toBe(true)
      }),
    )
  })
})
