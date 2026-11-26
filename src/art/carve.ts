import { Array, Option, Record, String } from 'effect'

import type * as Draw from '#render/draw.ts'

import { parseColor } from './atlas/png.ts'
import { type Palette, TRANSPARENT } from './sprite.ts'

export type PixelView = Readonly<{
  rows: ReadonlyArray<string>
  palette: Palette
}>

export type CarvePart = Readonly<{
  name: string
  top: PixelView
  side: PixelView
  left?: number
  rise?: number
  near?: number
}>

export type CarveViews = Readonly<{
  front: PixelView
  parts: Array.NonEmptyReadonlyArray<CarvePart>
}>

export type Voxel = Readonly<{ x: number; y: number; z: number }>

type AddedVoxel = Voxel & Readonly<{ color?: string }>

export type CarveFixes = Readonly<{
  add?: ReadonlyArray<AddedVoxel>
  remove?: ReadonlyArray<Voxel>
}>

const NO_PART = 255

export type CarvedModel = Readonly<{
  width: number
  height: number
  depth: number
  lean: number
  views: CarveViews
  part: Uint8Array
  solid: Uint8Array
  own: ReadonlyMap<number, string>
  fill: ReadonlyMap<number, string>
}>

export type Face = 'Front' | 'Back' | 'Top' | 'Bottom' | 'Left' | 'Right'

const widthOf = (view: PixelView): number =>
  Array.reduce(view.rows, 0, (most, row) => Math.max(most, row.length))

const viewColorAt = ({
  view,
  column,
  row,
}: Readonly<{
  view: PixelView
  column: number
  row: number
}>): Option.Option<string> =>
  Option.flatMap(
    Option.flatMap(Array.get(view.rows, row), line =>
      column < 0 ? Option.none() : String.charAt(line, column),
    ),
    symbol =>
      symbol === TRANSPARENT ? Option.none() : Record.get(view.palette, symbol),
  )

export const viewColorsOf = (
  view: PixelView,
): ReadonlyArray<ReadonlyArray<string>> =>
  Array.map(view.rows, (line, row) =>
    Array.makeBy(line.length, column =>
      Option.getOrElse(viewColorAt({ view, column, row }), () => TRANSPARENT),
    ),
  )

const isSeen = (view: PixelView, column: number, row: number): boolean =>
  Option.isSome(viewColorAt({ view, column, row }))

const indexIn = (
  size: Readonly<{ width: number; height: number }>,
  { x, y, z }: Voxel,
): number => x + size.width * (y + size.height * z)

const isInside = (
  size: Readonly<{ width: number; height: number; depth: number }>,
  { x, y, z }: Voxel,
): boolean =>
  x >= 0 &&
  y >= 0 &&
  z >= 0 &&
  x < size.width &&
  y < size.height &&
  z < size.depth

const partTopAt = (part: CarvePart, { x, z }: Voxel) =>
  viewColorAt({
    view: part.top,
    column: x - (part.left ?? 0),
    row: part.top.rows.length - 1 - (z - (part.near ?? 0)),
  })

const partSideAt = (part: CarvePart, { y, z }: Voxel) =>
  viewColorAt({
    view: part.side,
    column: z - (part.near ?? 0),
    row: y - (part.rise ?? 0),
  })

const sizeOf = (
  views: CarveViews,
  lean: number,
): Readonly<{ width: number; height: number; depth: number }> => {
  const depth = Array.reduce(views.parts, 1, (most, part) =>
    Math.max(
      most,
      (part.near ?? 0) + Math.max(part.top.rows.length, widthOf(part.side)),
    ),
  )
  return {
    width: Array.reduce(views.parts, widthOf(views.front), (most, part) =>
      Math.max(most, (part.left ?? 0) + widthOf(part.top)),
    ),
    depth,
    height: Array.reduce(
      views.parts,
      views.front.rows.length + lean * (depth - 1),
      (most, part) => Math.max(most, (part.rise ?? 0) + part.side.rows.length),
    ),
  }
}

