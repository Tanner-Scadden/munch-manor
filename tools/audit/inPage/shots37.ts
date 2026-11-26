export const readProfile = () => {
  const panel = document.querySelector('.profile')
  const box = panel?.getBoundingClientRect()
  const buttons: Array<{
    label: string
    width: number
    height: number
    isShown: boolean
  }> = []
  for (const button of document.querySelectorAll('.profile-dialog button')) {
    const rect = button.getBoundingClientRect()
    buttons.push({
      label: button.getAttribute('aria-label') ?? button.textContent.trim(),
      width: rect.width,
      height: rect.height,
      isShown: rect.width > 0 && rect.height > 0,
    })
  }
  const fields: Array<{ id: string; size: number }> = []
  for (const input of document.querySelectorAll('.profile-dialog input')) {
    fields.push({
      id: input.id,
      size: Number.parseFloat(getComputedStyle(input).fontSize),
    })
  }
  const labelOf = (row: Element) =>
    row.querySelector('.look-row-label')?.textContent ?? '?'
  const wrappedRows: Array<string> = []
  const clippedRows: Array<string> = []
  for (const row of document.querySelectorAll('.look-row')) {
    const lines = new Map<number, number>()
    for (const button of row.querySelectorAll('button')) {
      const top = button.getBoundingClientRect().top
      let line = top
      for (const seen of lines.keys()) {
        if (Math.abs(seen - top) <= 20) {
          line = seen
          break
        }
      }
      lines.set(line, (lines.get(line) ?? 0) + 1)
    }
    const counts: Array<number> = []
    for (const top of [...lines.keys()].sort((a, b) => a - b)) {
      counts.push(lines.get(top) ?? 0)
    }
    const first = counts[0] ?? 0
    for (const count of counts) {
      if ((count === 1 && first > 1) || count * 2 < first) {
        wrappedRows.push(labelOf(row))
        break
      }
    }
    const pageBox = row.closest('.profile-page')?.getBoundingClientRect()
    if (pageBox !== undefined) {
      for (const button of row.querySelectorAll('button')) {
        if (button.getBoundingClientRect().right > pageBox.right + 1) {
          clippedRows.push(labelOf(row))
          break
        }
      }
    }
  }
  return {
    wrappedRows,
    clippedRows,
    box:
      box !== undefined
        ? {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
          }
        : null,
    buttons,
    fields,
    width: innerWidth,
    height: innerHeight,
  }
}
