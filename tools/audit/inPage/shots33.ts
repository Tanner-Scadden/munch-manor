export const readLayout = ({
  minSide,
  isPhone,
}: Readonly<{ minSide: number; isPhone: boolean }>) => {
  const openDialog = document.querySelector('dialog[open]')
  const scope: ParentNode = openDialog ?? document
  const buttons: Array<{ label: string; box: DOMRect }> = []
  for (const button of scope.querySelectorAll('button, a.home-support')) {
    if (openDialog === null && button.closest('dialog') !== null) {
      continue
    }
    const box = button.getBoundingClientRect()
    if (box.width > 0 && box.height > 0) {
      buttons.push({
        label: button.getAttribute('aria-label') ?? button.textContent.trim(),
        box,
      })
    }
  }
  const small: Array<string> = []
  if (isPhone) {
    for (const { label, box } of buttons) {
      if (box.width < minSide - 0.5 || box.height < minSide - 0.5) {
        small.push(
          `${label} ${Math.round(box.width)}x${Math.round(box.height)}`,
        )
      }
    }
  }
  const overlaps: Array<string> = []
  if (openDialog === null) {
    for (let index = 0; index < buttons.length; index++) {
      const first = buttons[index]
      for (let next = index + 1; next < buttons.length; next++) {
        const second = buttons[next]
        if (
          first !== undefined &&
          second !== undefined &&
          first.box.left < second.box.right - 1 &&
          second.box.left < first.box.right - 1 &&
          first.box.top < second.box.bottom - 1 &&
          second.box.top < first.box.bottom - 1
        ) {
          overlaps.push(`${first.label} / ${second.label}`)
        }
      }
    }
  }
  const panel = document.querySelector('dialog[open] .panel')
  const panelScroll =
    panel === null ? 0 : panel.scrollHeight - panel.clientHeight
  const pageScroll = document.documentElement.scrollHeight - window.innerHeight
  const play = document.querySelector('#home-play')?.getBoundingClientRect()
  return {
    small,
    overlaps,
    panelScroll,
    pageScroll,
    play:
      play === undefined
        ? 'none'
        : `${Math.round(play.x)},${Math.round(play.y)} ${Math.round(play.width)}x${Math.round(play.height)}`,
  }
}
