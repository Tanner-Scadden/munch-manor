export const placeTapTarget = ({
  index,
  hasDialog,
  inset,
  targets,
}: Readonly<{
  index: number
  hasDialog: boolean
  inset: number
  targets: string
}>) => {
  const scope: ParentNode = hasDialog
    ? (document.querySelector('dialog[open]') ?? document)
    : document
  const button = scope.querySelectorAll(targets)[index]
  if (button === undefined) {
    throw new Error(`No tap target at ${index}`)
  }
  button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  const box = button.getBoundingClientRect()
  const center = {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  }
  return {
    label: button.getAttribute('aria-label') ?? button.textContent.trim(),
    index,
    center,
    width: box.width,
    height: box.height,
    points: [
      { name: 'center', point: center },
      { name: 'left', point: { x: box.left + inset, y: center.y } },
      { name: 'right', point: { x: box.right - inset, y: center.y } },
      { name: 'top', point: { x: center.x, y: box.top + inset } },
      {
        name: 'bottom',
        point: { x: center.x, y: box.bottom - inset },
      },
      {
        name: 'corner',
        point: { x: box.left + inset * 4, y: box.top + inset * 4 },
      },
    ],
  }
}
