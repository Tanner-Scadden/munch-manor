import { Array, Function, Option, Schema } from 'effect'

import {
  FLAME_TUNING,
  type FlameKind,
  type LightsFrame,
  OPEN_FILL,
  flameSpecsOf,
} from '../../src/render/iso/light/lightSpecs'
import {
  type Mood,
  calmMood,
  dreadMood,
  waveMood,
} from '../../src/render/iso/light/mood'
import { type Level, levelFor } from '../../src/world/level/arena'
import {
  ARRANGEMENTS,
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  manorSpecFor,
} from '../../src/world/level/plan'

export const StagePreset = Schema.Literals([
  'Break',
  'Wave',
  'Frenzy',
  'Dread',
  'Candle',
  'Chandelier',
  'Flashlight',
  'Lightning',
])
export type StagePreset = typeof StagePreset.Type

export const PRESET_LABELS: Readonly<Record<StagePreset, string>> = {
  Break: '☕ Break',
  Wave: '🌊 Wave',
  Frenzy: '😡 Frenzy',
  Dread: '🩸 Dread',
  Candle: '🕯️ Candle',
  Chandelier: '💡 Chandelier',
  Flashlight: '🔦 Flashlight',
  Lightning: '⚡ Lightning',
}

type Spot = Readonly<{ x: number; y: number }>

export type StageSetup = Readonly<{
  spot: Spot
  lights: LightsFrame
  viewer: Spot
  facing: Spot
}>

export const stageLevelOf = (house: number): Level =>
  levelFor(
    manorSpecFor(
      Option.getOrElse(Array.get(ARRANGEMENTS, house), () =>
        Array.headNonEmpty(ARRANGEMENTS),
      ),
    ),
    ['West', 'East', 'Far', 'Kitchen'],
  )

const roomMiddleOf = (level: Level, id: string): Spot =>
  Option.match(
    Array.findFirst(level.rooms, room => room.id === id),
    {
      onNone: () => level.start,
      onSome: ({ box }) => ({
        x: Math.round((box.left + box.right) / 2),
        y: Math.round((box.top + box.bottom) / 2),
      }),
    },
  )

const flameSpotOf = (level: Level, kind: FlameKind): Option.Option<Spot> => {
  const middle = roomMiddleOf(level, DINING_ROOM_ID)
  return Array.match(
    Array.filter(flameSpecsOf(level), spec => spec.kind === kind),
    {
      onEmpty: () => Option.none(),
      onNonEmpty: specs =>
        Option.some(
          Array.reduce(specs, specs[0].spot, (best, { spot }) =>
            Math.hypot(spot.x - middle.x, spot.y - middle.y) <
            Math.hypot(best.x - middle.x, best.y - middle.y)
              ? spot
              : best,
          ),
        ),
    },
  )
}

const CANDLE_OFFSET: Spot = { x: 18, y: 8 }
const UNDER_CHANDELIER = 40
const FLASHLIGHT_BACK = 36
const FLAME_REACH = 140

const moodOf = (preset: StagePreset): Mood =>
  preset === 'Wave'
    ? waveMood(0.35)
    : preset === 'Frenzy'
      ? waveMood(1)
      : preset === 'Dread'
        ? dreadMood()
        : preset === 'Lightning'
          ? { ...calmMood(), strike: 1 }
          : calmMood()

const spotOf = (level: Level, preset: StagePreset): Spot => {
  const dining = roomMiddleOf(level, DINING_ROOM_ID)
  return preset === 'Flashlight'
    ? roomMiddleOf(level, CELLAR_ROOM_ID)
    : preset === 'Candle'
      ? Option.match(flameSpotOf(level, 'Candle'), {
          onNone: () => dining,
          onSome: spot => ({
            x: spot.x + CANDLE_OFFSET.x,
            y: spot.y + CANDLE_OFFSET.y,
          }),
        })
      : preset === 'Chandelier'
        ? Option.match(flameSpotOf(level, 'Chandelier'), {
            onNone: () => dining,
            onSome: spot => ({ x: spot.x, y: spot.y + UNDER_CHANDELIER }),
          })
        : dining
}

const isNear = (a: Spot, b: Spot): boolean =>
  Math.hypot(a.x - b.x, a.y - b.y) <= FLAME_REACH

export const stageSetupOf: {
  (preset: StagePreset): (level: Level) => StageSetup
  (level: Level, preset: StagePreset): StageSetup
} = Function.dual(2, (level: Level, preset: StagePreset): StageSetup => {
  const mood = moodOf(preset)
  const isDark = preset === 'Flashlight'
  const spot = spotOf(level, preset)
  return {
    spot,
    viewer: isDark ? { x: spot.x, y: spot.y + FLASHLIGHT_BACK } : spot,
    facing: { x: 0, y: -1 },
    lights: {
      fillShares: Array.map(level.rooms, ({ id, isOpen }) =>
        isOpen && !(isDark && id === CELLAR_ROOM_ID)
          ? OPEN_FILL * mood.fill
          : 0,
      ),
      isDark,
      isInDark: isDark,
      mood,
      flames: Array.map(flameSpecsOf(level), spec => ({
        isShown:
          preset === 'Candle'
            ? spec.kind === 'Candle' && isNear(spec.spot, spot)
            : preset === 'Chandelier'
              ? spec.kind === 'Chandelier'
              : !isDark && spec.kind !== 'Bulb' && isNear(spec.spot, spot),
        x: spec.x,
        intensity: FLAME_TUNING.now[spec.kind].intensity,
      })),
    },
  }
})
