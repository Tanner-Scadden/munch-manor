import { Array } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { cameraOf } from './camera'
import { rollSpawns } from './endlessWaves'
import { hudStripShapes } from './hud'
import { sceneShapes } from './layers'
import { type Model, Phase, RunMode, initialModel } from './model'
import { startOrResume } from './runFlow'
import { screenOf } from './screen'
import { wavePreviewShapes } from './wavePreview'

const preparing = (wave: number): Model => {
  const started = startOrResume(initialModel, RunMode.Campaign())
  const [rngState, spawns] = rollSpawns(started.rngState, wave)
  return modifyFields(started, {
    rngState: () => rngState,
    phase: () =>
      Phase.Preparation({
        wave,
        remainingMs: 15_000,
        durationMs: 20_000,
        spawns,
      }),
  })
}

const shaken = (model: Model): Model =>
  modifyFields(model, {
    shake: () => ({ trauma: 1, offset: { x: 3, y: -3 } }),
  })

const atTime = (model: Model, elapsedMs: number): Model =>
  modifyFields(model, { elapsedMs: () => elapsedMs })

const withoutOpacity = (shape: Canvas.Shape): Canvas.Shape =>
  shape._tag === 'Group'
    ? modifyFields(shape, {
        opacity: () => undefined,
        shapes: shapes => Array.map(shapes, withoutOpacity),
      })
    : shape

const isScaled = (shape: Canvas.Shape): boolean =>
  shape._tag === 'Group' &&
  (shape.scale !== undefined || Array.some(shape.shapes, isScaled))

describe('Door preview', () => {
  test('sits on the overlay, so a screen shake never moves it', () => {
    const still = preparing(4)
    const shaking = shaken(still)
    const preview = wavePreviewShapes(still, cameraOf(still))
    expect(preview).not.toEqual([])
    expect(wavePreviewShapes(shaking, cameraOf(shaking))).toEqual(preview)

    const [stillWorld, ...stillOverlay] = sceneShapes(still)
    const [shakingWorld, ...shakingOverlay] = sceneShapes(shaking)
    expect(shakingWorld).not.toEqual(stillWorld)
    expect(shakingOverlay).toEqual(stillOverlay)
    const strip = hudStripShapes(still, screenOf(still))
    expect(
      stillOverlay.slice(strip.length, strip.length + preview.length),
    ).toEqual(preview)
  })

  test('holds its letters still: no scaling, only the frame pulses', () => {
    const base = preparing(4)
    const frames = Array.makeBy(15, index =>
      wavePreviewShapes(atTime(base, index * 100), cameraOf(base)),
    )
    expect(Array.some(Array.flatten(frames), isScaled)).toBe(false)
    const [first, ...rest] = Array.map(frames, frame =>
      Array.map(frame, withoutOpacity),
    )
    Array.forEach(rest, frame => {
      expect(frame).toEqual(first)
    })
  })
})
