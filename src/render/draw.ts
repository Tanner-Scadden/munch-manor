// The game's drawing vocabulary as plain data, owned by the game: rects,
// circles, paths, images, and groups, one for one with the canvas shapes
// they replaced. The art modules build them, and Pixi alone draws
// them (the world's planes in iso/painter.ts, the overlay in
// iso/overlayScene.ts). Nothing here touches a 2D canvas.

type Point = Readonly<{ x: number; y: number }>

export type MoveTo = Readonly<{ _tag: 'MoveTo'; x: number; y: number }>
export type LineTo = Readonly<{ _tag: 'LineTo'; x: number; y: number }>
type QuadTo = Readonly<{
  _tag: 'QuadTo'
  cpx: number
  cpy: number
  x: number
  y: number
}>
type BezierTo = Readonly<{
  _tag: 'BezierTo'
  cp1x: number
  cp1y: number
  cp2x: number
  cp2y: number
  x: number
  y: number
}>
export type Close = Readonly<{ _tag: 'Close' }>
export type PathInstruction = MoveTo | LineTo | QuadTo | BezierTo | Close

type Paint = {
  readonly fill?: string | undefined
  readonly stroke?: string | undefined
  readonly lineWidth?: number | undefined
}

export type Rect = Readonly<
  { _tag: 'Rect'; x: number; y: number; width: number; height: number } & Paint
>
export type Circle = Readonly<
  { _tag: 'Circle'; x: number; y: number; radius: number } & Paint
>
export type Path = Readonly<
  {
    _tag: 'Path'
    instructions: ReadonlyArray<PathInstruction>
    lineCap?: 'Butt' | 'Round' | 'Square' | undefined
    lineJoin?: 'Miter' | 'Round' | 'Bevel' | undefined
  } & Paint
>
type ImageCrop = Readonly<{
  x: number
  y: number
  width: number
  height: number
}>
export type Image = Readonly<{
  _tag: 'Image'
  src: string
  x: number
  y: number
  width: number
  height: number
  crop?: ImageCrop | undefined
  rendering?: 'Smooth' | 'Pixelated' | undefined
}>
export type Group = Readonly<{
  _tag: 'Group'
  shapes: ReadonlyArray<Shape>
  translate?: Point | undefined
  rotate?: number | undefined
  scale?: Point | undefined
  opacity?: number | undefined
}>

export type Shape = Rect | Circle | Path | Image | Group

// NOTE: each constructor adds its tag to the fields, one spread a shape.
export const MoveTo = (fields: Omit<MoveTo, '_tag'>): MoveTo => ({
  _tag: 'MoveTo',
  ...fields,
})
export const LineTo = (fields: Omit<LineTo, '_tag'>): LineTo => ({
  _tag: 'LineTo',
  ...fields,
})
export const Rect = (fields: Omit<Rect, '_tag'>): Rect => ({
  _tag: 'Rect',
  ...fields,
})
export const Circle = (fields: Omit<Circle, '_tag'>): Circle => ({
  _tag: 'Circle',
  ...fields,
})
export const Path = (fields: Omit<Path, '_tag'>): Path => ({
  _tag: 'Path',
  ...fields,
})
export const Image = (fields: Omit<Image, '_tag'>): Image => ({
  _tag: 'Image',
  ...fields,
})
export const Group = (fields: Omit<Group, '_tag'>): Group => ({
  _tag: 'Group',
  ...fields,
})
export const Close = (): Close => ({ _tag: 'Close' })
