export const readButtons = (inset: number) => {
  const stage = document.querySelector('.game-stage')
  if (stage === null) {
    throw new Error('No .game-stage on the page')
  }
  const rect = stage.getBoundingClientRect()
  const model = window.__model
  const buttons: Array<{
    label: string
    x: number
    y: number
    width: number
    height: number
    misses: Array<string>
  }> = []
  for (const button of document.querySelectorAll('button')) {
    const box = button.getBoundingClientRect()
    const style = getComputedStyle(button)
    if (
      !(
        box.width > 0 &&
        style.visibility !== 'hidden' &&
        style.display !== 'none' &&
        button.closest('dialog') === null
      )
    ) {
      continue
    }
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2
    const points = [
      ['center', cx, cy],
      ['left', box.left + inset, cy],
      ['right', box.right - inset, cy],
      ['top', cx, box.top + inset],
      ['bottom', cx, box.bottom - inset],
    ] as const
    const misses: Array<string> = []
    for (const [name, x, y] of points) {
      const hit = document.elementFromPoint(x, y)
      if (hit === null || !button.contains(hit)) {
        misses.push(name)
      }
    }
    buttons.push({
      label: button.getAttribute('aria-label') ?? button.textContent.trim(),
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      misses,
    })
  }
  return {
    stage: { x: rect.x, y: rect.y, scale: rect.width / 320 },
    player: { x: model.seats[0].player.x, y: model.seats[0].player.y },
    buttons,
  }
}
