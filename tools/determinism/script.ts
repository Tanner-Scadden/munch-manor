// The scripted player: the same input Messages for the same frame of the
// same Model, so two runs fed by it see the same inputs. It moves in a fixed
// pattern, aims straight at the nearest walking zombie every fourth frame,
// holds the trigger, presses Enter through each Preparation, and closes the
// stall if it opens. It uses no trig of its own, so a divergence between
// engines comes from the game, not from the script. God mode refills the
// hearts, so a weak pistol-only player lets the room fill to the alive cap.
//
// It imports only the game, effect, and foldkit: no DOM, no Node, no Bun, so
// it runs the same in Bun, Node, Chrome, and workerd.

import { modifyFields } from 'foldkit/struct'

import { PLAYER_MAX_HP } from '../../src/constants'
import { update } from '../../src/main'
import { Message } from '../../src/message'
import { Lesson, type Model, Phase, initialModel } from '../../src/model'
import { asVeteran } from '../../src/veteran'
import type { ScriptMode, StepPattern } from './request'

export type { ScriptMode, StepPattern } from './request'

const FIXED_STEP_MS = 1000 / 60
const MIXED_STEPS_MS: ReadonlyArray<number> = [
  1000 / 60,
  1000 / 120,
  1000 / 120,
  1000 / 30,
  1000 / 60,
  25,
]

const stepMsOf = (pattern: StepPattern, frame: number): number =>
  pattern === 'Fixed60'
    ? FIXED_STEP_MS
    : (MIXED_STEPS_MS[frame % MIXED_STEPS_MS.length] ?? FIXED_STEP_MS)

// NOTE: the landscape view, measured at its own size (the balance bot
// plays on it too).
export const SURFACE = { left: 0, top: 0, width: 320, height: 180 }

const MOVE_PATTERN: ReadonlyArray<ReadonlyArray<string>> = [
  ['KeyW'],
  ['KeyD'],
  ['KeyS'],
  ['KeyA'],
  ['KeyW', 'KeyD'],
  ['KeyS', 'KeyA'],
]
const MOVE_KEYS: ReadonlyArray<string> = ['KeyW', 'KeyA', 'KeyS', 'KeyD']
const FRAMES_PER_MOVE = 75
const AIM_EVERY_FRAMES = 4

const send = (model: Model, message: Message): Model =>
  update(model, message).model

const tapKey = (model: Model, code: string): Model =>
  send(send(model, Message.PressedKey({ code })), Message.ReleasedKey({ code }))

const holdKeys = (model: Model, wanted: ReadonlyArray<string>): Model => {
  const held = new Set(model.input.pressedKeys)
  const released = MOVE_KEYS.filter(
    key => held.has(key) && !wanted.includes(key),
  )
  const pressed = wanted.filter(key => !held.has(key))
  const afterRelease = released.reduce(
    (current, code) => send(current, Message.ReleasedKey({ code })),
    model,
  )
  return pressed.reduce(
    (current, code) => send(current, Message.PressedKey({ code })),
    afterRelease,
  )
}

type Target = Readonly<{ x: number; y: number; distance: number }>

const nearestZombie = (model: Model): Target | undefined =>
  model.zombies
    .filter(zombie => zombie.state._tag === 'Walking')
    .reduce<Target | undefined>((best, zombie) => {
      const dx = zombie.x - model.player.x
      const dy = zombie.y - model.player.y
      const distance = dx * dx + dy * dy
      return best === undefined || distance < best.distance
        ? { x: zombie.x, y: zombie.y, distance }
        : best
    }, undefined)

// Through Preparation: let go of the trigger, close the stall, and start
// the wave.
const prepareFrame = (model: Model): Model => {
  const still = holdKeys(model, [])
  const released =
    still.input.mouseButton._tag === 'Held'
      ? send(still, Message.ReleasedPointer({ pointerId: 1 }))
      : still
  return released.shop._tag === 'Browsing'
    ? tapKey(released, 'Escape')
    : tapKey(released, 'Enter')
}

// In a wave: walk the pattern, and aim and fire at the nearest zombie.
const fightFrame = (model: Model, frame: number): Model => {
  const moved = holdKeys(
    model,
    MOVE_PATTERN[Math.floor(frame / FRAMES_PER_MOVE) % MOVE_PATTERN.length] ??
      [],
  )
  if (frame % AIM_EVERY_FRAMES !== 0) {
    return moved
  }
  const target = nearestZombie(moved)
  if (target === undefined) {
    return moved
  }
  const aimed = send(
    moved,
    Message.MovedMouse({ clientX: target.x, clientY: target.y }),
  )
  return aimed.input.mouseButton._tag === 'Held'
    ? aimed
    : send(
        aimed,
        Message.PressedPointer({
          pointerId: 1,
          device: 'Mouse',
          clientX: target.x,
          clientY: target.y,
        }),
      )
}

// The input Messages for one frame, sent before the frame ticks.
const driveFrame = (model: Model, frame: number): Model =>
  Phase.matchOrElse(
    model.phase,
    {
      Preparation: () => prepareFrame(model),
      Wave: () => fightFrame(model, frame),
    },
    () => model,
  )

// NOTE: every lesson learned, written out here rather than imported, since
// this harness is copied over an older commit to play it the same way: the
// script plays a save past the tutorial, with no guided first break.
const pastTutorial = (model: Model): Model =>
  modifyFields(model, {
    lessons: lessons =>
      modifyFields(lessons, {
        move: () => Lesson.Learned({ atMs: 0 }),
        fire: () => Lesson.Learned({ atMs: 0 }),
        startWave: () => Lesson.Learned({ atMs: 0 }),
        shop: () => Lesson.Learned({ atMs: 0 }),
        swap: () => Lesson.Learned({ atMs: 0 }),
        pickup: () => Lesson.Learned({ atMs: 0 }),
        timedBreaks: () => Lesson.Learned({ atMs: 0 }),
        openBreak: () => Lesson.Learned({ atMs: 0 }),
      }),
  })

// A returning player's Model, seeded, measured, and started into a run: Enter
// opens the lobby, E picks endless there, and Enter starts.
export const startedRun = (seed: number, mode: ScriptMode): Model => {
  const ready = send(
    modifyFields(pastTutorial(asVeteran(initialModel)), {
      rngState: () => seed,
      difficulty: () => ({ chosen: 'Normal', nightmare: 'Unlocked' }),
    }),
    Message.MeasuredGameSurface(SURFACE),
  )
  const inLobby = tapKey(ready, 'Enter')
  return tapKey(mode === 'Endless' ? tapKey(inLobby, 'KeyE') : inLobby, 'Enter')
}

const godMode = (model: Model): Model =>
  model.player.hp === PLAYER_MAX_HP
    ? model
    : modifyFields(model, {
        player: player => modifyFields(player, { hp: () => PLAYER_MAX_HP }),
      })

export const isPlaying = (model: Model): boolean =>
  model.phase._tag === 'Preparation' || model.phase._tag === 'Wave'

// One whole frame: the script's inputs, then the tick, then god mode.
export const playFrame = (
  model: Model,
  frame: number,
  pattern: StepPattern,
): Model =>
  godMode(
    send(
      driveFrame(model, frame),
      Message.TickedFrame({ deltaTime: stepMsOf(pattern, frame) }),
    ),
  )
