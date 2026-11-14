// The house's light hung in the 3D view: each room's fill (a spot that casts
// the furniture's shadows), the flames, the cellar's dark cells, and the
// player's flashlight and pool in the dark. What each does this frame is
// worked out in src/render/iso/lightSpecs.ts; this only applies it.

import { Array, Option } from 'effect'

import { Container3D, PointLight, SpotLight } from '@pixi/3d'

import type { Level } from '../../world/level/arena'
import { CELLAR_ROOM_ID } from '../../world/level/plan'
import type { Player } from '../../world/schema/entitySchema'
import {
  DARK_CELL_INTENSITY,
  DARK_DEPTH,
  DARK_HEIGHT,
  type LightsFrame,
  darkCellsOf,
  fillSpecOf,
  flameSpecsOf,
} from './lightSpecs'
import { mixColor } from './mood'
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

export type HouseLights = Readonly<{
  apply: (frame: LightsFrame, player: Player) => void
}>

export const houseLightsOf = (
  input: Readonly<{ level: Level; parent: Container3D }>,
): HouseLights => {
  const { level, parent } = input
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
    return { fill, fullIntensity: spec.fullIntensity, color: spec.color }
  })
  const cells = Option.match(
    Array.findFirst(level.rooms, ({ id }) => id === CELLAR_ROOM_ID),
    {
      onNone: () => [],
      onSome: ({ box }) =>
        Array.map(darkCellsOf(box), cell => {
          const light = hungSpot(holder, {
            color: 0xffffff,
            intensity: DARK_CELL_INTENSITY,
            range: DARK_HEIGHT * 2,
            coneAngle: cell.coneAngle,
            penumbra: 0.12,
          })
          light.position.set(cell.x, DARK_HEIGHT, cell.z)
          light.lookAt({ x: cell.x, y: 0, z: cell.z + 0.001 })
          return light
        }),
    },
  )
  const flames = Array.map(flameSpecsOf(level), spec => {
    const light = new PointLight({
      color: spec.color,
      intensity: 0,
      range: spec.range,
    })
    light.position.set(spec.x, spec.height, spec.z)
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

  // NOTE: the mood's tint last applied, so a color is set only on a change.
  let lastTint = Number.NaN
  const apply = (frame: LightsFrame, player: Player): void => {
    const { tint, tintShare } = frame.mood
    const tintKey = tint + tintShare
    const isTintChanged = tintKey !== lastTint
    lastTint = tintKey
    Array.forEach(fills, ({ fill, fullIntensity, color }, index) => {
      const share = Option.getOrElse(
        Array.get(frame.fillShares, index),
        () => 0,
      )
      fill.intensity = share * fullIntensity
      fill.visible = share > 0
      if (isTintChanged) {
        fill.color.setValue(
          mixColor({ from: color, to: tint, share: tintShare }),
        )
      }
    })
    Array.forEach(cells, cell => {
      cell.visible = frame.isDark
    })
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
