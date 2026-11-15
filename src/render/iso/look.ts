// The look pass on the GPU, the house's look: it cuts the 3D light into
// a room's dithered bands of color (the tunables in src/render/iso/lookSpecs.ts,
// their bytes in src/render/iso/lookTexels.ts). `?oldlook` in the address turns it
// off, and the house draws as before, to compare.
//
// The cut is one shader bit on every lit material, after the lights are
// summed. The light alone is read back out of the lit color (the lit color
// over the art's own, the glow taken off first), so the sprites' and the
// floor's own colors are never banded, only the light on them. The dither is
// a 4x4 Bayer matrix on whole game pixels, counted on the world's own grid
// (the floor's texels, a billboard's pixels up the camera), so it lands on
// the art's pixels and never crawls as the camera moves. Each pixel finds its
// room by the tile its foot stands on: a billboard's or a wall's height is
// slid back down the camera's view to the floor first.
//
// Its cost is two small texture reads and a few lines of math a pixel, after
// the lights: no loop and no new pass.

import { BufferImageSource, Texture } from 'pixi.js'

import type { ShaderBit } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import { LOOK } from './lookSpecs'
import {
  BRIGHTEST_RANGE,
  CUT_RANGE,
  RAMP_COLUMNS,
  ROOM_MAP,
  rampRowsOf,
  rampTexelsOf,
  roomTexelsOf,
} from './lookTexels'
import { PITCH, STRETCH, UNIT } from './space'

export const IS_LOOK = !new URLSearchParams(window.location.search).has(
  'oldlook',
)

// NOTE: the void behind the house under the look: black.
export const LOOK_BACKGROUND = 0x000000

// NOTE: a number as GLSL and WGSL read a float, with its point.
const glFloat = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : `${value}`

const RAMP_ROWS = rampRowsOf(LOOK)

// NOTE: the numbers the shader is written around, from the space and the
// textures' layout.
const CONSTANTS = {
  columns: glFloat(RAMP_COLUMNS),
  rows: glFloat(RAMP_ROWS),
  cutRange: glFloat(CUT_RANGE),
  brightRange: glFloat(BRIGHTEST_RANGE),
  tanPitch: glFloat(Math.tan(PITCH)),
  stretch: glFloat(STRETCH),
  sinPitch: glFloat(Math.sin(PITCH)),
  cosPitch: glFloat(Math.cos(PITCH)),
  unit: glFloat(UNIT),
  mapColumn: glFloat(ROOM_MAP.column),
  mapRow: glFloat(ROOM_MAP.row),
  mapColumns: glFloat(ROOM_MAP.columns),
  mapRows: glFloat(ROOM_MAP.rows),
}

const GL_HEADER = `
float lookBayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float lookBayer4(vec2 a) {
  return lookBayer2(0.5 * a) * 0.25 + lookBayer2(a);
}
`

const GPU_HEADER = `
fn lookBayer2(b: vec2<f32>) -> f32 {
  let a = floor(b);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
fn lookBayer4(a: vec2<f32>) -> f32 {
  return lookBayer2(0.5 * a) * 0.25 + lookBayer2(a);
}
`

