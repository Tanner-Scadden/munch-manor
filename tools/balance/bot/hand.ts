// The balance bot's human limits: how long it takes to react to a zombie it
// has just picked, how its aim trails a moving target and overshoots before
// it settles, how reluctantly it switches targets, and which zombies it
// notices while it looks down its sights. AIM=sharp plays the old bot,
// which re-aims at every target at once with only a little shake and knows
// where every zombie in the room is.
//
// Decided on 2026-10-31 (the owner: Easy and Normal are too hard, and the
// balance bot has aim bot): the targets are for this bot, which loses
// early waves to Groaners and Hotfoots the way real players do.

import { hasLineOfSight, levelOf } from '../../../src/arena'
import {
  FRAME_MS,
  type Model,
  type Vector,
  distance,
  isInView,
  standing,
  walking,
} from './basics'
import { type BotState, type Zombie } from './state'

export const IS_SHARP = process.env['AIM'] === 'sharp'

// The hand's random stream, seeded per run, so a run replays exactly.
export const nextBotRandom = (state: BotState) => {
  state.botRandom = (state.botRandom * 1103515245 + 12345) >>> 0
  return state.botRandom / 0xffffffff
}

// A shake from -1 to 1, most often near 0.
const shake = (state: BotState) =>
  nextBotRandom(state) + nextBotRandom(state) - 1

// THE HUMAN NUMBERS

const numberFrom = (name: string, fallback: number) =>
  Number(process.env[name] ?? fallback)

// About a third of a second from picking a new target to the first shot.
const REACTION_FRAMES = Math.round(numberFrom('REACTION_MS', 300) / FRAME_MS)
// The steady shake once it has settled on a target, in radians.
const SHAKE_RADIANS = numberFrom('HUMAN_SHAKE', 0.2)
// The first flick at a new target lands up to this far off and settles.
const OVERSHOOT_RADIANS = numberFrom('OVERSHOOT', 0.35)
// How many frames the flick's miss and the aim's lag take to settle by
// about two thirds.
const SETTLE_FRAMES = numberFrom('SETTLE_FRAMES', 12)
// The hand aims where it saw the target this many frames ago, and catches
// up to half of that while it tracks. Fast sideways movers (Hotfoots) are
// missed the most.
const LAG_FRAMES = numberFrom('LAG_FRAMES', 6)
const TRACKED_LAG_SHARE = 0.5
// It switches to a nearer zombie only when that one is much nearer than its
// target, or about to bite.
const SWITCH_RATIO = numberFrom('SWITCH_RATIO', 0.6)
const PANIC_PX = numberFrom('PANIC_PX', 22)
// While it aims it notices a zombie inside a cone around its aim, or one
// close enough to hear. The rest of the room creeps up on it.
const NOTICE_PX = numberFrom('NOTICE_PX', 24)
const NOTICE_RADIANS = numberFrom('NOTICE_DEGREES', 75) * (Math.PI / 180)

// THE TARGET IT HOLDS

const isInSight = (model: Model, zombie: Zombie) =>
  hasLineOfSight(levelOf(model), model.player, zombie)

// Keeps its target while it stands and is in sight, unless the nearest is
// much nearer or about to bite.
export const stickyTarget = (
  state: BotState,
  model: Model,
  candidate: Zombie | undefined,
): Zombie | undefined => {
  if (
    IS_SHARP ||
    candidate === undefined ||
    state.maybeHumanAim === undefined
  ) {
    return candidate
  }
  const { targetId } = state.maybeHumanAim
  const held = walking(model).find(zombie => zombie.id === targetId)
  if (
    held === undefined ||
    held.id === candidate.id ||
    !isInSight(model, held)
  ) {
    return candidate
  }
  const near = distance(model.player, candidate)
  return near < PANIC_PX || near < SWITCH_RATIO * distance(model.player, held)
    ? candidate
    : held
}

export type Sight = Readonly<{ at: Vector; error: number }>

// Where the hand points at target this frame and how far off it is, or
// undefined while it is still reacting to a target it has just picked.
export const humanSight = (
  state: BotState,
  target: Zombie,
  frame: number,
): Sight | undefined => {
  if (IS_SHARP) {
    return { at: target, error: 0 }
  }
  const previous = state.maybeHumanAim
  if (previous === undefined || previous.targetId !== target.id) {
    state.maybeHumanAim = {
      targetId: target.id,
      sinceFrame: frame,
      seenAt: { x: target.x, y: target.y },
      seenFrame: frame,
      velocity: { x: 0, y: 0 },
      bias: shake(state) * OVERSHOOT_RADIANS,
    }
    return REACTION_FRAMES > 0
      ? undefined
      : { at: target, error: state.maybeHumanAim.bias }
  }
  const elapsed = Math.max(1, frame - previous.seenFrame)
  const velocity = {
    x: (target.x - previous.seenAt.x) / elapsed,
    y: (target.y - previous.seenAt.y) / elapsed,
  }
  state.maybeHumanAim = {
    ...previous,
    seenAt: { x: target.x, y: target.y },
    seenFrame: frame,
    velocity,
  }
  const tracked = frame - previous.sinceFrame
  if (tracked < REACTION_FRAMES) {
    return undefined
  }
  const unsettled = Math.exp(-(tracked - REACTION_FRAMES) / SETTLE_FRAMES)
  const lag =
    LAG_FRAMES * (TRACKED_LAG_SHARE + (1 - TRACKED_LAG_SHARE) * unsettled)
  return {
    at: { x: target.x - velocity.x * lag, y: target.y - velocity.y * lag },
    error: previous.bias * unsettled + shake(state) * SHAKE_RADIANS,
  }
}

// WHAT IT NOTICES

// The sharp bot notices every zombie. The human one, once it has aimed,
// notices only those near its aim or within earshot.
export const isNoticed = (
  state: BotState,
  model: Model,
  zombie: Zombie,
): boolean => {
  if (IS_SHARP || state.maybeAimAngle === undefined) {
    return true
  }
  const { player } = model
  if (distance(player, zombie) < NOTICE_PX) {
    return true
  }
  const toward = Math.atan2(zombie.y - player.y, zombie.x - player.x)
  const apart = Math.abs(
    Math.atan2(
      Math.sin(toward - state.maybeAimAngle),
      Math.cos(toward - state.maybeAimAngle),
    ),
  )
  return apart <= NOTICE_RADIANS
}

// What it may flee: the zombies in its view, and any close enough to hear
// even out of a phone's window, where the screen's edge sits nearer than
// earshot behind a leaning camera.
export const withinSenses = (model: Model): ReadonlyArray<Zombie> =>
  standing(model).filter(
    zombie =>
      isInView(model, zombie) || distance(model.player, zombie) < NOTICE_PX,
  )
