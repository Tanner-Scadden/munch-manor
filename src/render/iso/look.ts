import { BufferImageSource, Texture } from 'pixi.js'

import type { ShaderBit } from '@pixi/3d'

import type { Level } from '#world/level/arena.ts'

import { DARK_EVEN, DARK_TAKES } from './lightSpecs.ts'
import { LOOK, LOOK_TUNING, type LookSpecs } from './lookSpecs.ts'
import {
  BRIGHTEST_RANGE,
  CUT_RANGE,
  RAMP_COLUMNS,
  ROOM_MAP,
  rampRowsOf,
  rampTexelsOf,
  roomTexelsOf,
} from './lookTexels.ts'
import { PITCH, STRETCH, UNIT } from './space.ts'

export const glFloat = (value: number): string =>
  Number.isInteger(value) ? value.toFixed(1) : `${value}`

const RAMP_ROWS = rampRowsOf(LOOK)

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
  uprightBack: glFloat(UNIT / 2),
  mapColumn: glFloat(ROOM_MAP.column),
  mapRow: glFloat(ROOM_MAP.row),
  mapColumns: glFloat(ROOM_MAP.columns),
  mapRows: glFloat(ROOM_MAP.rows),
  dark: glFloat(DARK_TAKES),
  darkEven: glFloat(DARK_EVEN),
}

export const GL_HEADER = `
float lookBayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
float lookBayer4(vec2 a) {
  return lookBayer2(0.5 * a) * 0.25 + lookBayer2(a);
}
`

export const GPU_HEADER = `
fn lookBayer2(b: vec2<f32>) -> f32 {
  let a = floor(b);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}
fn lookBayer4(a: vec2<f32>) -> f32 {
  return lookBayer2(0.5 * a) * 0.25 + lookBayer2(a);
}
`

