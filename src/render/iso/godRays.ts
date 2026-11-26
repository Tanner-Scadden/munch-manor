import { Array, Option } from 'effect'
import type { ColorSource, Texture } from 'pixi.js'

import {
  Container3D,
  FlatMaterial,
  Geometry3D,
  Mesh3D,
  type ShaderBit,
} from '@pixi/3d'

import { isRoomOpen } from '#render/room/room.ts'
import type { Box } from '#render/room/roomPalette.ts'
import { ROSE_PALETTE } from '#render/room/roseWindowArt.ts'
import { type Pane, windowPanesOf } from '#render/room/windows.ts'
import { TILE_SIZE } from '#shared/constants.ts'
import { unitOf } from '#shared/prng.ts'
import { gapBoxOf, isChandelierDown } from '#world/dining/chandelier.ts'
import type { Level } from '#world/level/arena.ts'
import type { Vector } from '#world/schema/entitySchema.ts'
import type { World } from '#world/schema/worldSchema.ts'

import type { Mote } from './air.ts'
import { flameSpecsOf } from './lightSpecs.ts'
import { GL_HEADER, GPU_HEADER, dataTexture, glFloat } from './look.ts'
import { mixColor, strikeOf } from './mood.ts'
import {
  PITCH,
  STRETCH,
  UNIT,
  WALL_ROW,
  standingPointOf,
  wallHeightAt,
  zOf,
} from './space.ts'
import { paneBoxesOf } from './storm.ts'
import { colorOf } from './textures.ts'

type RayShape = 'Shaft' | 'Pool' | 'Cone' | 'Round'

const DENSITY: Readonly<Record<RayShape, string>> = {
  Shaft:
    'clamp(min(rayUv.x, 1.0 - rayUv.x) * 6.0, 0.0, 1.0) * (1.0 - 0.75 * rayUv.y)',
  Pool: 'clamp(min(min(rayUv.x, 1.0 - rayUv.x), min(rayUv.y, 1.0 - rayUv.y)) * 3.0 + 0.25, 0.0, 1.0)',
  Cone: 'clamp((mix(0.12, 1.0, rayUv.y) - abs(rayUv.x - 0.5) * 2.0) * 4.0, 0.0, 1.0) * (1.0 - 0.8 * rayUv.y)',
  Round: 'clamp((1.0 - length((rayUv - vec2(0.5)) * 2.0)) * 2.5, 0.0, 1.0)',
}

const STEPS = 4

const C = {
  sinPitch: glFloat(Math.sin(PITCH)),
  cosPitch: glFloat(Math.cos(PITCH)),
  unit: glFloat(UNIT),
  steps: glFloat(STEPS),
}

type Dialect = Readonly<{
  vec2: string
  float: string
  local: string
  position: string
  uv: string
  dx: string
  dy: string
}>

const GL: Dialect = {
  vec2: 'vec2',
  float: 'float',
  local: '',
  position: 'vPosition',
  uv: 'vUV',
  dx: 'dFdx',
  dy: 'dFdy',
}

const GPU: Dialect = {
  vec2: 'vec2<f32>',
  float: 'f32',
  local: 'input.',
  position: 'input.vPosition',
  uv: 'input.vUV',
  dx: 'dpdx',
  dy: 'dpdy',
}

const declare = (d: Dialect, type: string, name: string): string =>
  d === GL ? `${type} ${name}` : `let ${name}: ${type}`

