export const readDialogButtons = () => {
  const dialog = document.querySelector('dialog[open]')
  const scroller = document.scrollingElement ?? document.documentElement
  const buttons: Array<{
    name: string
    width: number
    height: number
  }> = []
  for (const button of dialog?.querySelectorAll<HTMLElement>('button') ?? []) {
    const box = button.getBoundingClientRect()
    if (box.width > 0) {
      const text = button.getAttribute('aria-label') ?? button.innerText
      buttons.push({
        name: text.slice(0, 30),
        width: Math.round(box.width),
        height: Math.round(box.height),
      })
    }
  }
  return {
    buttons,
    pageScrolls: scroller.scrollHeight > innerHeight + 1,
  }
}
