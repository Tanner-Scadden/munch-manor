// The house's light hung in the 3D view: each room's fill (a spot that casts
// the furniture's shadows), the flames, and the player's flashlight and pool
// in the cellar's dark (the dark itself is the look pass's, on the cellar's
// tiles: src/render/iso/look.ts). What each does this frame is
// worked out in src/render/iso/lightSpecs.ts; this only applies it.

import { Array, Option } from 'effect'

import { Container3D, PointLight, SpotLight } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import type { Player } from '../../world/schema/entitySchema'
import { type ViewBox, type ViewFloor, isOnFloorSeen } from './cull'
import {
  DARK_DEPTH,
  DARK_HEIGHT,
  FLAME_TUNING,
  type FlameLooks,
  type LightsFrame,
  fillSpecOf,
  flameSpecsOf,
} from './lightSpecs'
import { mixColor } from './mood'
import { ShadowBudget } from './shadowBudget'
import type { ShadowWatch } from './shadowWatch'
import { STRETCH, UNIT, zOf } from './space'

// NOTE: the player's flashlight in the dark: the 2D beam was 120 px long and
// pi/7 either side, so the spot sits at the player's chest and aims at the
// floor a beam's length on.
const BEAM_LENGTH = 120 * UNIT
const BEAM_CONE = 180 / 7
const BEAM_HEIGHT = 2.2
const POOL_PX = 46

const hungSpot = (
  parent: Container3D,
  options: ConstructorParameters<typeof SpotLight>[0],
): SpotLight => {
  const light = new SpotLight(options)
  parent.addChild(light)
  return light
}

type LightsInput = Readonly<{
  frame: LightsFrame
  player: Player
  // NOTE: the floor the camera shows (cull.ts).
  floor: ViewFloor
}>

export type HouseLights = Readonly<{
  apply: (input: LightsInput) => void
}>

// NOTE: how far a point on the map lies from a box, in game pixels: none
// inside it.
const distanceToBox = (box: ViewBox, x: number, y: number): number =>
  Math.hypot(
    Math.max(box.left - x, 0, x - box.right),
    Math.max(box.top - y, 0, y - box.bottom),
  )