const rayCode = (
  d: Dialect,
  input: Readonly<{ shape: RayShape; isTextured: boolean }>,
): string => {
  const { vec2, float } = d
  const sample = input.isTextured
    ? `albedo = inputTint(material.baseColor, material.displayBaseColor).rgb * decodeColor(sampleBaseColor(rayUv).rgb);`
    : ''
  return `{
  ${declare(d, vec2, 'rayP')} = ${vec2}(${d.position}.x, ${d.position}.z * ${C.sinPitch} - ${d.position}.y * ${C.cosPitch}) / ${C.unit};
  ${declare(d, vec2, 'rayPx')} = ${d.dx}(rayP);
  ${declare(d, vec2, 'rayPy')} = ${d.dy}(rayP);
  ${declare(d, vec2, 'rayUx')} = ${d.dx}(${d.uv});
  ${declare(d, vec2, 'rayUy')} = ${d.dy}(${d.uv});
  ${declare(d, float, 'rayDet')} = rayPx.x * rayPy.y - rayPy.x * rayPx.y;
  ${declare(d, vec2, 'rayD')} = floor(rayP) + 0.5 - rayP;
  ${declare(d, float, 'raySafe')} = select1(abs(rayDet) > 0.000001, rayDet, 1.0);
  ${declare(d, vec2, 'rayS')} = ${vec2}(rayPy.y * rayD.x - rayPy.x * rayD.y, rayPx.x * rayD.y - rayPx.y * rayD.x) / raySafe;
  ${declare(d, vec2, 'rayUv')} = ${d.uv} + rayUx * rayS.x + rayUy * rayS.y;
  ${declare(d, float, 'rayIn')} = step(0.0, rayUv.x) * step(rayUv.x, 1.0) * step(0.0, rayUv.y) * step(rayUv.y, 1.0);
  ${declare(d, float, 'rayLight')} = clamp(rayIn * ${DENSITY[input.shape]}, 0.0, 1.0);
  alpha = alpha * floor(rayLight * ${C.steps} + 0.5) / ${C.steps};
  ${sample}
}`
}

const GL_SELECT = `
float select1(bool isTrue, float whenTrue, float whenFalse) {
  return isTrue ? whenTrue : whenFalse;
}
`

const GPU_SELECT = `
fn select1(isTrue: bool, whenTrue: f32, whenFalse: f32) -> f32 {
  return select(whenFalse, whenTrue, isTrue);
}
`

const rayBitOf = (
  input: Readonly<{ shape: RayShape; isTextured: boolean }>,
): ShaderBit => ({
  name: `munchRay${input.shape}${input.isTextured ? 'Textured' : ''}`,
  gpu: {
    header: GPU_HEADER + GPU_SELECT,
    fragment: { material: rayCode(GPU, input) },
  },
  gl: {
    header: GL_HEADER + GL_SELECT,
    fragment: { material: rayCode(GL, input) },
  },
})

const rayMaterial = (
  input: Readonly<{
    shape: RayShape
    color: ColorSource
    texture?: Texture
  }>,
): FlatMaterial => {
  const material = new FlatMaterial({
    baseColor: input.color,
    alphaMode: 'blend',
    alpha: 0,
    doubleSided: true,
    extraBits: [
      rayBitOf({ shape: input.shape, isTextured: input.texture !== undefined }),
    ],
    ...(input.texture === undefined ? {} : { baseColorTexture: input.texture }),
  })
  material.state.blendMode = 'add'
  material.state.depthMask = false
  return material
}

type Vec3 = Readonly<{ x: number; y: number; z: number }>

type RayQuad = Readonly<{
  corner: Vec3
  u: Vec3
  v: Vec3
  across: number
  along: number
}>

const PAD_PX = 3

const at = (quad: RayQuad, u: number, v: number): Vec3 => ({
  x: quad.corner.x + quad.u.x * u + quad.v.x * v,
  y: quad.corner.y + quad.u.y * u + quad.v.y * v,
  z: quad.corner.z + quad.u.z * u + quad.v.z * v,
})

