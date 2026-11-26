export const readSprites = (maxPx: number) => {
  const isSheet = (url: string) =>
    !url.startsWith('data:') && /sprite/i.test(url)
  const bad: Array<string> = []
  const images = document.querySelectorAll('img')
  for (const image of images) {
    if (isSheet(image.currentSrc || image.src)) {
      bad.push(`<img class="${image.className}"> ${image.src}`)
    }
  }
  for (const element of document.querySelectorAll('*')) {
    const background = getComputedStyle(element).backgroundImage
    for (const match of background.matchAll(/url\("?([^")]+)"?\)/g)) {
      const url = match[1] ?? ''
      if (isSheet(url)) {
        bad.push(`${element.className} background ${url}`)
      }
    }
  }
  for (const frame of document.querySelectorAll('.help-card-frame')) {
    if (
      frame instanceof HTMLImageElement &&
      (frame.naturalWidth === 0 || frame.naturalWidth > maxPx)
    ) {
      bad.push(`frame ${frame.naturalWidth} px wide`)
    }
  }
  return { bad, images: images.length }
}