export const carve = ({
  views,
  lean = 0,
  fixes = {},
}: Readonly<{
  views: CarveViews
  lean?: number
  fixes?: CarveFixes
}>): CarvedModel => {
  const size = sizeOf(views, lean)
  const { width, height, depth } = size
  const solid = new Uint8Array(width * height * depth)
  const part = new Uint8Array(width * height * depth).fill(NO_PART)
  Array.forEach(views.parts, (each, partIndex) => {
    for (let z = 0; z < depth; z += 1) {
      for (let y = 0; y < height; y += 1) {
        if (Option.isNone(partSideAt(each, { x: 0, y, z }))) {
          continue
        }
        for (let x = 0; x < width; x += 1) {
          const voxel = { x, y, z }
          const index = indexIn(size, voxel)
          if (
            solid[index] !== 1 &&
            Option.isSome(partTopAt(each, voxel)) &&
            isSeen(views.front, x, y - lean * z)
          ) {
            solid[index] = 1
            part[index] = partIndex
          }
        }
      }
    }
  })
  return {
    ...size,
    lean,
    views,
    part,
    solid,
    own: fixedOwn({ size, solid, part, fixes }),
    fill: new Map(),
  }
}

const fixedOwn = ({
  size,
  solid,
  part,
  fixes,
}: Readonly<{
  size: Readonly<{ width: number; height: number; depth: number }>
  solid: Uint8Array
  part: Uint8Array
  fixes: CarveFixes
}>): ReadonlyMap<number, string> => {
  const own = new Map<number, string>()
  for (const voxel of fixes.add ?? []) {
    if (isInside(size, voxel)) {
      const index = indexIn(size, voxel)
      solid[index] = 1
      if (voxel.color !== undefined) {
        own.set(index, voxel.color)
      }
    }
  }
  for (const voxel of fixes.remove ?? []) {
    if (isInside(size, voxel)) {
      const index = indexIn(size, voxel)
      solid[index] = 0
      part[index] = NO_PART
      own.delete(index)
    }
  }
  return own
}

const NO_VIEW: PixelView = { rows: [], palette: {} }

export const blocksModelOf = (
  blocks: ReadonlyArray<Voxel & Readonly<{ color: string }>>,
): CarvedModel => {
  const reach = (read: (voxel: Voxel) => number): number =>
    Array.reduce(blocks, 1, (most, voxel) => Math.max(most, read(voxel) + 1))
  const size = {
    width: reach(({ x }) => x),
    height: reach(({ y }) => y),
    depth: reach(({ z }) => z),
  }
  const cells = size.width * size.height * size.depth
  const solid = new Uint8Array(cells)
  const part = new Uint8Array(cells).fill(NO_PART)
  return {
    ...size,
    lean: 1,
    views: {
      front: NO_VIEW,
      parts: [{ name: 'blocks', top: NO_VIEW, side: NO_VIEW }],
    },
    part,
    solid,
    own: fixedOwn({ size, solid, part, fixes: { add: blocks } }),
    fill: new Map(),
  }
}

export type SpriteForm = Readonly<{
  width: number
  height: number
  depth: number
  near: Uint8Array
  thick: Uint8Array
}>

type Runs = Readonly<{ at: Uint8Array; length: Uint8Array }>

const runsAlong = (
  input: Readonly<{
    solid: Uint8Array
    start: number
    count: number
    step: number
    into: Runs
  }>,
): void => {
  const { solid, start, count, step, into } = input
  let runStart = 0
  for (let at = 0; at <= count; at += 1) {
    if (at < count && solid[start + at * step] === 1) {
      continue
    }
    for (let inside = runStart; inside < at; inside += 1) {
      const index = start + inside * step
      into.at[index] = inside - runStart
      into.length[index] = at - runStart
    }
    runStart = at + 1
  }
}

const chordOf = (
  input: Readonly<{ thickness: number; at: number; length: number }>,
): number => {
  const { thickness, at, length } = input
  const across = (at + 0.5 - length / 2) / (length / 2)
  return Math.max(
    1,
    Math.round(thickness * Math.sqrt(Math.max(0, 1 - across * across))),
  )
}