const writeQuad = (
  quad: RayQuad,
  out: Readonly<{ positions: Float32Array; uvs: Float32Array }>,
  index: number,
): void => {
  const pu = PAD_PX / Math.max(1, quad.across)
  const pv = PAD_PX / Math.max(1, quad.along)
  const corners = [
    [-pu, -pv],
    [1 + pu, -pv],
    [1 + pu, 1 + pv],
    [-pu, 1 + pv],
  ] as const
  Array.forEach(corners, ([u, v], corner) => {
    const point = at(quad, u, v)
    out.positions.set([point.x, point.y, point.z], (index * 4 + corner) * 3)
    out.uvs.set([u, v], (index * 4 + corner) * 2)
  })
}

const quadsMesh = (
  input: Readonly<{
    quads: ReadonlyArray<RayQuad>
    material: FlatMaterial
    isDynamic?: boolean
  }>,
): Mesh3D => {
  const { quads, material } = input
  const positions = new Float32Array(quads.length * 12)
  const uvs = new Float32Array(quads.length * 8)
  const normals = new Float32Array(quads.length * 12)
  const indices = new Uint32Array(quads.length * 6)
  Array.forEach(quads, (quad, index) => {
    writeQuad(quad, { positions, uvs }, index)
    normals.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], index * 12)
    const first = index * 4
    indices.set(
      [first, first + 2, first + 1, first, first + 3, first + 2],
      index * 6,
    )
  })
  return new Mesh3D({
    geometry: new Geometry3D({
      positions,
      normals,
      uvs,
      indices,
      ...(input.isDynamic === true ? { dynamic: true } : {}),
    }),
    material,
    castShadow: false,
    receiveShadow: false,
  })
}

const FLOOR_LIFT = 0.016

const floorQuadOf = (box: Box): RayQuad => ({
  corner: { x: box.x * UNIT, y: FLOOR_LIFT, z: zOf(box.y) },
  u: { x: box.width * UNIT, y: 0, z: 0 },
  v: { x: 0, y: 0, z: zOf(box.height) },
  across: box.width,
  along: box.height,
})

const screenRiseOf = (point: Vec3): number =>
  (point.z * Math.sin(PITCH) - point.y * Math.cos(PITCH)) / UNIT

const slopeQuadOf = (
  input: Readonly<{ from: Vec3; to: Vec3; width: number }>,
): RayQuad => {
  const { from, to, width } = input
  return {
    corner: from,
    u: { x: width * UNIT, y: 0, z: 0 },
    v: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
    across: width,
    along: Math.max(1, Math.abs(screenRiseOf(to) - screenRiseOf(from))),
  }
}

const heightOver = (level: Level, glass: Box): number => {
  const row = Math.floor((glass.y + glass.height / 2 - level.top) / TILE_SIZE)
  const column = Math.floor(
    (glass.x + glass.width / 2 - level.left) / TILE_SIZE,
  )
  return wallHeightAt({ tiles: level.tiles, row, column })
}

const SHAFT_TOP_DROP = 0.02

const shaftFootOf = (level: Level, { kind, glass, sill }: Pane): number => {
  const top = heightOver(level, glass)
  return kind === 'Side'
    ? top - SHAFT_TOP_DROP
    : Math.min(top, (sill - (glass.y + glass.height)) * WALL_ROW)
}

const shaftOf = (level: Level, pane: Pane): RayQuad => {
  const { glass, sill, thrown } = pane
  return slopeQuadOf({
    from: {
      x: glass.x * UNIT,
      y: Math.max(0, shaftFootOf(level, pane)),
      z: zOf(sill),
    },
    to: {
      x: thrown.x * UNIT,
      y: FLOOR_LIFT,
      z: zOf(thrown.y + thrown.height / 2),
    },
    width: glass.width,
  })
}

type Windows = Readonly<{
  shafts: ReadonlyArray<RayQuad>
  pools: ReadonlyArray<RayQuad>
  rose: ReadonlyArray<RayQuad>
}>

const builtWindows = new WeakMap<Level, Windows>()

