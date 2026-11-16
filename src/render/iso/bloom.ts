// The bloom: the bright parts of the frame glowing outward, cheap on the
// GPU (owner, 2026-11-15: phones that do not get hot). @pixi/3d's own
// BloomEffect blurs through five levels, each half the last, a pass down
// and a pass up each: ten passes a frame, nine of them small, and on a
// phone's tiled GPU every pass pays to load and store its target whatever
// its size. This one keeps its bright pass, its tent upsample, and its
// combine, and steps down four times a level instead of two, so three
// levels reach the same coarsest size (a 32nd of the largest) in six
// passes. Each coarser level's share of the glow is the share the five
// levels it stands for had, so the glow keeps its core and its reach.

import { UniformGroup } from 'pixi.js'

import {
  type EffectFragment,
  type EffectIO,
  FullscreenPass,
  PostEffect,
  type RenderGraph,
  floatRgbFormat,
} from '@pixi/3d'

// NOTE: @pixi/3d's own bright pass: four taps averaged, then the soft knee
// above the threshold.
const BRIGHT_FRAGMENT: EffectFragment = {
  gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let t = inputTexel();
  let c = 0.25 * (sampleColor(uv + vec2<f32>(-t.x, -t.y)) + sampleColor(uv + vec2<f32>(t.x, -t.y))
    + sampleColor(uv + vec2<f32>(-t.x, t.y)) + sampleColor(uv + vec2<f32>(t.x, t.y)));
  let threshold = fx.uBloom.x;
  let knee = fx.uBloom.y;
  let brightness = max(c.r, max(c.g, c.b));
  var soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  let contribution = max(soft, brightness - threshold) / max(brightness, 0.00001);
  return vec4<f32>(c.rgb * contribution, 1.0);
}
`,
  gl: `
vec4 effect(vec2 uv) {
  vec2 t = inputTexel();
  vec4 c = 0.25 * (sampleColor(uv + vec2(-t.x, -t.y)) + sampleColor(uv + vec2(t.x, -t.y))
    + sampleColor(uv + vec2(-t.x, t.y)) + sampleColor(uv + vec2(t.x, t.y)));
  float threshold = uBloom.x;
  float knee = uBloom.y;
  float brightness = max(c.r, max(c.g, c.b));
  float soft = clamp(brightness - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 0.00001);
  float contribution = max(soft, brightness - threshold) / max(brightness, 0.00001);
  return vec4(c.rgb * contribution, 1.0);
}
`,
}

// NOTE: a quarter the size in one pass: a 4 by 4 grid of bilinear taps,
// each the average of 2 by 2 texels, weighted 1 3 3 1 a side, so each
// texel's weight is a tent over 8 texels (two of @pixi/3d's halvings blur
// about as wide). The output texel's middle sits on a texel corner, so a
// tap at an odd offset lands on a corner too.
const DOWN4_FRAGMENT: EffectFragment = {
  gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let t = inputTexel();
  var sum = vec3<f32>(0.0);
  for (var j = 0; j < 4; j++) {
    for (var i = 0; i < 4; i++) {
      let wx = select(3.0, 1.0, i == 0 || i == 3);
      let wy = select(3.0, 1.0, j == 0 || j == 3);
      let offset = vec2<f32>(f32(i) * 2.0 - 3.0, f32(j) * 2.0 - 3.0);
      sum += sampleColor(uv + offset * t).rgb * (wx * wy);
    }
  }
  return vec4<f32>(sum / 64.0, 1.0);
}
`,
  gl: `
vec4 effect(vec2 uv) {
  vec2 t = inputTexel();
  vec3 sum = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      float wx = (i == 0 || i == 3) ? 1.0 : 3.0;
      float wy = (j == 0 || j == 3) ? 1.0 : 3.0;
      vec2 offset = vec2(float(i) * 2.0 - 3.0, float(j) * 2.0 - 3.0);
      sum += sampleColor(uv + offset * t).rgb * (wx * wy);
    }
  }
  return vec4(sum / 64.0, 1.0);
}
`,
}

// NOTE: four times the size: a 3 by 3 tent of bilinear taps a coarse texel
// apart, weighted 1 2 1 a side, smooth where four bilinear taps alone show
// the coarse grid. It writes its share to alpha, so the 'normal' blend its
// pass sets gives mix(finer, coarser, share), as @pixi/3d's upsample does.
const UP4_FRAGMENT: EffectFragment = {
  gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let t = inputTexel();
  var sum = vec3<f32>(0.0);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let w = (2.0 - abs(f32(i))) * (2.0 - abs(f32(j)));
      sum += sampleColor(uv + vec2<f32>(f32(i), f32(j)) * t).rgb * w;
    }
  }
  let share = fx.uBloomShare.x;
  return vec4<f32>(sum / 16.0 * share, share);
}
`,
  gl: `
