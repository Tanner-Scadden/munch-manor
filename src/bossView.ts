import { Array, Option, String } from 'effect'
import { Canvas } from 'foldkit'

import { type Level, findStrike, levelOf } from './arena'
import { BOSS_RULES, type BossBar, isEnraged, maybeStandingBoss } from './boss'
import { VIEW_WIDTH } from './constants'
import { FULL_TURN, HEALTH_BAR_BACK_COLOR } from './drawing'
import { bakeText, placeBaked } from './font'
import { clamp } from './geometry'
import {
  Boss,
  BossMove,
  Glob,
  type HintBand,
  type Model,
  type Vector,
  type Zombie,
} from './model'
import { group } from './sprite'
import { BOSS_ICON } from './sprites/zombies'
import { ZOMBIE_KINDS } from './zombies'

// STOMP RING

const RING_FILL_FAINT = 0.12
const RING_FILL_STRONG = 0.34
const RING_EDGE_COLOR = '#ff4a4f'
const RING_SWEEP_COLOR = '#ffe066'

const alphaOf = (faint: number, strong: number, progress: number): number =>
  Math.round((faint + (strong - faint) * progress) * 100) / 100

const ringFill = (progress: number): string =>
  `rgba(255, 58, 63, ${alphaOf(RING_FILL_FAINT, RING_FILL_STRONG, progress)})`

const progressOf = (remainingMs: number, durationMs: number): number =>
  clamp(1 - remainingMs / Math.max(1, durationMs), 0, 1)

const stompRingShapes = (
  boss: Zombie,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const x = Math.round(boss.x)
  const y = Math.round(boss.y)
  return [
    Canvas.Circle({
      x,
      y,
      radius: BOSS_RULES.stompRadius,
      fill: ringFill(progress),
    }),
    Canvas.Circle({
      x,
      y,
      radius: BOSS_RULES.stompRadius,
      stroke: RING_EDGE_COLOR,
      lineWidth: 1,
    }),
    Canvas.Circle({
      x,
      y,
      radius: Math.max(1, Math.round(BOSS_RULES.stompRadius * progress)),
      stroke: RING_SWEEP_COLOR,
      lineWidth: 2,
    }),
  ]
}

// CHARGE LANE

const LANE_HALF_WIDTH = 12
const BOSS_WALK_RADIUS = ZOMBIE_KINDS.Boss.radius
const ARROW_LENGTH = 10
const ARROW_HALF_WIDTH = 17

type Lane = Readonly<{ from: Vector; direction: Vector; length: number }>

const along = (lane: Lane, distance: number, side: number): Vector => ({
  x: lane.from.x + lane.direction.x * distance - lane.direction.y * side,
  y: lane.from.y + lane.direction.y * distance + lane.direction.x * side,
})

const quad = (
  lane: Lane,
  start: number,
  end: number,
  halfWidth: number,
): ReadonlyArray<Canvas.PathInstruction> => {
  const corners = [
    along(lane, start, -halfWidth),
    along(lane, end, -halfWidth),
    along(lane, end, halfWidth),
    along(lane, start, halfWidth),
  ]
  return [
    ...Array.map(corners, (corner, index) =>
      index === 0
        ? Canvas.MoveTo({ x: corner.x, y: corner.y })
        : Canvas.LineTo({ x: corner.x, y: corner.y }),
    ),
    Canvas.Close(),
  ]
}

const arrowHead = (lane: Lane): ReadonlyArray<Canvas.PathInstruction> => {
  const base = lane.length - ARROW_LENGTH
  const tip = along(lane, lane.length, 0)
  const left = along(lane, base, -ARROW_HALF_WIDTH)
  const right = along(lane, base, ARROW_HALF_WIDTH)
  return [
    Canvas.MoveTo({ x: left.x, y: left.y }),
    Canvas.LineTo({ x: tip.x, y: tip.y }),
    Canvas.LineTo({ x: right.x, y: right.y }),
    Canvas.Close(),
  ]
}

const laneFill = (progress: number): string =>
  `rgba(255, 58, 63, ${alphaOf(0.14, 0.32, progress)})`

const chargeLaneShapes = (
  lane: Lane,
  progress: number,
): ReadonlyArray<Canvas.Shape> => {
  const shaft = Math.max(0, lane.length - ARROW_LENGTH)
  return [
    Canvas.Path({
      instructions: quad(lane, 0, shaft, LANE_HALF_WIDTH),
      fill: laneFill(progress),
      stroke: RING_EDGE_COLOR,
      lineWidth: 1,
    }),
    Canvas.Path({
      instructions: quad(lane, 0, shaft * progress, LANE_HALF_WIDTH - 3),
      fill: 'rgba(255, 224, 102, 0.45)',
    }),
    Canvas.Path({
      instructions: arrowHead(lane),
      fill: progress > 0.5 ? RING_EDGE_COLOR : laneFill(1),
      stroke: RING_EDGE_COLOR,
      lineWidth: 1,
    }),
  ]
}