const windowRaysOf = (level: Level): Windows => {
  const cached = builtWindows.get(level)
  if (cached !== undefined) {
    return cached
  }
  const panes = Array.filter(windowPanesOf(level), ({ roomId }) =>
    isRoomOpen(level, roomId),
  )
  const plain = Array.filter(panes, ({ kind }) => kind !== 'Rose')
  const rose = Array.filter(panes, ({ kind }) => kind === 'Rose')
  const windows: Windows = {
    shafts: Array.map(
      Array.filter(plain, ({ kind }) => kind === 'High'),
      pane => shaftOf(level, pane),
    ),
    pools: Array.flatMap(plain, ({ thrown }) =>
      Array.map(paneBoxesOf(thrown), floorQuadOf),
    ),
    rose: Array.flatMap(rose, pane => [
      shaftOf(level, pane),
      floorQuadOf(pane.thrown),
    ]),
  }
  builtWindows.set(level, windows)
  return windows
}

const ROSETTE_SIZE = 5
const ROSETTE_WEDGES: ReadonlyArray<string> = ['r', 'b', 'p', 'r', 'b', 'g']
const ROSETTE_HEART = 'y'
const ROSETTE_PALE = 0.3

const rosetteHexAt = (column: number, row: number): string => {
  const middle = (ROSETTE_SIZE - 1) / 2
  const dx = column - middle
  const dy = row - middle
  if (dx === 0 && dy === 0) {
    return ROSE_PALETTE[ROSETTE_HEART] ?? '#000000'
  }
  const turn = (Math.atan2(dx, -dy) / (Math.PI * 2) + 1) % 1
  const wedge = Math.floor(turn * ROSETTE_WEDGES.length)
  return ROSE_PALETTE[ROSETTE_WEDGES[wedge] ?? 'r'] ?? '#000000'
}

const roseTextureOf = (): Texture => {
  const bytes = new Uint8Array(ROSETTE_SIZE * ROSETTE_SIZE * 4)
  for (let row = 0; row < ROSETTE_SIZE; row += 1) {
    for (let column = 0; column < ROSETTE_SIZE; column += 1) {
      const value = mixColor({
        from: colorOf(rosetteHexAt(column, row)).color,
        to: 0xffffff,
        share: ROSETTE_PALE,
      })
      bytes.set(
        [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255],
        (row * ROSETTE_SIZE + column) * 4,
      )
    }
  }
  return dataTexture({ data: bytes, width: ROSETTE_SIZE, height: ROSETTE_SIZE })
}

const MOTES_PER_SHAFT = 5
const MOTE_DRIFT_MS = 9000
const MOTE_COLOR = 0xdfe8ff

const moteAt = (
  point: Vec3,
): Readonly<{ x: number; y: number; hover: number }> => {
  const rise = point.y / Math.cos(PITCH)
  return {
    x: point.x / UNIT,
    y: (point.z + Math.sin(PITCH) * rise) / (UNIT * STRETCH),
    hover: rise / UNIT - 0.5,
  }
}

const NEAR_X = 360
const NEAR_Y = 260

export const shaftMotesOf = (
  input: Readonly<{ world: World; level: Level; viewer: Vector }>,
): ReadonlyArray<Mote> => {
  const { world, level, viewer } = input
  const { shafts, rose } = windowRaysOf(level)
  const all = [...shafts, ...Array.filter(rose, (_, index) => index % 2 === 0)]
  return Array.flatMap(all, (shaft, index) => {
    const middle = moteAt(at(shaft, 0.5, 0.5))
    if (
      Math.abs(middle.x - viewer.x) > NEAR_X ||
      Math.abs(middle.y - viewer.y) > NEAR_Y
    ) {
      return []
    }
    return Array.makeBy(MOTES_PER_SHAFT, mote => {
      const roll = (use: number): number =>
        unitOf(index * 6151 + mote * 97 + use)
      const along = (world.elapsedMs / MOTE_DRIFT_MS + roll(0)) % 1
      const across =
        0.15 + roll(1) * 0.7 + Math.sin(along * 9 + roll(2) * 6) * 0.05
      return {
        ...moteAt(at(shaft, across, 0.1 + along * 0.8)),
        color: MOTE_COLOR,
        alpha: 0.35 + 0.4 * Math.sin(along * Math.PI),
        isGlowing: true,
      }
    })
  })
}