const inwardOf = (
  input: Readonly<{ across: Runs; width: number; height: number }>,
): Uint8Array => {
  const { across, width, height } = input
  const count = width * height
  const own = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    const at = across.at[index] ?? 0
    own[index] = Math.min(at, (across.length[index] ?? 0) - 1 - at)
  }
  const inward = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    const isSolidRow = (other: number): boolean =>
      other >= 0 && other < count && (across.length[other] ?? 0) > 0
    inward[index] = Math.min(
      own[index] ?? 0,
      isSolidRow(index - width) ? (own[index - width] ?? 0) + 1 : 255,
      isSolidRow(index + width) ? (own[index + width] ?? 0) + 1 : 255,
    )
  }
  return inward
}

export const formOf = ({
  width,
  height,
  isSolid,
  most = 255,
}: Readonly<{
  width: number
  height: number
  isSolid: (column: number, row: number) => boolean
  most?: number
}>): SpriteForm => {
  const count = width * height
  const solid = new Uint8Array(count)
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      solid[row * width + column] = isSolid(column, row) ? 1 : 0
    }
  }
  const across = { at: new Uint8Array(count), length: new Uint8Array(count) }
  const down = { at: new Uint8Array(count), length: new Uint8Array(count) }
  for (let row = 0; row < height; row += 1) {
    runsAlong({
      solid,
      start: row * width,
      count: width,
      step: 1,
      into: across,
    })
  }
  for (let column = 0; column < width; column += 1) {
    runsAlong({ solid, start: column, count: height, step: width, into: down })
  }
  const inward = inwardOf({ across, width, height })
  const thick = new Uint8Array(count)
  let depth = 1
  for (let index = 0; index < count; index += 1) {
    if (solid[index] !== 1) {
      continue
    }
    const acrossLength = across.length[index] ?? 1
    const downLength = down.length[index] ?? 1
    const acrossAt = across.at[index] ?? 0
    const downAt = down.at[index] ?? 0
    const thickness = Math.min(most, acrossLength, downLength)
    const blocks = Math.min(
      1 + 2 * (inward[index] ?? 0),
      chordOf({ thickness, at: acrossAt, length: acrossLength }),
      chordOf({ thickness, at: downAt, length: downLength }),
    )
    thick[index] = blocks
    depth = Math.max(depth, blocks)
  }
  const near = new Uint8Array(count)
  for (let index = 0; index < count; index += 1) {
    near[index] = Math.floor((depth - (thick[index] ?? 0)) / 2)
  }
  return { width, height, depth, near, thick }
}

const fillOf = (
  input: Readonly<{
    front: PixelView
    outline: ReadonlySet<string>
    column: number
    row: number
  }>,
): Option.Option<string> => {
  const { front, outline, column, row } = input
  const isFill = (x: number, y: number): boolean =>
    Option.exists(
      Option.flatMap(Array.get(front.rows, y), line =>
        x < 0 ? Option.none() : String.charAt(line, x),
      ),
      symbol => symbol !== TRANSPARENT && !outline.has(symbol),
    )
  const own = viewColorAt({ view: front, column, row })
  if (isFill(column, row) || Option.isNone(own)) {
    return own
  }
  const reach = Math.max(widthOf(front), front.rows.length)
  for (let step = 1; step < reach; step += 1) {
    const found = Array.findFirst(
      [
        { x: column - step, y: row },
        { x: column + step, y: row },
        { x: column, y: row - step },
        { x: column, y: row + step },
      ],
      ({ x, y }) => isFill(x, y),
    )
    if (Option.isSome(found)) {
      return viewColorAt({
        view: front,
        column: found.value.x,
        row: found.value.y,
      })
    }
  }
  return own
}