// NOTE: the cut, after the lights. `glow` is what the material glows of
// itself, kept whole.
const glCut = (glow: string, isStanding: boolean): string => {
  const c = CONSTANTS
  return `{
  vec3 lookGlow = ${glow};
  vec3 lookMask = step(vec3(0.002), albedo);
  vec3 lookLit = max(finalColor - lookGlow, vec3(0.0)) / max(albedo, vec3(0.002)) * lookMask;
  float lookLevel = max(max(lookLit.r, lookLit.g), lookLit.b);
  vec3 lookLight = lookLit + (1.0 - lookMask) * lookLevel;
  vec3 lookP0 = sampleLookRampsDirect(vec2(0.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  vec3 lookP1 = sampleLookRampsDirect(vec2(1.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  float lookSteps = max(1.0, floor(lookP0.r * 255.0 + 0.5));
  float lookCut = lookP0.b * ${c.cutRange};
  float lookBright = max(lookP1.g * ${c.brightRange}, lookCut + 0.01);
  vec2 lookTile = floor(vec2(vPosition.x, (vPosition.z${isStanding ? ` + vPosition.y * ${c.tanPitch}` : ''}) / ${c.stretch}));
  vec2 lookRoomUv = (lookTile - vec2(${c.mapColumn}, ${c.mapRow}) + 0.5) / vec2(${c.mapColumns}, ${c.mapRows});
  float lookSlot = floor(sampleLookRoomsDirect(lookRoomUv).r * 255.0 + 0.5);
  vec2 lookPixel = vec2(vPosition.x, vPosition.z * ${c.sinPitch} - vPosition.y * ${c.cosPitch}) / ${c.unit};
  float lookShift = mix(0.5, lookBayer4(lookPixel) + 0.03125, lookP0.g);
  float lookP = sqrt(clamp((lookLevel - lookCut) / (lookBright - lookCut), 0.0, 1.0));
  float lookBand = lookLevel < lookCut ? 0.0 : clamp(floor(lookP * lookSteps + lookShift), 0.0, lookSteps);
  vec3 lookRamp = sampleLookRampsDirect(vec2((lookBand + 0.5) / ${c.columns}, (lookSlot + 1.5) / ${c.rows})).rgb;
  lookRamp = lookRamp * lookRamp * (0.2 + 0.8 * lookRamp);
  vec3 lookHue = lookLight / max(lookLevel, 0.0001);
  float lookQ = lookBand / lookSteps;
  float lookOut = lookBand < 0.5 ? 0.0 : mix(lookCut, lookBright, lookQ * lookQ);
  finalColor = albedo * lookRamp * mix(vec3(1.0), lookHue, lookP1.r) * lookOut + lookGlow;
}`
}

const gpuCut = (glow: string, isStanding: boolean): string => {
  const c = CONSTANTS
  return `{
  let lookGlow = ${glow};
  let lookMask = step(vec3<f32>(0.002), albedo);
  let lookLit = max(finalColor - lookGlow, vec3<f32>(0.0)) / max(albedo, vec3<f32>(0.002)) * lookMask;
  let lookLevel = max(max(lookLit.r, lookLit.g), lookLit.b);
  let lookLight = lookLit + (1.0 - lookMask) * lookLevel;
  let lookP0 = sampleLookRampsDirect(vec2<f32>(0.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  let lookP1 = sampleLookRampsDirect(vec2<f32>(1.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  let lookSteps = max(1.0, floor(lookP0.r * 255.0 + 0.5));
  let lookCut = lookP0.b * ${c.cutRange};
  let lookBright = max(lookP1.g * ${c.brightRange}, lookCut + 0.01);
  let lookAt = input.vPosition;
  let lookTile = floor(vec2<f32>(lookAt.x, (lookAt.z${isStanding ? ` + lookAt.y * ${c.tanPitch}` : ''}) / ${c.stretch}));
  let lookRoomUv = (lookTile - vec2<f32>(${c.mapColumn}, ${c.mapRow}) + 0.5) / vec2<f32>(${c.mapColumns}, ${c.mapRows});
  let lookSlot = floor(sampleLookRoomsDirect(lookRoomUv).r * 255.0 + 0.5);
  let lookPixel = vec2<f32>(lookAt.x, lookAt.z * ${c.sinPitch} - lookAt.y * ${c.cosPitch}) / ${c.unit};
  let lookShift = mix(0.5, lookBayer4(lookPixel) + 0.03125, lookP0.g);
  let lookP = sqrt(clamp((lookLevel - lookCut) / (lookBright - lookCut), 0.0, 1.0));
  let lookBand = select(clamp(floor(lookP * lookSteps + lookShift), 0.0, lookSteps), 0.0, lookLevel < lookCut);
  let lookRaw = sampleLookRampsDirect(vec2<f32>((lookBand + 0.5) / ${c.columns}, (lookSlot + 1.5) / ${c.rows})).rgb;
  let lookRamp = lookRaw * lookRaw * (0.2 + 0.8 * lookRaw);
  let lookHue = lookLight / max(lookLevel, 0.0001);
  let lookQ = lookBand / lookSteps;
  let lookOut = select(mix(lookCut, lookBright, lookQ * lookQ), 0.0, lookBand < 0.5);
  finalColor = albedo * lookRamp * mix(vec3<f32>(1.0), lookHue, lookP1.r) * lookOut + lookGlow;
}`
}