export const houseLightsOf = (
  input: Readonly<{ level: Level; parent: Container3D; watch: ShadowWatch }>,
): HouseLights => {
  const { level, parent, watch } = input
  const holder = new Container3D()
  parent.addChild(holder)
  const fills = Array.map(level.rooms, room => {
    const spec = fillSpecOf(room)
    const fill = hungSpot(holder, {
      color: spec.color,
      intensity: 0,
      range: spec.range,
      coneAngle: spec.coneAngle,
      penumbra: 0.3,
      castShadow: true,
    })
    fill.position.set(spec.from.x, spec.from.y, spec.from.z)
    fill.lookAt(spec.to)
    // NOTE: drawn again only when its casters change (shadowWatch.ts).
    fill.shadow.update = 'manual'
    return { fill, spec }
  })
  watch.watch(Array.map(fills, ({ spec }) => spec))
  // NOTE: the fills casting last frame. The shadow pass hands out its map's
  // layers by order among the casting lights, so when one starts or stops,
  // every casting fill draws its map again into the layer it now has.
  let lastCasting: ReadonlyArray<boolean> = []
  // NOTE: which fills' maps are drawn this frame, at most two in a wave
  // (shadowBudget.ts).
  const budget = new ShadowBudget()
  const specs = flameSpecsOf(level)
  const flames = Array.map(specs, spec => {
    const { color, range } = FLAME_TUNING.now[spec.kind]
    const light = new PointLight({ color, intensity: 0, range })
    light.position.set(spec.x, spec.y, spec.z)
    holder.addChild(light)
    return light
  })
  const flashlight = hungSpot(holder, {
    color: 0xfff4d8,
    intensity: 0,
    range: BEAM_LENGTH * 1.6,
    coneAngle: BEAM_CONE,
    penumbra: 0.35,
  })
  // NOTE: the pool round the player: a spot from far overhead, so it falls
  // as an even disc.
  const pool = hungSpot(holder, {
    color: 0xffe6c0,
    intensity: (DARK_DEPTH + 0.75) * Math.PI * DARK_HEIGHT * DARK_HEIGHT,
    range: DARK_HEIGHT * 2,
    coneAngle: (Math.atan((POOL_PX * UNIT) / DARK_HEIGHT) * 180) / Math.PI,
    penumbra: 0.45,
  })

  // NOTE: the mood's tint last applied, so a color is set only on a change,
  // and the flames' looks, set again only when Munch Studio's lab hands
  // the renderer new ones.
  let lastTint = Number.NaN
  let lastLooks: FlameLooks = FLAME_TUNING.now
  const apply = ({ frame, player, floor }: LightsInput): void => {
    const { tint, tintShare } = frame.mood
    const tintKey = tint + tintShare
    const isTintChanged = tintKey !== lastTint
    lastTint = tintKey
    const shares = Array.map(fills, (_, index) =>
      Option.getOrElse(Array.get(frame.fillShares, index), () => 0),
    )
    // NOTE: a fill off screen keeps its light (the screen's tiles drop it
    // for free), but a casting light draws the whole house into its
    // shadow map, seen or not. Its cone lights only its pool, so it casts
    // only while its pool lies on the floor seen.
    const casting = Array.map(
      fills,
      ({ spec }, index) =>
        (shares[index] ?? 0) > 0 && isOnFloorSeen(spec.pool, floor),
    )
    const isCastingChanged =
      casting.length !== lastCasting.length ||
      !Array.every(casting, (isOn, index) => isOn === lastCasting[index])
    lastCasting = casting
    // NOTE: the casting fill whose pool lies nearest the player draws on
    // every frame it changes; the rest wait their turn.
    let first = -1
    let nearest = Number.POSITIVE_INFINITY
    Array.forEach(fills, ({ spec }, index) => {
      const distance = distanceToBox(spec.pool, player.x, player.y)
      if (casting[index] === true && distance < nearest) {
        first = index
        nearest = distance
      }
    })
    const drawn = budget.pick({
      casting,
      isChanged: index => watch.isChanged(index),
      first,
      isEvery: isCastingChanged,
    })
    Array.forEach(fills, ({ fill, spec }, index) => {
      const share = shares[index] ?? 0
      fill.intensity = share * spec.fullIntensity
      fill.visible = share > 0
      fill.castShadow = casting[index] === true
      if (drawn[index] === true) {
        fill.refreshShadows()
      }
      if (isTintChanged) {
        fill.color.setValue(
          mixColor({ from: spec.color, to: tint, share: tintShare }),
        )
      }
    })
    const looks = FLAME_TUNING.now
    if (looks !== lastLooks) {
      lastLooks = looks
      Array.forEach(flames, (light, index) => {
        Option.map(Array.get(specs, index), ({ kind }) => {
          light.color.setValue(looks[kind].color)
          light.range = looks[kind].range
        })
      })
    }
    Array.forEach(flames, (light, index) => {
      Option.match(Array.get(frame.flames, index), {
        onNone: () => {
          light.visible = false
        },
        onSome: flame => {
          light.visible = flame.isShown
          light.position.x = flame.x
          light.intensity = flame.intensity
        },
      })
    })
    flashlight.visible = frame.isInDark
    pool.visible = frame.isInDark
    if (frame.isInDark) {
      const px = player.x * UNIT
      const pz = zOf(player.y)
      const reach = BEAM_LENGTH * 0.55
      flashlight.position.set(px, BEAM_HEIGHT, pz)
      flashlight.lookAt({
        x: px + player.facing.x * reach,
        y: 0,
        z: pz + player.facing.y * reach * STRETCH,
      })
      // NOTE: bright as the room's own light halfway down the beam, where it
      // strikes the floor at a slant.
      const slant = Math.hypot(BEAM_HEIGHT, reach)
      flashlight.intensity =
        ((DARK_DEPTH + 1) * Math.PI * slant * slant * slant) / BEAM_HEIGHT
      pool.position.set(px, DARK_HEIGHT, pz)
      pool.lookAt({ x: px, y: 0, z: pz + 0.001 })
    }
  }

  return { apply }
}