const defaultCarveOf = (
  input: Readonly<{
    front: PixelView
    outline: ReadonlySet<string>
    most: number
    fixes: CarveFixes
  }>,
): CarvedModel => {
  const { front, outline, most, fixes } = input
  const form = formOf({
    width: widthOf(front),
    height: front.rows.length,
    isSolid: (column, row) => isSeen(front, column, row),
    most,
  })
  const size = {
    width: form.width,
    height: form.height + form.depth - 1,
    depth: form.depth,
  }
  const cells = size.width * size.height * size.depth
  const solid = new Uint8Array(cells)
  const part = new Uint8Array(cells).fill(NO_PART)
  const fill = new Map<number, string>()
  for (let row = 0; row < form.height; row += 1) {
    for (let column = 0; column < form.width; column += 1) {
      const pixel = row * form.width + column
      const near = form.near[pixel] ?? 0
      const blocks = form.thick[pixel] ?? 0
      const color = fillOf({ front, outline, column, row })
      for (let z = near; z < near + blocks; z += 1) {
        const index = indexIn(size, { x: column, y: row + z, z })
        solid[index] = 1
        if (Option.isSome(color)) {
          fill.set(index, color.value)
        }
      }
    }
  }
  const own = fixedOwn({ size, solid, part, fixes })
  for (const voxel of fixes.remove ?? []) {
    if (isInside(size, voxel)) {
      fill.delete(indexIn(size, voxel))
    }
  }
  return {
    ...size,
    lean: 1,
    views: { front, parts: [{ name: 'form', top: NO_VIEW, side: NO_VIEW }] },
    part,
    solid,
    own,
    fill,
  }
}

export type SpriteCarve = Readonly<{
  outline?: string
  most?: number
  parts?: Array.NonEmptyReadonlyArray<CarvePart>
  fixes?: CarveFixes
}>

const carvedSprites = new Map<string, CarvedModel>()
const refinementIds = new WeakMap<SpriteCarve, number>()

const refinementIdOf = (refine: SpriteCarve): number => {
  const known = refinementIds.get(refine)
  if (known !== undefined) {
    return known
  }
  const id = carvedSprites.size + 1
  refinementIds.set(refine, id)
  return id
}

const NO_REFINEMENT: SpriteCarve = {}

export const carveSprite = ({
  pixels,
  palette,
  refine = NO_REFINEMENT,
}: Readonly<{
  pixels: ReadonlyArray<string>
  palette: Palette
  refine?: SpriteCarve
}>): CarvedModel => {
  const key = Array.join(
    [
      Array.join(pixels, '/'),
      Array.join(
        Array.map(
          Record.toEntries(palette),
          ([symbol, color]) => symbol + color,
        ),
        ',',
      ),
      `${refinementIdOf(refine)}`,
    ],
    '|',
  )
  const known = carvedSprites.get(key)
  if (known !== undefined) {
    return known
  }
  const front = { rows: pixels, palette }
  const model =
    refine.parts === undefined
      ? defaultCarveOf({
          front,
          outline: new Set(String.split(refine.outline ?? '', '')),
          most: refine.most ?? 255,
          fixes: refine.fixes ?? {},
        })
      : carve({
          views: { front, parts: refine.parts },
          lean: 1,
          fixes: refine.fixes ?? {},
        })
  carvedSprites.set(key, model)
  return model
}

export const voxelsWithin = ({
  from,
  to,
}: Readonly<{ from: Voxel; to: Voxel }>): ReadonlyArray<Voxel> => {
  const voxels: Array<Voxel> = []
  for (let z = Math.min(from.z, to.z); z <= Math.max(from.z, to.z); z += 1) {
    for (let y = Math.min(from.y, to.y); y <= Math.max(from.y, to.y); y += 1) {
      for (
        let x = Math.min(from.x, to.x);
        x <= Math.max(from.x, to.x);
        x += 1
      ) {
        voxels.push({ x, y, z })
      }
    }
  }
  return voxels
}

export const isSolidAt = ({
  model,
  voxel,
}: Readonly<{ model: CarvedModel; voxel: Voxel }>): boolean =>
  isInside(model, voxel) && model.solid[indexIn(model, voxel)] === 1

export const voxelsOf = (model: CarvedModel): ReadonlyArray<Voxel> => {
  const voxels: Array<Voxel> = []
  for (let z = 0; z < model.depth; z += 1) {
    for (let y = 0; y < model.height; y += 1) {
      for (let x = 0; x < model.width; x += 1) {
        if (model.solid[indexIn(model, { x, y, z })] === 1) {
          voxels.push({ x, y, z })
        }
      }
    }
  }
  return voxels
}

type Read = (model: CarvedModel, voxel: Voxel) => Option.Option<string>

