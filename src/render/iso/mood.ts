import { unitOf } from '../../shared/prng'
import { isHouseHungry } from '../../world/dare/finale'
import { Boss, Phase, type World } from '../../world/schema/worldSchema'
import { lerp } from '../../world/step/geometry'
import { Tunable } from './tunable'

export type Mood = Readonly<{
  fill: number
  ambient: number
  tint: number
  tintShare: number
  flicker: number
  strike: number
}>

const MOONLIGHT = 0x9fb4ff
const BLOOD = 0xff5a48

const TURN_MS = 3000

export type MoodAmbients = Readonly<{
  calm: number
  wave: number
  waveDrop: number
  dread: number
}>

export const MOOD_AMBIENT = new Tunable<MoodAmbients>({
  calm: 1,
  wave: 0.85,
  waveDrop: 0.25,
  dread: 0.7,
})

export const calmMood = (): Mood => ({
  fill: 1,
  ambient: MOOD_AMBIENT.now.calm,
  tint: MOONLIGHT,
  tintShare: 0,
  flicker: 1,
  strike: 0,
})

export const waveMood = (intensity: number): Mood => ({
  fill: 0.85 - 0.2 * intensity,
  ambient: MOOD_AMBIENT.now.wave - MOOD_AMBIENT.now.waveDrop * intensity,
  tint: MOONLIGHT,
  tintShare: 0.25 + 0.2 * intensity,
  flicker: 1.4 + 0.8 * intensity,
  strike: 0,
})

export const dreadMood = (): Mood => ({
  fill: 0.7,
  ambient: MOOD_AMBIENT.now.dread,
  tint: BLOOD,
  tintShare: 0.4,
  flicker: 2.4,
  strike: 0,
})

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

const roundMood = (world: World): Mood => {
  if (isDreadful(world)) {
    return dreadMood()
  }
  const calm = calmMood()
  const wave = waveMood(world.intensity)
  return Phase.matchOrElse(
    world.phase,
    {
      Wave: ({ elapsedMs }) => between(calm, wave, turned(elapsedMs)),
      Preparation: ({ remainingMs, durationMs }) =>
        between(wave, calm, turned(durationMs - remainingMs)),
      Paused: ({ round }) => (round._tag === 'Wave' ? wave : calm),
    },
    () => calm,
  )
}

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

const windowMsOf = (wave: number): number =>
  Math.max(11_000, 26_000 - wave * 1500)

const STRIKE_MS = 900

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

const strikeStartIn = (window: number, windowMs: number): number =>
  window * windowMs + unitOf(window) * (windowMs - STRIKE_MS)

export const strikeClockOf = (wave: number): number =>
  strikeStartIn(1, windowMsOf(wave)) + 10

export const strikeOf = (world: World): number => {
  if (!Phase.isAnyOf(['Preparation', 'Wave'])(world.phase)) {
    return 0
  }
  const windowMs = windowMsOf(world.phase.wave)
  const window = Math.floor(world.elapsedMs / windowMs)
  return flashAt(world.elapsedMs - strikeStartIn(window, windowMs))
}

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