// NOTE: the lane stops where he would slam into a wall or a crate, so the
// arrow shows where he will stop.
const clippedLane = (
  level: Level,
  from: Vector,
  direction: Vector,
  length: number,
): Lane => {
  const end = {
    x: from.x + direction.x * length,
    y: from.y + direction.y * length,
  }
  return {
    from,
    direction,
    length: Option.match(findStrike(level, from, end), {
      onNone: () => length,
      onSome: strike =>
        Math.max(
          0,
          Math.hypot(strike.x - from.x, strike.y - from.y) - BOSS_WALK_RADIUS,
        ),
    }),
  }
}

const bracingLane = (level: Level, boss: Zombie, target: Vector): Lane => {
  const length = Math.hypot(target.x - boss.x, target.y - boss.y)
  return clippedLane(
    level,
    { x: boss.x, y: boss.y },
    length > 0
      ? { x: (target.x - boss.x) / length, y: (target.y - boss.y) / length }
      : { x: 1, y: 0 },
    length + BOSS_RULES.chargeOvershootPx,
  )
}

// GLOBS

const GLOB_EDGE = '#b6f24a'
const GLOB_FILL = '#6fbf3a'
const GLOB_SHINE = '#d9ff8a'
const PUDDLE_ALPHA = 0.6
const PUDDLE_SHINE_ALPHA = 0.7
const PUDDLE_FADE_MS = 600
const GLOB_PEAK_PX = 30
const GLOB_RADIUS = 4
const MOUTH_ABOVE_PX = 8

const markerFill = (progress: number): string =>
  `rgba(150, 230, 70, ${alphaOf(0.1, 0.35, progress)})`

const globPoint = (from: Vector, to: Vector, progress: number): Vector => ({
  x: from.x + (to.x - from.x) * progress,
  y: from.y + (to.y - from.y) * progress,
})

const globGroundShapes = (glob: Glob): ReadonlyArray<Canvas.Shape> =>
  Glob.match(glob, {
    Flying: ({ from, to, remainingMs, durationMs }) => {
      const progress = progressOf(remainingMs, durationMs)
      const x = Math.round(to.x)
      const y = Math.round(to.y)
      const shadow = globPoint(from, to, progress)
      return [
        Canvas.Circle({
          x,
          y,
          radius: BOSS_RULES.spitRadius,
          fill: markerFill(progress),
          stroke: GLOB_EDGE,
          lineWidth: 1,
        }),
        Canvas.Circle({
          x,
          y,
          radius: Math.max(1, Math.round(BOSS_RULES.spitRadius * progress)),
          stroke: RING_SWEEP_COLOR,
          lineWidth: 2,
        }),
        Canvas.Circle({
          x: Math.round(shadow.x),
          y: Math.round(shadow.y),
          radius: 2,
          fill: 'rgba(0, 0, 0, 0.35)',
        }),
      ]
    },
    Pooled: ({ at, remainingMs }) => {
      const fade = clamp(remainingMs / PUDDLE_FADE_MS, 0, 1)
      const x = Math.round(at.x)
      const y = Math.round(at.y)
      const radius = BOSS_RULES.puddleRadius
      const goo = `rgba(84, 150, 44, ${alphaOf(0, PUDDLE_ALPHA, fade)})`
      return [
        Canvas.Circle({ x, y, radius: radius - 1, fill: goo }),
        Canvas.Circle({
          x: x + Math.round(radius * 0.6),
          y: y + 2,
          radius: Math.round(radius * 0.5),
          fill: goo,
        }),
        Canvas.Circle({
          x: x - Math.round(radius * 0.55),
          y: y + 3,
          radius: Math.round(radius * 0.45),
          fill: goo,
        }),
        Canvas.Rect({
          x: x - 4,
          y: y - 4,
          width: 3,
          height: 2,
          fill: `rgba(200, 245, 130, ${alphaOf(0, PUDDLE_SHINE_ALPHA, fade)})`,
        }),
      ]
    },
  })