const frontColorOf: Read = (model, { x, y, z }) =>
  viewColorAt({ view: model.views.front, column: x, row: y - model.lean * z })

const partsOf = (model: CarvedModel, voxel: Voxel): ReadonlyArray<CarvePart> =>
  Option.match(
    Array.get(model.views.parts, model.part[indexIn(model, voxel)] ?? NO_PART),
    { onNone: () => model.views.parts, onSome: part => [part] },
  )

const firstSome = (
  parts: ReadonlyArray<CarvePart>,
  read: (part: CarvePart) => Option.Option<string>,
): Option.Option<string> =>
  Array.reduce(parts, Option.none<string>(), (found, part) =>
    Option.isSome(found) ? found : read(part),
  )

const topColorOf: Read = (model, voxel) =>
  firstSome(partsOf(model, voxel), part => partTopAt(part, voxel))

const sideColorOf: Read = (model, voxel) =>
  firstSome(partsOf(model, voxel), part => partSideAt(part, voxel))

const VIEW_ORDER: Readonly<Record<Face, ReadonlyArray<Read>>> = {
  Front: [frontColorOf, topColorOf, sideColorOf],
  Back: [frontColorOf, topColorOf, sideColorOf],
  Top: [topColorOf, frontColorOf, sideColorOf],
  Bottom: [topColorOf, frontColorOf, sideColorOf],
  Left: [sideColorOf, frontColorOf, topColorOf],
  Right: [sideColorOf, frontColorOf, topColorOf],
}

export const faceColorOf = ({
  model,
  voxel,
  face,
}: Readonly<{
  model: CarvedModel
  voxel: Voxel
  face: Face
}>): Option.Option<string> => {
  if (!isSolidAt({ model, voxel })) {
    return Option.none()
  }
  const own = model.own.get(indexIn(model, voxel))
  if (own !== undefined) {
    return Option.some(own)
  }
  const fill = model.fill.get(indexIn(model, voxel))
  if (fill !== undefined && face !== 'Front' && face !== 'Back') {
    return Option.some(fill)
  }
  return Array.reduce(VIEW_ORDER[face], Option.none<string>(), (found, read) =>
    Option.isSome(found) ? found : read(model, voxel),
  )
}

const SYMBOLS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

const pictureOf = (
  input: Readonly<{
    width: number
    height: number
    colorAt: (column: number, row: number) => Option.Option<string>
  }>,
): PixelView => {
  const symbols = new Map<string, string>()
  const rows = Array.makeBy(input.height, row =>
    Array.join(
      Array.makeBy(input.width, column =>
        Option.match(input.colorAt(column, row), {
          onNone: () => TRANSPARENT,
          onSome: color => {
            const known = symbols.get(color)
            if (known !== undefined) {
              return known
            }
            const symbol = Option.getOrElse(
              String.charAt(SYMBOLS, symbols.size % SYMBOLS.length),
              () => '#',
            )
            symbols.set(color, symbol)
            return symbol
          },
        }),
      ),
      '',
    ),
  )
  return {
    rows,
    palette: Record.fromEntries(
      Array.map(Array.fromIterable(symbols), ([color, symbol]) => [
        symbol,
        color,
      ]),
    ),
  }
}

const SOLID_ALPHA = 128

export const pixelViewOfShapes = ({
  shapes,
  box,
}: Readonly<{
  shapes: ReadonlyArray<Draw.Shape>
  box: Readonly<{ left: number; top: number; width: number; height: number }>
}>): PixelView => {
  const colors = new Map<number, string>()
  for (const shape of shapes) {
    if (
      shape._tag !== 'Rect' ||
      !Option.exists(parseColor(shape.fill ?? ''), ({ a }) => a >= SOLID_ALPHA)
    ) {
      continue
    }
    for (let y = shape.y; y < shape.y + shape.height; y += 1) {
      for (let x = shape.x; x < shape.x + shape.width; x += 1) {
        const column = x - box.left
        const row = y - box.top
        if (column >= 0 && row >= 0 && column < box.width && row < box.height) {
          colors.set(column + box.width * row, shape.fill ?? '')
        }
      }
    }
  }
  return pictureOf({
    width: box.width,
    height: box.height,
    colorAt: (column, row) =>
      Option.fromUndefinedOr(colors.get(column + box.width * row)),
  })
}