const MOON_COLOR = 0xb8c8ff
const STRIKE_COLOR = 0xf2f6ff
const SHAFT_LEVEL = 0.03
const POOL_LEVEL = 0.05
const ROSE_SHAFT_COLOR = 0xe0c8ff
const ROSE_LEVEL = 0.08
const STRIKE_FLARE = 0.1
const CANDLE_COLOR = 0xffd890
const CONE_LEVEL = 0.035
const CANDLE_POOL_LEVEL = 0.04
const BEAM_COLOR = 0xfff2d0
const BEAM_LEVEL = 0.08

const CONE_INSET_PX = 2
const POOL_REACH_PX = 6

const coneOf = (level: Level): Option.Option<ReadonlyArray<RayQuad>> =>
  Option.flatMap(gapBoxOf(level), gap =>
    Option.map(
      Array.findFirst(flameSpecsOf(level), ({ kind }) => kind === 'Chandelier'),
      flame => {
        const width = gap.right - gap.left - CONE_INSET_PX * 2
        const left = (gap.left + gap.right) / 2 - width / 2
        const floorY = (gap.top + gap.bottom) / 2
        const round = width + POOL_REACH_PX * 2
        return [
          slopeQuadOf({
            from: { x: left * UNIT, y: flame.y, z: flame.z },
            to: { x: left * UNIT, y: FLOOR_LIFT, z: zOf(floorY) },
            width,
          }),
          floorQuadOf({
            x: Math.round((gap.left + gap.right) / 2 - round / 2),
            y: Math.round(floorY - round / 2),
            width: round,
            height: round,
          }),
        ]
      },
    ),
  )

const BEAM_LENGTH_PX = 72
const BEAM_WIDTH_PX = 34
const HAND_AT = { above: 5, out: 0.8 }

const beamOf = (
  player: Readonly<{ x: number; y: number; facing: Vector }>,
): RayQuad => {
  const { facing } = player
  const length = Math.hypot(facing.x, facing.y)
  const fx = length > 0 ? facing.x / length : 1
  const fy = length > 0 ? facing.y / length : 0
  const hand = standingPointOf({
    x: player.x,
    footY: player.y,
    atY: player.y - HAND_AT.above,
    out: HAND_AT.out,
  })
  const half = BEAM_WIDTH_PX / 2
  const corner = {
    x: (player.x + fy * half) * UNIT,
    y: hand.y,
    z: hand.z - fx * half * UNIT * STRETCH,
  }
  const far = {
    x: (player.x + fx * BEAM_LENGTH_PX + fy * half) * UNIT,
    y: FLOOR_LIFT,
    z: zOf(player.y + fy * BEAM_LENGTH_PX) - fx * half * UNIT * STRETCH,
  }
  return {
    corner,
    u: {
      x: -fy * BEAM_WIDTH_PX * UNIT,
      y: 0,
      z: fx * BEAM_WIDTH_PX * UNIT * STRETCH,
    },
    v: { x: far.x - corner.x, y: far.y - corner.y, z: far.z - corner.z },
    across: BEAM_WIDTH_PX,
    along: BEAM_LENGTH_PX,
  }
}