const TEXTURES = ['lookRamps', 'lookRooms']

// NOTE: the three bits: what stands (billboards and bodies of blocks, its
// room read at its foot, down the camera's up), the house's lit planes (the
// floor and the walls' art, straight down), and the walls' toon blocks,
// which glow of nothing.
const bitOf = (
  input: Readonly<{ name: string; glow: GlowOf; isStanding: boolean }>,
): ShaderBit => ({
  name: input.name,
  textures: TEXTURES,
  gpu: {
    header: GPU_HEADER,
    fragment: { lobePostLighting: gpuCut(input.glow.gpu, input.isStanding) },
  },
  gl: {
    header: GL_HEADER,
    fragment: { lobePostLighting: glCut(input.glow.gl, input.isStanding) },
  },
})

type GlowOf = Readonly<{ gpu: string; gl: string }>

const EMISSIVE: GlowOf = { gpu: 'emissive', gl: 'emissive' }
const NO_GLOW: GlowOf = { gpu: 'vec3<f32>(0.0)', gl: 'vec3(0.0)' }

export type LookKind = 'Standing' | 'House' | 'Toon'

const LOOK_BITS: Readonly<Record<LookKind, ShaderBit>> = {
  Standing: bitOf({
    name: 'munchLookStanding',
    glow: EMISSIVE,
    isStanding: true,
  }),
  House: bitOf({ name: 'munchLookHouse', glow: EMISSIVE, isStanding: false }),
  Toon: bitOf({ name: 'munchLookToon', glow: NO_GLOW, isStanding: false }),
}

export type LookOptions = Readonly<{
  extraBits?: ReadonlyArray<ShaderBit>
  textures?: Record<string, Texture>
}>

const dataTexture = (
  data: Uint8Array,
  width: number,
  height: number,
): Texture =>
  new Texture({
    source: new BufferImageSource({
      resource: data,
      width,
      height,
      format: 'rgba8unorm',
      scaleMode: 'nearest',
      autoGenerateMipmaps: false,
      alphaMode: 'no-premultiply-alpha',
    }),
  })

// NOTE: mutable on purpose: it owns the two textures every lit material
// shares, the room map painted again as rooms open.
export class LookTextures {
  private readonly ramps: Texture
  private readonly rooms: Texture
  private readonly roomBytes: Uint8Array
  private lastLevel: Level | undefined

  constructor() {
    this.ramps = dataTexture(rampTexelsOf(LOOK), RAMP_COLUMNS, RAMP_ROWS)
    this.roomBytes = new Uint8Array(ROOM_MAP.columns * ROOM_MAP.rows * 4)
    this.rooms = dataTexture(this.roomBytes, ROOM_MAP.columns, ROOM_MAP.rows)
  }

  // NOTE: each room's slot, again only for a new level (an exit opened).
  paintRooms(level: Level): void {
    if (level === this.lastLevel) {
      return
    }
    this.lastLevel = level
    this.roomBytes.set(roomTexelsOf({ specs: LOOK, level }))
    this.rooms.source.update()
  }

  optionsFor(kind: LookKind): LookOptions {
    return {
      extraBits: [LOOK_BITS[kind]],
      textures: { lookRamps: this.ramps, lookRooms: this.rooms },
    }
  }

  destroy(): void {
    this.ramps.destroy(true)
    this.rooms.destroy(true)
  }
}