const draftedViewsOf = (
  model: CarvedModel,
): Readonly<{ front: PixelView; top: PixelView; side: PixelView }> => {
  const { width, height, depth, views } = model
  return {
    front: views.front,
    top: pictureOf({
      width,
      height: depth,
      colorAt: (x, row) =>
        firstSome(views.parts, part =>
          partTopAt(part, { x, y: 0, z: depth - 1 - row }),
        ),
    }),
    side: pictureOf({
      width: depth,
      height,
      colorAt: (z, y) =>
        firstSome(views.parts, part => partSideAt(part, { x: 0, y, z })),
    }),
  }
}

const firstAlong = (
  model: CarvedModel,
  cells: ReadonlyArray<Voxel>,
  face: Face,
): Option.Option<string> =>
  Option.flatMap(
    Array.findFirst(cells, voxel => isSolidAt({ model, voxel })),
    voxel => faceColorOf({ model, voxel, face }),
  )

export const carvedViewsOf = (
  model: CarvedModel,
): Readonly<{ front: PixelView; top: PixelView; side: PixelView }> => {
  const { width, height, depth, lean } = model
  const zs = Array.makeBy(depth, z => z)
  return {
    front: pictureOf({
      width,
      height: height - lean * (depth - 1),
      colorAt: (x, row) =>
        firstAlong(
          model,
          Array.map(zs, z => ({ x, y: row + lean * z, z })),
          'Front',
        ),
    }),
    top: pictureOf({
      width,
      height: depth,
      colorAt: (x, row) =>
        firstAlong(
          model,
          Array.makeBy(height, y => ({ x, y, z: depth - 1 - row })),
          'Top',
        ),
    }),
    side: pictureOf({
      width: depth,
      height,
      colorAt: (z, y) =>
        firstAlong(
          model,
          Array.makeBy(width, step => ({ x: width - 1 - step, y, z })),
          'Right',
        ),
    }),
  }
}

export const lensViewOf = (model: CarvedModel): PixelView => {
  const { width, height, depth } = model
  const colors = new Map<number, Readonly<{ color: string; near: number }>>()
  const paint = (x: number, row: number, near: number, color: string) => {
    const key = x + width * (row + 1)
    const known = colors.get(key)
    if (known === undefined || near < known.near) {
      colors.set(key, { color, near })
    }
  }
  for (const voxel of voxelsOf(model)) {
    const row = voxel.y - voxel.z
    Option.map(faceColorOf({ model, voxel, face: 'Front' }), color => {
      paint(voxel.x, row, voxel.z, color)
    })
    if (!isSolidAt({ model, voxel: { ...voxel, y: voxel.y - 1 } })) {
      Option.map(faceColorOf({ model, voxel, face: 'Top' }), color => {
        paint(voxel.x, row - 1, voxel.z + 0.5, color)
      })
    }
  }
  return pictureOf({
    width,
    height: height - (depth - 1) + 1,
    colorAt: (x, row) =>
      Option.map(
        Option.fromUndefinedOr(colors.get(x + width * row)),
        ({ color }) => color,
      ),
  })
}

export type ShowpieceSheet = Readonly<{
  size: Readonly<{ width: number; height: number; depth: number }>
  drafted: Readonly<{ front: PixelView; top: PixelView; side: PixelView }>
  carved: Readonly<{ front: PixelView; top: PixelView; side: PixelView }>
  lens: PixelView
  voxels: ReadonlyArray<
    Voxel &
      Readonly<{ front: Option.Option<string>; top: Option.Option<string> }>
  >
}>

export const showpieceSheetOf = (model: CarvedModel): ShowpieceSheet => ({
  size: { width: model.width, height: model.height, depth: model.depth },
  drafted: draftedViewsOf(model),
  carved: carvedViewsOf(model),
  lens: lensViewOf(model),
  voxels: Array.map(voxelsOf(model), voxel => ({
    ...voxel,
    front: faceColorOf({ model, voxel, face: 'Front' }),
    top: faceColorOf({ model, voxel, face: 'Top' }),
  })),
})
