// The camera's big moments: as a wave's last zombie falls, as the boss
// comes through his door, and as Uncle Chunk's key flies to the front
// door, the camera glides partway toward the moment and back, and thin
// letterbox bars slide in over the world. There is no zoom: the camera
// still lands on whole pixels, so the art stays crisp (owner, 2026-11-14).
// The boss's and the key's moments are read off the World, so a co-op crew
// sees them together; the wave's is the client's own (`Finisher`).

import { Option } from 'effect'
import type { Canvas } from 'foldkit'

import type { Model } from '../app/model'
import { Finale } from '../world/dare/dareSchema'
import { levelOf } from '../world/level/arena'
import type { Vector } from '../world/schema/entitySchema'
import { Boss } from '../world/schema/worldSchema'
import { clamp, smoothStep } from '../world/step/geometry'
import { rect } from './drawing'
import type { Box } from './screen'

// NOTE: how long the glide to a wave's last blow lasts, on the display's
// clock.
export const FINISHER_CINE_MS = 1100

// NOTE: the share of a moment the glide spends easing in, and easing out.
const EASE_SHARE = 0.3

type Cine = Readonly<{ spot: Vector; weight: number }>

// NOTE: 0 at a moment's start and end, 1 through its middle, eased.
export const cineWeightOf = (progress: number): number => {
  const share = clamp(progress, 0, 1)
  return smoothStep(Math.min(1, share / EASE_SHARE, (1 - share) / EASE_SHARE))
}

const progressOf = (remainingMs: number, durationMs: number): number =>
  durationMs <= 0 ? 1 : 1 - remainingMs / durationMs

// NOTE: the moment on now, the latest one first: the key's flight, then
// the boss at his door, then the wave's last blow.
const cineOf = (model: Model): Option.Option<Cine> => {
  const level = levelOf(model)
  const finisher = (): Option.Option<Cine> =>
    Option.map(model.maybeFinisher, ({ x, y, ageMs }) => ({
      spot: { x, y },
      weight: cineWeightOf(ageMs / FINISHER_CINE_MS),
    }))
  const bossOrFinisher = (): Option.Option<Cine> =>
    Boss.matchOrElse(
      model.boss,
      {
        Arriving: ({ door, remainingMs, durationMs }): Option.Option<Cine> =>
          Option.some({
            spot: level.doors[door].center,
            weight: cineWeightOf(progressOf(remainingMs, durationMs)),
          }),
      },
      finisher,
    )
  return Finale.matchOrElse(
    model.dare.finale,
    {
      KeyFlying: ({ remainingMs, durationMs }): Option.Option<Cine> =>
        Option.some({
          spot: level.doors.Front.center,
          weight: cineWeightOf(progressOf(remainingMs, durationMs)),
        }),
    },
    bossOrFinisher,
  )
}

// NOTE: how close to the window's edge the glide may bring the player, in
// world pixels, so the moment never takes them out of sight.
const KEEP_IN_VIEW_PX = 48

// NOTE: the camera's focus, glided toward the moment by its weight, at most
// so far that the player stays in the window.
export const glideFocus = (
  input: Readonly<{
    model: Model
    focus: Vector
    window: Readonly<{ width: number; height: number }>
  }>,
): Vector => {
  const { model, focus, window } = input
  return Option.match(cineOf(model), {
    onNone: () => focus,
    onSome: ({ spot, weight }) => {
      const reachX = Math.max(0, window.width / 2 - KEEP_IN_VIEW_PX)
      const reachY = Math.max(0, window.height / 2 - KEEP_IN_VIEW_PX)
      return {
        x: focus.x + clamp(spot.x - focus.x, -reachX, reachX) * weight,
        y: focus.y + clamp(spot.y - focus.y, -reachY, reachY) * weight,
      }
    },
  })
}

// BARS

// NOTE: the bars' height at full weight, in screen pixels, and their ink.
const BAR_PX = 14
const BAR_FILL = '#07060a'

// NOTE: the letterbox bars over the top and bottom of the world window,
// sliding in with the moment's weight.
export const cineBarShapes = (
  input: Readonly<{ model: Model; world: Box }>,
): ReadonlyArray<Canvas.Shape> => {
  const { model, world } = input
  return Option.match(cineOf(model), {
    onNone: () => [],
    onSome: ({ weight }) => {
      const height = Math.round(BAR_PX * weight)
      return height <= 0
        ? []
        : [
            rect(world.x, world.y, world.width, height, BAR_FILL),
            rect(
              world.x,
              world.y + world.height - height,
              world.width,
              height,
              BAR_FILL,
            ),
          ]
    },
  })
}