vec4 effect(vec2 uv) {
  vec2 t = inputTexel();
  vec3 sum = vec3(0.0);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      float w = (2.0 - abs(float(i))) * (2.0 - abs(float(j)));
      sum += sampleColor(uv + vec2(float(i), float(j)) * t).rgb * w;
    }
  }
  float share = uBloomShare.x;
  return vec4(sum / 16.0 * share, share);
}
`,
}

// NOTE: @pixi/3d's own combine: the glow added to the frame's colour,
// keeping its alpha.
const COMBINE_FRAGMENT: EffectFragment = {
  gpu: `
fn effect(uv: vec2<f32>) -> vec4<f32> {
  let base = sampleColor(uv);
  return vec4<f32>(base.rgb + sampleColor2(uv).rgb * fx.uBloomCombine.x, base.a);
}
`,
  gl: `
vec4 effect(vec2 uv) {
  vec4 base = sampleColor(uv);
  return vec4(base.rgb + sampleColor2(uv).rgb * uBloomCombine.x, base.a);
}
`,
}

// NOTE: @pixi/3d's five halvings, levels 0 to 4, end with level k's share
// of the glow (1 - radius) radius^k, the last radius^4. Ours stand at
// levels 0, 2, and 4; level 1 lies between the first two and level 3
// between the last two, so each gives half its share to either side.
// Each upsample's share is the coarser part of what is left there.
export const bloomSharesOf = (
  radius: number,
): Readonly<{ fine: number; coarse: number }> => {
  const shareAt = (level: number): number =>
    level === 4 ? radius ** 4 : (1 - radius) * radius ** level
  const first = shareAt(0) + shareAt(1) / 2
  const last = shareAt(3) / 2 + shareAt(4)
  return { fine: 1 - first, coarse: last / (1 - first) }
}

// NOTE: a level is a quarter the size of the one before it.
const STEP = 4

export type CheapBloomOptions = Readonly<{
  threshold: number
  intensity: number
  radius: number
  // NOTE: texels per logical pixel of the largest level.
  resolution: number
}>

const vec4Uniform = (name: string, first: number, second = 0): UniformGroup =>
  new UniformGroup({
    [name]: {
      value: new Float32Array([first, second, 0, 0]),
      type: 'vec4<f32>',
    },
  })

// NOTE: its uniforms are fixed once made: a tier change makes a new one
// (qualityControl.ts).
export class CheapBloomEffect extends PostEffect {
  readonly resolution: number
  private readonly brightUniforms: UniformGroup
  private readonly fineUniforms: UniformGroup
  private readonly coarseUniforms: UniformGroup
  private readonly combineUniforms: UniformGroup

  constructor(options: CheapBloomOptions) {
    super()
    const shares = bloomSharesOf(options.radius)
    this.resolution = options.resolution
    this.brightUniforms = vec4Uniform(
      'uBloom',
      options.threshold,
      options.threshold * 0.5,
    )
    this.fineUniforms = vec4Uniform('uBloomShare', shares.fine)
    this.coarseUniforms = vec4Uniform('uBloomShare', shares.coarse)
    this.combineUniforms = vec4Uniform('uBloomCombine', options.intensity)
  }

  override build(graph: RenderGraph, io: EffectIO): void {
    const { renderer } = io
    const format = graph.sceneIsLinear ? floatRgbFormat(renderer) : undefined
    const levelAt = (level: number) =>
      graph.createColor({
        resolution: this.resolution / STEP ** level,
        ...(format === undefined ? {} : { format }),
        label: `bloomLevel${level}`,
      })
    const largest = levelAt(0)
    const middle = levelAt(1)
    const smallest = levelAt(2)
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:bright',
        fragment: BRIGHT_FRAGMENT,
        uniforms: this.brightUniforms,
        reads: { color: io.input },
        writes: largest,
      }),
    )
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:down1',
        fragment: DOWN4_FRAGMENT,
        reads: { color: largest },
        writes: middle,
      }),
    )
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:down2',
        fragment: DOWN4_FRAGMENT,
        reads: { color: middle },
        writes: smallest,
      }),
    )
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:up1',
        fragment: UP4_FRAGMENT,
        uniforms: this.coarseUniforms,
        reads: { color: smallest },
        writes: middle,
        blendMode: 'normal',
      }),
    )
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:up0',
        fragment: UP4_FRAGMENT,
        uniforms: this.fineUniforms,
        reads: { color: middle },
        writes: largest,
        blendMode: 'normal',
      }),
    )
    graph.addPass(
      new FullscreenPass({
        renderer,
        label: 'bloom:combine',
        fragment: COMBINE_FRAGMENT,
        uniforms: this.combineUniforms,
        reads: { color: io.input, color2: largest },
        writes: io.output,
      }),
    )
  }
}

// NOTE: the world's bloom at a level's resolution: only what is brighter
// than 2 (the flames, the eyes, the blasts) glows, in its own colour.
export const worldBloomOf = (resolution: number): CheapBloomEffect =>
  new CheapBloomEffect({
    threshold: 2,
    intensity: 1.1,
    radius: 0.6,
    resolution,
  })
