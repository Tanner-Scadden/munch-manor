import { Array } from 'effect'
import type { Canvas } from 'foldkit'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { sceneShapes } from '../../../app/layers'
import { Boss, type Model, Phase, RunMode } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { startOrResume } from '../../../app/runFlow'
import { cameraOf } from '../../../render/camera'
import { screenOf } from '../../../render/screen'
import { hudStripShapes } from '../../../screens/game/hud'
import { atClock } from '../../../test/model.fixture'
import { rollSpawns } from '../../../world/waves/endlessWaves'
import { wavePreviewShapes } from '../wavePreview'

// NOTE: Uncle Chunk waiting at his door, the one marker the preview draws.
const CHUNK_WAITING = Boss.Waiting({
  door: 'South',
  waitBelow: 20,
  hp: 300,
  guestHpScale: 1,
})

const preparing = (wave: number, boss: Boss = CHUNK_WAITING): Model => {
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
    boss: () => boss,
  })
}

const shaken = (model: Model): Model =>
  modifyFields(model, {
    shake: () => ({ trauma: 1, offset: { x: 3, y: -3 } }),
  })

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

describe('the wave preview', () => {
  test('says nothing of which door a zombie comes through', () => {
    const plain = preparing(4, Boss.Absent())
    expect(wavePreviewShapes(plain, cameraOf(plain))).toEqual([])
  })

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
    const strip = hudStripShapes(still, screenOf(still), cameraOf(still))
    expect(
      stillOverlay.slice(strip.length, strip.length + preview.length),
    ).toEqual(preview)
  })

  test('holds its letters still: no scaling, only the frame pulses', () => {
    const base = preparing(4)
    const frames = Array.makeBy(15, index =>
      wavePreviewShapes(atClock(base, index * 100), cameraOf(base)),
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