const flyingGlobShapes = (glob: Glob): ReadonlyArray<Canvas.Shape> => {
  if (!Glob.isAnyOf(['Flying'])(glob)) {
    return []
  }

  const progress = progressOf(glob.remainingMs, glob.durationMs)
  const point = globPoint(glob.from, glob.to, progress)
  const lift = 4 * GLOB_PEAK_PX * progress * (1 - progress)
  const x = Math.round(point.x)
  const y = Math.round(point.y - lift - MOUTH_ABOVE_PX * (1 - progress))
  return [
    Canvas.Circle({ x, y, radius: GLOB_RADIUS, fill: GLOB_FILL }),
    Canvas.Rect({ x: x - 1, y: y - 2, width: 1, height: 1, fill: GLOB_SHINE }),
  ]
}

// GROUND

const moveGroundShapes = (
  level: Level,
  move: BossMove,
  boss: Zombie,
): ReadonlyArray<Canvas.Shape> =>
  BossMove.match(move, {
    Stalking: () => [],
    Recovering: () => [],
    Dazed: () => [],
    WindingUp: ({ attack, remainingMs, durationMs }) =>
      attack === 'Stomp'
        ? stompRingShapes(boss, progressOf(remainingMs, durationMs))
        : [],
    Bracing: ({ target, remainingMs, durationMs }) =>
      chargeLaneShapes(
        bracingLane(level, boss, target),
        progressOf(remainingMs, durationMs),
      ),
    Rushing: ({ direction, remainingPx }) =>
      chargeLaneShapes(
        clippedLane(level, { x: boss.x, y: boss.y }, direction, remainingPx),
        1,
      ),
  })

export const bossGroundShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Boss.isAnyOf(['Fighting'])(model.boss)
    ? [
        ...Array.flatMap(model.boss.globs, globGroundShapes),
        ...Option.match(maybeStandingBoss(model), {
          onNone: () => [],
          onSome: boss =>
            Boss.isAnyOf(['Fighting'])(model.boss)
              ? moveGroundShapes(levelOf(model), model.boss.move, boss)
              : [],
        }),
      ]
    : []

// OVERHEAD

const STAR_COLOR = '#ffe066'
const STAR_COUNT = 3
const STAR_ORBIT_MS = 900
const STEAM_COUNT = 3
const STEAM_RISE_PX = 10
const STEAM_CYCLE_MS = 700
const HEAD_ABOVE_PX = 16