export class GodRays {
  private readonly holder = new Container3D()
  private readonly moon = rayMaterial({ shape: 'Shaft', color: MOON_COLOR })
  private readonly pool = rayMaterial({ shape: 'Pool', color: MOON_COLOR })
  private readonly roseTexture = roseTextureOf()
  private readonly roseShaft = rayMaterial({
    shape: 'Shaft',
    color: ROSE_SHAFT_COLOR,
  })
  private readonly rosePool = rayMaterial({
    shape: 'Round',
    color: 0xffffff,
    texture: this.roseTexture,
  })
  private readonly cone = rayMaterial({ shape: 'Cone', color: CANDLE_COLOR })
  private readonly candlePool = rayMaterial({
    shape: 'Round',
    color: CANDLE_COLOR,
  })
  private readonly beamMaterial = rayMaterial({
    shape: 'Cone',
    color: BEAM_COLOR,
  })
  private readonly beam: Mesh3D
  private readonly beamPositions = new Float32Array(12)
  private readonly beamUvs = new Float32Array(8)
  private lastColor = MOON_COLOR

  constructor(input: Readonly<{ level: Level; parent: Container3D }>) {
    const { level, parent } = input
    parent.addChild(this.holder)
    const { shafts, pools, rose } = windowRaysOf(level)
    const meshes = [
      ...(shafts.length > 0
        ? [quadsMesh({ quads: shafts, material: this.moon })]
        : []),
      ...(pools.length > 0
        ? [quadsMesh({ quads: pools, material: this.pool })]
        : []),
      ...Array.map(rose, (quad, index) =>
        quadsMesh({
          quads: [quad],
          material: index % 2 === 0 ? this.roseShaft : this.rosePool,
        }),
      ),
      ...Option.match(coneOf(level), {
        onNone: () => [],
        onSome: ([shaft, round]) => [
          ...(shaft === undefined
            ? []
            : [quadsMesh({ quads: [shaft], material: this.cone })]),
          ...(round === undefined
            ? []
            : [quadsMesh({ quads: [round], material: this.candlePool })]),
        ],
      }),
    ]
    Array.forEach(meshes, mesh => {
      this.holder.addChild(mesh)
    })
    this.beam = quadsMesh({
      quads: [beamOf({ x: 0, y: 0, facing: { x: 1, y: 0 } })],
      material: this.beamMaterial,
      isDynamic: true,
    })
    this.beam.visible = false
    this.holder.addChild(this.beam)
  }

  apply(
    input: Readonly<{
      world: World
      player: Readonly<{ x: number; y: number; facing: Vector }>
      isInDark: boolean
    }>,
  ): void {
    const { world, player, isInDark } = input
    const strike = isInDark ? 0 : strikeOf(world)
    const flare = 1 + (strike * STRIKE_FLARE) / SHAFT_LEVEL
    this.moon.alpha = SHAFT_LEVEL * flare
    this.pool.alpha = POOL_LEVEL * flare
    this.roseShaft.alpha = SHAFT_LEVEL * flare
    this.rosePool.alpha = ROSE_LEVEL * Math.min(flare, 1.6)
    const color = mixColor({
      from: MOON_COLOR,
      to: STRIKE_COLOR,
      share: strike,
    })
    if (color !== this.lastColor) {
      this.lastColor = color
      this.moon.baseColor = color
      this.pool.baseColor = color
    }
    const isLit = !isChandelierDown(world)
    this.cone.alpha = isLit ? CONE_LEVEL : 0
    this.candlePool.alpha = isLit ? CANDLE_POOL_LEVEL : 0
    this.beam.visible = isInDark
    if (isInDark) {
      this.beamMaterial.alpha = BEAM_LEVEL
      writeQuad(
        beamOf(player),
        { positions: this.beamPositions, uvs: this.beamUvs },
        0,
      )
      const { geometry } = this.beam
      geometry.positions.set(this.beamPositions)
      geometry.attributes['aPosition']?.buffer.update()
    }
  }

  destroy(): void {
    this.holder.destroy({ children: true })
    Array.forEach(
      [
        this.moon,
        this.pool,
        this.roseShaft,
        this.rosePool,
        this.cone,
        this.candlePool,
        this.beamMaterial,
      ],
      material => {
        material.destroy()
      },
    )
    this.roseTexture.destroy(true)
  }
}
