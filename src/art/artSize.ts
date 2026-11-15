import { Function, Option } from 'effect'

// Pixel art in HTML at whole device pixels: the size of every icon
// pixelIconUrl builds, by its URL, and the inline style that draws it at the
// largest whole number of device pixels per art pixel its box has room for.

type ArtSize = Readonly<{ width: number; height: number }>

// NOTE: keyed by the URL itself, so building the same icon again finds the
// same entry: the map holds one entry per distinct icon, never per render.
const artSizes = new Map<string, ArtSize>()

// NOTE: called by pixelIconUrl for an icon that keeps its shape (a stretched
// one fills its box on purpose and is never snapped).
export const noteArtSize: {
  (size: ArtSize): (url: string) => void
  (url: string, size: ArtSize): void
} = Function.dual(2, (url: string, size: ArtSize): void => {
  artSizes.set(url, size)
})

type ArtStyle = Readonly<Record<string, string>>

const styles = new Map<string, ArtStyle>()

// NOTE: one device pixel in CSS pixels, set on the game's root from the
// surface's devicePixelRatio (src/app/view.ts), 1px before it is measured.
const DEVICE_PX = 'var(--dpx, 1px)'

// NOTE: the art's long side rounded down to a whole multiple of its own
// length in device pixels (CSS round(), so the box can be any size and
// any layout), never less than one device pixel per art pixel; the other
// side follows the art's shape, so both sides take the same whole scale.
// A box as wide as it is tall fits the art by its long side; a box of
// another shape that should fit by its other side says so with its own
// padding (background-origin: content-box).
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

// NOTE: the inline style that shows a pixel icon as an element's background:
// its picture and, for an icon pixelIconUrl built, its snapped size, which
// wins over a stylesheet's `contain`. Built once per icon.
export const pixelArtStyle = (url: string): ArtStyle =>
  Option.getOrElse(Option.fromNullishOr(styles.get(url)), () => {
    const style = styleOf(url)
    styles.set(url, style)
    return style
  })
