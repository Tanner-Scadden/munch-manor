export const sampleFrames = async (durationSeconds: number) => {
  window.__timings.update.length = 0
  window.__timings.view.length = 0
  window.__timings.viewFrames.length = 0
  window.__timings.tickFrames.length = 0
  const deltas: Array<number> = []
  const start = performance.now()
  let last = start
  await new Promise<void>(resolve => {
    const end = last + durationSeconds * 1000
    const tick = (t: number) => {
      deltas.push(t - last)
      last = t
      if (t < end) {
        requestAnimationFrame(tick)
      } else {
        resolve()
      }
    }
    requestAnimationFrame(tick)
  })
  return {
    deltas,
    elapsedMs: last - start,
    update: [...window.__timings.update],
    view: [...window.__timings.view],
    viewFrames: [...window.__timings.viewFrames],
    tickFrames: [...window.__timings.tickFrames],
    shapes: window.__countShapes(),
  }
}