const glCut = (glow: string, look: Look): string => {
  const c = CONSTANTS
  const { isStanding } = look
  return `{
  vec3 lookGlow = ${glow};
  vec2 lookTile = floor(vec2(vPosition.x, ${footOf('vPosition', look.foot)}));
  vec2 lookRoomUv = (lookTile - vec2(${c.mapColumn}, ${c.mapRow}) + 0.5) / vec2(${c.mapColumns}, ${c.mapRows});
  vec4 lookRoom = sampleLookRoomsDirect(lookRoomUv);
  float lookSlot = floor(lookRoom.r * 255.0 + 0.5);
  float lookDark = step(0.5, lookRoom.g) * ${isStanding ? `(${c.darkEven} + (${c.dark} - ${c.darkEven}) * max(normal.y, 0.0))` : c.dark};
  vec3 lookMask = step(vec3(0.002), albedo);
  vec3 lookLit = max(max(finalColor - lookGlow, vec3(0.0)) / max(albedo, vec3(0.002)) - lookDark, vec3(0.0)) * lookMask;
  float lookLevel = max(max(lookLit.r, lookLit.g), lookLit.b);
  vec3 lookLight = lookLit + (1.0 - lookMask) * lookLevel;
  vec3 lookP0 = sampleLookRampsDirect(vec2(0.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  vec3 lookP1 = sampleLookRampsDirect(vec2(1.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  float lookSteps = max(1.0, floor(lookP0.r * 255.0 + 0.5));
  float lookCut = lookP0.b * ${c.cutRange};
  float lookBright = max(lookP1.g * ${c.brightRange}, lookCut + 0.01);
  vec2 lookPixel = vec2(vPosition.x, vPosition.z * ${c.sinPitch} - vPosition.y * ${c.cosPitch}) / ${c.unit};
  float lookShift = ${look.foot === 'BehindTheFront' ? 'abs(normal.x) > 0.5 ? 0.5 : ' : ''}mix(0.5, lookBayer4(lookPixel) + 0.03125, lookP0.g);
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

const gpuCut = (glow: string, look: Look): string => {
  const c = CONSTANTS
  const { isStanding } = look
  return `{
  let lookGlow = ${glow};
  let lookAt = input.vPosition;
  let lookTile = floor(vec2<f32>(lookAt.x, ${footOf('lookAt', look.foot)}));
  let lookRoomUv = (lookTile - vec2<f32>(${c.mapColumn}, ${c.mapRow}) + 0.5) / vec2<f32>(${c.mapColumns}, ${c.mapRows});
  let lookRoom = sampleLookRoomsDirect(lookRoomUv);
  let lookSlot = floor(lookRoom.r * 255.0 + 0.5);
  let lookDark = step(0.5, lookRoom.g) * ${isStanding ? `(${c.darkEven} + (${c.dark} - ${c.darkEven}) * max(normal.y, 0.0))` : c.dark};
  let lookMask = step(vec3<f32>(0.002), albedo);
  let lookLit = max(max(finalColor - lookGlow, vec3<f32>(0.0)) / max(albedo, vec3<f32>(0.002)) - lookDark, vec3<f32>(0.0)) * lookMask;
  let lookLevel = max(max(lookLit.r, lookLit.g), lookLit.b);
  let lookLight = lookLit + (1.0 - lookMask) * lookLevel;
  let lookP0 = sampleLookRampsDirect(vec2<f32>(0.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  let lookP1 = sampleLookRampsDirect(vec2<f32>(1.5 / ${c.columns}, 0.5 / ${c.rows})).rgb;
  let lookSteps = max(1.0, floor(lookP0.r * 255.0 + 0.5));
  let lookCut = lookP0.b * ${c.cutRange};
  let lookBright = max(lookP1.g * ${c.brightRange}, lookCut + 0.01);
  let lookPixel = vec2<f32>(lookAt.x, lookAt.z * ${c.sinPitch} - lookAt.y * ${c.cosPitch}) / ${c.unit};
  let lookShift = ${look.foot === 'BehindTheFront' ? 'select(mix(0.5, lookBayer4(lookPixel) + 0.03125, lookP0.g), 0.5, abs(normal.x) > 0.5)' : 'mix(0.5, lookBayer4(lookPixel) + 0.03125, lookP0.g)'};
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

type Look = Readonly<{ isStanding: boolean; foot: Foot }>

type Foot = 'DownTheView' | 'Under' | 'BehindTheFront'

const footOf = (at: string, foot: Foot): string => {
  const c = CONSTANTS
  const rows = `${at}.z / ${c.stretch}`
  return {
    DownTheView: `(${at}.z + ${at}.y * ${c.tanPitch}) / ${c.stretch}`,
    Under: rows,
    BehindTheFront: `${rows} - ${c.uprightBack}`,
  }[foot]
}

const bitOf = (
  input: Readonly<{ name: string; glow: GlowOf; look: Look }>,
): ShaderBit => ({
  name: input.name,
  textures: TEXTURES,
  gpu: {
    header: GPU_HEADER,
    fragment: { lobePostLighting: gpuCut(input.glow.gpu, input.look) },
  },
  gl: {
    header: GL_HEADER,
    fragment: { lobePostLighting: glCut(input.glow.gl, input.look) },
  },
})

type GlowOf = Readonly<{ gpu: string; gl: string }>

const EMISSIVE: GlowOf = { gpu: 'emissive', gl: 'emissive' }
const NO_GLOW: GlowOf = { gpu: 'vec3<f32>(0.0)', gl: 'vec3(0.0)' }

export type LookKind = 'Standing' | 'Upright' | 'House' | 'Toon'

const PLANE: Look = { isStanding: false, foot: 'Under' }

const LOOK_BITS: Readonly<Record<LookKind, ShaderBit>> = {
  Standing: bitOf({
    name: 'munchLookStanding',
    glow: EMISSIVE,
    look: { isStanding: true, foot: 'DownTheView' },
  }),
  Upright: bitOf({
    name: 'munchLookUpright',
    glow: EMISSIVE,
    look: { isStanding: true, foot: 'BehindTheFront' },
  }),
  House: bitOf({ name: 'munchLookHouse', glow: EMISSIVE, look: PLANE }),
  Toon: bitOf({ name: 'munchLookToon', glow: NO_GLOW, look: PLANE }),
}

export type LookOptions = Readonly<{
  extraBits?: ReadonlyArray<ShaderBit>
  textures?: Record<string, Texture>
}>

export const dataTexture = ({
  data,
  width,
  height,
}: Readonly<{ data: Uint8Array; width: number; height: number }>): Texture =>
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

export class LookTextures {
  private readonly ramps: Texture
  private readonly rooms: Texture
  private readonly rampBytes: Uint8Array
  private readonly roomBytes: Uint8Array
  private lastLevel: Level | undefined
  private lastIsDark = false
  private lastSpecs: LookSpecs = LOOK

  constructor() {
    this.rampBytes = rampTexelsOf(LOOK)
    this.ramps = dataTexture({
      data: this.rampBytes,
      width: RAMP_COLUMNS,
      height: RAMP_ROWS,
    })
    this.roomBytes = new Uint8Array(ROOM_MAP.columns * ROOM_MAP.rows * 4)
    this.rooms = dataTexture({
      data: this.roomBytes,
      width: ROOM_MAP.columns,
      height: ROOM_MAP.rows,
    })
  }

  paintRooms(level: Level, isDark: boolean): void {
    const specs = LOOK_TUNING.now
    const isNewSpecs = specs !== this.lastSpecs
    if (level === this.lastLevel && isDark === this.lastIsDark && !isNewSpecs) {
      return
    }
    if (isNewSpecs) {
      this.lastSpecs = specs
      this.rampBytes.set(rampTexelsOf(specs))
      this.ramps.source.update()
    }
    this.lastLevel = level
    this.lastIsDark = isDark
    this.roomBytes.set(roomTexelsOf({ specs, level, isDark }))
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