const starShapes = (
  boss: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.flatMap(Array.range(0, STAR_COUNT - 1), index => {
    const angle =
      (FULL_TURN * elapsedMs) / STAR_ORBIT_MS + (FULL_TURN * index) / STAR_COUNT
    const x = Math.round(boss.x + Math.cos(angle) * 10)
    const y = Math.round(boss.y - HEAD_ABOVE_PX + Math.sin(angle) * 3)
    return [
      Canvas.Rect({
        x: x - 1,
        y: y - 2,
        width: 3,
        height: 5,
        fill: STAR_COLOR,
      }),
      Canvas.Rect({
        x: x - 2,
        y: y - 1,
        width: 5,
        height: 3,
        fill: STAR_COLOR,
      }),
    ]
  })

const steamShapes = (
  boss: Zombie,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> =>
  Array.makeBy(STEAM_COUNT, index => {
    const phase =
      ((elapsedMs + (index * STEAM_CYCLE_MS) / STEAM_COUNT) % STEAM_CYCLE_MS) /
      STEAM_CYCLE_MS
    const side = index - 1
    return Canvas.Circle({
      x: Math.round(boss.x + side * 5 + side * phase * 3),
      y: Math.round(boss.y - HEAD_ABOVE_PX - phase * STEAM_RISE_PX),
      radius: 1 + Math.round(phase * 2),
      fill: `rgba(244, 241, 222, ${Math.round((1 - phase) * 7) / 10})`,
    })
  })

export const bossOverheadShapes = (
  model: Model,
): ReadonlyArray<Canvas.Shape> =>
  Boss.isAnyOf(['Fighting'])(model.boss)
    ? [
        ...Array.flatMap(model.boss.globs, flyingGlobShapes),
        ...Option.match(maybeStandingBoss(model), {
          onNone: () => [],
          onSome: boss => [
            ...(Boss.isAnyOf(['Fighting'])(model.boss) &&
            BossMove.isAnyOf(['Dazed'])(model.boss.move)
              ? starShapes(boss, model.elapsedMs)
              : []),
            ...(isEnraged(model.boss)
              ? steamShapes(boss, model.elapsedMs)
              : []),
          ],
        }),
      ]
    : []

// HEALTH BAR

const BAR_NAME = bakeText(String.toUpperCase(ZOMBIE_KINDS.Boss.name), 'Defeat')
const ENRAGED = bakeText('ENRAGED', 'Alert')
const BAR_WIDTH = 80
const BAR_HEIGHT = 4
const BAR_GAP = 4
const BAR_FILL = '#ff3b3f'
const BAR_SHINE = '#ff8a8f'
const BAR_RAGE_FILL = '#ff7a1f'
const BAR_EDGE = '#f4f1de'
const RAGE_BLINK_MS = 400

export const bossBarShapes = (
  bar: BossBar,
  centerX: number,
  y: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const label = bar.isEnraged ? ENRAGED : BAR_NAME
  const total = label.width + BAR_GAP + BAR_WIDTH
  const left = Math.round(centerX - total / 2)
  const barLeft = left + label.width + BAR_GAP
  const filled = Math.max(
    bar.hp > 0 ? 1 : 0,
    Math.round((BAR_WIDTH * bar.hp) / Math.max(1, bar.maxHp)),
  )
  const isBlinkOn = Math.floor(elapsedMs / RAGE_BLINK_MS) % 2 === 0
  return [
    placeBaked(label, { x: left, y, align: 'Left' }),
    Canvas.Rect({
      x: barLeft - 1,
      y: y - 1,
      width: BAR_WIDTH + 2,
      height: BAR_HEIGHT + 2,
      fill: BAR_EDGE,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: BAR_WIDTH,
      height: BAR_HEIGHT,
      fill: HEALTH_BAR_BACK_COLOR,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: filled,
      height: BAR_HEIGHT,
      fill: bar.isEnraged && isBlinkOn ? BAR_RAGE_FILL : BAR_FILL,
    }),
    Canvas.Rect({
      x: barLeft,
      y,
      width: filled,
      height: 1,
      fill: BAR_SHINE,
    }),
  ]
}

// ENTRANCE BAND

// NOTE: the top band starts below the hearts, the money, and the round text,
// so it never covers the HUD.
const BAND_TOPS: Readonly<Record<HintBand, number>> = { Top: 31, Bottom: 100 }
const BAND_HEIGHT = 30
const BAND_LIFT = 3
const BAND_FILL = 'rgba(24, 6, 10, 0.82)'
const BAND_EDGE = '#ff4a4f'
const TITLE_SCALE = 2
const ICON_SCALE = 3
const ICON_GAP = 8
const ICON_WIDTH = 7
const TAGLINE_OFFSET = 17
const BAND_FADE_MS = 300
const TITLE = bakeText(String.toUpperCase(ZOMBIE_KINDS.Boss.name), 'Defeat')
const TAGLINE = bakeText(ZOMBIE_KINDS.Boss.tagline, 'Prompt')

const bandOpacity = (remainingMs: number, durationMs: number): number => {
  const shownMs = durationMs - remainingMs
  return (
    Math.round(
      clamp(Math.min(shownMs, remainingMs) / BAND_FADE_MS, 0, 1) * 10,
    ) / 10
  )
}

export const bossBandShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  Boss.isAnyOf(['Arriving'])(model.boss)
    ? entranceBand(
        BAND_TOPS[model.hintBand],
        bandOpacity(model.boss.remainingMs, model.boss.durationMs),
        model.elapsedMs,
      )
    : []

const ICON_HOP_MS = 300

const entranceBand = (
  top: number,
  opacity: number,
  elapsedMs: number,
): ReadonlyArray<Canvas.Shape> => {
  const titleWidth = TITLE.width * TITLE_SCALE
  const iconWidth = ICON_WIDTH * ICON_SCALE
  const groupWidth = iconWidth + ICON_GAP + titleWidth
  const left = Math.round(VIEW_WIDTH / 2 - groupWidth / 2)
  const hop = Math.floor(elapsedMs / ICON_HOP_MS) % 2 === 0 ? 0 : -1
  return [
    group({
      opacity,
      shapes: [
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT,
          width: VIEW_WIDTH,
          height: BAND_HEIGHT,
          fill: BAND_FILL,
        }),
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT - 1,
          width: VIEW_WIDTH,
          height: 1,
          fill: BAND_EDGE,
        }),
        Canvas.Rect({
          x: 0,
          y: top - BAND_LIFT + BAND_HEIGHT,
          width: VIEW_WIDTH,
          height: 1,
          fill: BAND_EDGE,
        }),
        group({
          translate: {
            x: left + Math.round(iconWidth / 2),
            y: top + 6 + hop,
          },
          scale: { x: ICON_SCALE, y: ICON_SCALE },
          shapes: BOSS_ICON,
        }),
        placeBaked(TITLE, {
          x: left + iconWidth + ICON_GAP,
          y: top,
          align: 'Left',
          scale: TITLE_SCALE,
        }),
        placeBaked(TAGLINE, {
          x: left + iconWidth + ICON_GAP + Math.round(titleWidth / 2),
          y: top + TAGLINE_OFFSET,
          align: 'Center',
        }),
      ],
    }),
  ]
}
