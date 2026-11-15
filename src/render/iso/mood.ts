// The house's mood: how its light follows the run. A break is warm and calm.
// A wave cools toward moonlight as it starts, and dims, cools, and flickers
// harder as its intensity climbs. The hungrier house (the finale, as the
// music hears it) and the boss on the floor turn it red. A
// storm rolls outside the whole run, its lightning striking at moments read
// off the World's clock, oftener as the waves climb.
//
// Everything is read off the World alone, so a replay and every player in a
// co-op room see the same mood and the same strikes.

import { isHouseHungry } from '../../world/dare/finale'
import { Boss, Phase, type World } from '../../world/schema/worldSchema'
import { lerp } from '../../world/step/geometry'

export type Mood = Readonly<{
  // NOTE: a share of each room's own light, 1 in a break.
  fill: number
  // NOTE: a share of the ambient light.
  ambient: number
  // NOTE: the color the rooms' light and the ambient lean toward, and how far.
  tint: number
  tintShare: number
  // NOTE: how hard the flames flicker, 1 in a break.
  flicker: number
  // NOTE: the lightning's flash, 0 to 1.
  strike: number
}>

const MOONLIGHT = 0x9fb4ff
const BLOOD = 0xff5a48

// NOTE: how long the light takes to turn as a wave or a break begins.
const TURN_MS = 3000

const CALM: Mood = {
  fill: 1,
  ambient: 1,
  tint: MOONLIGHT,
  tintShare: 0,
  flicker: 1,
  strike: 0,
}

// NOTE: a wave's mood at full turn, by its intensity (0 to 1).
const waveMood = (intensity: number): Mood => ({
  fill: 0.85 - 0.2 * intensity,
  ambient: 0.85 - 0.25 * intensity,
  tint: MOONLIGHT,
  tintShare: 0.25 + 0.2 * intensity,
  flicker: 1.4 + 0.8 * intensity,
  strike: 0,
})

// NOTE: the hungrier house, or the boss on the floor.
const DREAD: Mood = {
  fill: 0.7,
  ambient: 0.7,
  tint: BLOOD,
  tintShare: 0.4,
  flicker: 2.4,
  strike: 0,
}

// NOTE: one mood eased into another. Only the calm's and a wave's are
// eased, and the calm leans toward no color, so the tint is the one that
// leans further.
const between = (from: Mood, to: Mood, share: number): Mood => ({
  fill: lerp(from.fill, to.fill, share),
  ambient: lerp(from.ambient, to.ambient, share),
  tint: to.tintShare >= from.tintShare ? to.tint : from.tint,
  tintShare: lerp(from.tintShare, to.tintShare, share),
  flicker: lerp(from.flicker, to.flicker, share),
  strike: 0,
})

const turned = (elapsedMs: number): number =>
  Math.min(1, Math.max(0, elapsedMs / TURN_MS))

const isDreadful = (world: World): boolean =>
  isHouseHungry(world) || Boss.isAnyOf(['Arriving', 'Fighting'])(world.boss)

// NOTE: the mood before the storm: the round's, eased in as it turns.
const roundMood = (world: World): Mood => {
  if (isDreadful(world)) {
    return DREAD
  }
  const wave = waveMood(world.intensity)
  return Phase.matchOrElse(
    world.phase,
    {
      Wave: ({ elapsedMs }) => between(CALM, wave, turned(elapsedMs)),
      Preparation: ({ remainingMs, durationMs }) =>
        between(wave, CALM, turned(durationMs - remainingMs)),
      Paused: ({ round }) => (round._tag === 'Wave' ? wave : CALM),
    },
    () => CALM,
  )
}

// NOTE: a color leaned toward another, channel by channel, as 0xRRGGBB.
export const mixColor = ({
  from,
  to,
  share,
}: Readonly<{ from: number; to: number; share: number }>): number => {
  const channel = (shift: number): number =>
    Math.round(lerp((from >> shift) & 0xff, (to >> shift) & 0xff, share)) <<
    shift
  return channel(16) | channel(8) | channel(0)
}

// LIGHTNING

// NOTE: the storm's beat: one strike in each window, at a spot in it rolled
// from the window's number, the window shortening as the waves climb.
const windowMsOf = (wave: number): number =>
  Math.max(11_000, 26_000 - wave * 1500)

const STRIKE_MS = 900

// NOTE: a number from 0 to 1 for a whole number, the same on every engine
// (Math.sin is not, so this is an integer hash).
export const unitOf = (n: number): number => {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// NOTE: the flash's shape: a bright flick, a dip, a second flick, a fade.
const flashAt = (sinceMs: number): number => {
  if (sinceMs < 0 || sinceMs >= STRIKE_MS) {
    return 0
  }
  if (sinceMs < 70) {
    return 1
  }
  if (sinceMs < 140) {
    return 0.2
  }
  if (sinceMs < 220) {
    return 0.75
  }
  return 0.75 * (1 - (sinceMs - 220) / (STRIKE_MS - 220)) ** 2
}

// NOTE: the World's clock at which a window's strike begins.
const strikeStartIn = (window: number, windowMs: number): number =>
  window * windowMs + unitOf(window) * (windowMs - STRIKE_MS)

// NOTE: the World's clock at a strike's brightest, in a wave's first
// window but one, for the tools that stage one (Munch Studio's live rooms).
export const strikeClockOf = (wave: number): number =>
  strikeStartIn(1, windowMsOf(wave)) + 10

// NOTE: how bright the lightning is now, 0 to 1. Only in a round: the
// intro and the end card keep their own light.
export const strikeOf = (world: World): number => {
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)) {
    return 0
  }
  const windowMs = windowMsOf(world.phase.wave)
  const window = Math.floor(world.elapsedMs / windowMs)
  return flashAt(world.elapsedMs - strikeStartIn(window, windowMs))
}

// NOTE: whether a strike began between two readings of the World's clock,
// for the thunder.
export const didStrikeBetween = ({
  world,
  previousMs,
}: Readonly<{ world: World; previousMs: number }>): boolean => {
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)) {
    return false
  }
  const windowMs = windowMsOf(world.phase.wave)
  const start = strikeStartIn(Math.floor(world.elapsedMs / windowMs), windowMs)
  return previousMs < start && start <= world.elapsedMs
}

export const moodOf = (world: World): Mood => ({
  ...roundMood(world),
  strike: strikeOf(world),
})
