import { Function, Option } from 'effect'

type ArtSize = Readonly<{ width: number; height: number }>

const artSizes = new Map<string, ArtSize>()

export const noteArtSize: {
  (size: ArtSize): (url: string) => void
  (url: string, size: ArtSize): void
} = Function.dual(2, (url: string, size: ArtSize): void => {
  artSizes.set(url, size)
})

type ArtStyle = Readonly<Record<string, string>>

const styles = new Map<string, ArtStyle>()

const DEVICE_PX = 'var(--dpx, 1px)'

const snappedSize = ({ width, height }: ArtSize): string => {
  const isWide = width >= height
  const side = `calc(${isWide ? width : height} * ${DEVICE_PX})`
  const snapped = `max(${side}, round(down, 100%, ${side}))`
  return isWide ? `${snapped} auto` : `auto ${snapped}`
}

const styleOf = (url: string): ArtStyle =>
  Option.match(Option.fromNullishOr(artSizes.get(url)), {
    onNone: () => ({ backgroundImage: url }),
    onSome: size => ({
      backgroundImage: url,
      backgroundSize: snappedSize(size),
    }),
  })

export const pixelArtStyle = (url: string): ArtStyle =>
  Option.getOrElse(Option.fromNullishOr(styles.get(url)), () => {
    const style = styleOf(url)
    styles.set(url, style)
    return style
  })
