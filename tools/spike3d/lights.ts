// The 3D spike's lighting: each room its own colored light, the house's
// flames flickering (candelabras, the hearth and its sconces, the ovens, the
// chandelier), and the cellar truly dark, cut by the player's flashlight.
//
// Light follows the game's state and nothing else: which rooms are open,
// whether the chandelier hangs, whether the cellar's bulb burns, where the
// player stands and faces. The flicker is a sum of sines over elapsedMs, so a
// replay flickers the same. The renderer never writes the Model.
//
// A view shades at most 32 lights. The rooms' own lights and the cellar's
// dark always shine; the flames nearest the player take what is left.

import { Container3D, PointLight, SpotLight } from '@pixi/3d'
import { Option } from 'effect'

import type { Model } from '@game/app/model'
import { coverBlocks } from '@game/render/room/roomCover'
import { isCellarLit } from '@game/world/cellar/bulb'
import {
  CHANDELIER_RULES,
  gapBoxOf,
  isChandelierDown,
} from '@game/world/dining/chandelier'
import type { Level } from '@game/world/level/arena'
import { CELLAR_ROOM_ID } from '@game/world/level/plan'
import { focusOf } from '@game/world/party/party'
import { stationCenterOf } from '@game/world/stations/stationSpots'

import { STRETCH, UNIT, zOf } from './space'

// NOTE: what lights a spot where no lamp reaches, as a share of the art's own
// color (lit surfaces divide light by pi). Low, so each room's light and
// each flame reads as a pool.
export const AMBIENT = 0.2 * Math.PI

const MAX_LIGHTS = 32

// NOTE: each room's light: its color, and how bright its middle is, as a
// share of the art's own color over the ambient.
const ROOM_TINTS: Readonly<Record<string, number>> = {
  Parlour: 0xffd6a0,
  Dining: 0xffe2b4,
  Kitchen: 0xfff0d8,
  Library: 0xd4f0c0,
  [CELLAR_ROOM_ID]: 0xb8c4ff,
}
const OPEN_FILL = 0.4
const SHUT_FILL = 0.08
// NOTE: how much light the cellar's dark takes away: the ambient and the
// room's own light, and a third more, so it stays black past the edges of
// the player's lights.
const DARK_DEPTH = (AMBIENT / Math.PI + OPEN_FILL) * 1.35

// NOTE: a room's light hangs high over its middle and a little to the
// north-west, as if through a skylight, so it falls nearly even across the
// floor and each piece of furniture casts a short shadow south-east,
// toward the lens, where it shows.
const fillHeightOf = (halfDiagonal: number): number =>
  Math.max(8, halfDiagonal * 1.6)
const FILL_FROM = { x: -0.1, z: -0.2 }
// NOTE: a spot's floor lands about a third as bright as the inverse square
// says (its cone's falloff and the range's window), measured off the screen
// in linear color, so the fill is scaled up to the share it is meant to give.
const FILL_GAIN = 3.2

// A FLAME

type Flame = Readonly<{
  light: PointLight
  x: number
  z: number
  intensity: number
  seed: number
  // NOTE: whether it burns now; the chandelier's and the bulb's change.
  isLit: (model: Model) => boolean
  // NOTE: how far it sways off its spot now, in units (the chandelier).
  swayOf: ((t: number) => number) | undefined
  height: number
}>

const flickerAt = (t: number, seed: number): number =>
  1 +
  0.1 * Math.sin(t * 9.1 + seed) +
  0.07 * Math.sin(t * 15.7 + seed * 2.3) +
  0.05 * Math.sin(t * 27.3 + seed * 4.1)

type FlameSpec = Readonly<{
  x: number
  y: number
  height: number
  color: number
  intensity: number
  range: number
  isLit?: (model: Model) => boolean
  swayOf?: (t: number) => number
  isSteady?: boolean
}>

const centerFoot = (box: Readonly<{ x: number; y: number; width: number; height: number }>) => ({
  x: box.x + box.width / 2,
  y: box.y + box.height,
})

const flameSpecsOf = (level: Level): ReadonlyArray<FlameSpec> => {
  const candles = coverBlocks(level, 'i').map(box => ({
    ...centerFoot(box),
    height: 1.5,
    color: 0xffb35a,
    intensity: 11,
    range: 6,
  }))
  const hearths = coverBlocks(level, 'F').flatMap(box => [
    {
      x: box.x + box.width / 2,
      y: box.y + box.height + 4,
      height: 0.55,
      color: 0xff7a2e,
      intensity: 22,
      range: 8,
    },
    // NOTE: the sconces either side of the hearth (sconceShapes).
    {
      x: box.x - 18 + 3,
      y: box.y + 2,
      height: 1.3,
      color: 0xffc070,
      intensity: 3.5,
      range: 4,
    },
    {
      x: box.x + box.width + 16 + 3,
      y: box.y + 2,
      height: 1.3,
      color: 0xffc070,
      intensity: 3.5,
      range: 4,
    },
  ])
  const ovens = coverBlocks(level, 'G').map(box => ({
    ...centerFoot(box),
    y: box.y + box.height + 2,
    height: 0.45,
    color: 0xff5a2a,
    intensity: 7,
    range: 4.5,
  }))
  const chandelier = Option.match(gapBoxOf(level), {
    onNone: () => [],
    onSome: gap => [
      {
        x: (gap.left + gap.right) / 2,
        y: gap.top - CHANDELIER_RULES.hungRisePx,
        height: 2.4,
        color: 0xffd890,
        intensity: 26,
        range: 9,
        isLit: (model: Model) => !isChandelierDown(model),
        swayOf: (t: number) => Math.sin(t * 1.3) * 0.06,
      },
    ],
  })
  const bulb = Option.match(stationCenterOf(level, 'Bulb'), {
    onNone: () => [],
    onSome: center => [
      {
        x: center.x,
        y: center.y,
        height: 2.2,
        color: 0xfff0c8,
        intensity: 36,
        range: 12,
        isLit: (model: Model) => isCellarLit(model),
        swayOf: (t: number) => Math.sin(t * 2.1) * 0.05,
        isSteady: true,
      },
    ],
  })
  return [...candles, ...hearths, ...ovens, ...chandelier, ...bulb]
}

// A ROOM

type RoomLight = Readonly<{
  id: string
  fill: SpotLight
  // NOTE: the dark's cells: spots that take light away (a negative
  // intensity), each straight down over a square of the room. Only the
  // cellar has them.
  dark: ReadonlyArray<Readonly<{ light: SpotLight; intensity: number }>>
  fillIntensity: number
}>

const DARK_HEIGHT = 30

const roomLightOf = (
  parent: Container3D,
  room: Level['rooms'][number],
): RoomLight => {
  const { left, top, right, bottom } = room.box
  const x = ((left + right) / 2) * UNIT
  const z = zOf((top + bottom) / 2)
  const halfWidth = ((right - left) / 2) * UNIT
  const halfDepth = zOf(bottom - top) / 2
  const halfDiagonal = Math.hypot(halfWidth, halfDepth)
  const height = fillHeightOf(halfDiagonal)
  const from = {
    x: x + FILL_FROM.x * height,
    y: height,
    z: z + FILL_FROM.z * height,
  }
  const axis = { x: x - from.x, y: -from.y, z: z - from.z }
  const reach = Math.hypot(axis.x, axis.y, axis.z)
  // NOTE: the cone just takes in the room's four corners.
  const corners = [
    { x: left * UNIT, z: zOf(top) },
    { x: right * UNIT, z: zOf(top) },
    { x: left * UNIT, z: zOf(bottom) },
    { x: right * UNIT, z: zOf(bottom) },
  ].map(corner => {
    const to = { x: corner.x - from.x, y: -from.y, z: corner.z - from.z }
    const length = Math.hypot(to.x, to.y, to.z)
    const cos = (to.x * axis.x + to.y * axis.y + to.z * axis.z) / (length * reach)
    return { angle: Math.acos(Math.min(1, cos)), length }
  })
  const cone =
    (Math.max(...corners.map(({ angle }) => angle)) * 180) / Math.PI + 6
  // NOTE: bright at its middle: share * pi * distance squared, over the
  // slant it strikes the floor at.
  const fillIntensity = (FILL_GAIN * Math.PI * reach * reach * reach) / height
  const fill = new SpotLight({
    color: ROOM_TINTS[room.id] ?? 0xffe2b4,
    intensity: 0,
    range: Math.max(...corners.map(({ length }) => length)) * 1.4,
    coneAngle: cone,
    penumbra: 0.3,
    castShadow: true,
  })
  fill.position.set(from.x, from.y, from.z)
  fill.lookAt({ x, y: 0, z })
  parent.addChild(fill)
  const dark =
    room.id === CELLAR_ROOM_ID ? darkCellsOf(parent, room.box) : []
  return { id: room.id, fill, dark, fillIntensity }
}

// NOTE: square cells along the room, each lit from far overhead so its
// whole square sits inside its cone; the dark overshoots, and the screen
// clamps the overshoot to black.
const darkCellsOf = (
  parent: Container3D,
  box: Level['rooms'][number]['box'],
): RoomLight['dark'] => {
  const width = (box.right - box.left) * UNIT
  const depth = zOf(box.bottom - box.top)
  // NOTE: half the room's short side, so a cone's round edge spills only a
  // little past the walls.
  const side = Math.min(width, depth) / 2
  const columns = Math.max(1, Math.round(width / side))
  const rows = Math.max(1, Math.round(depth / side))
  const cellWidth = width / columns
  const cellDepth = depth / rows
  const halfDiagonal = Math.hypot(cellWidth, cellDepth) / 2
  const cone = (Math.atan(halfDiagonal / DARK_HEIGHT) * 180) / Math.PI
  const cells: Array<RoomLight['dark'][number]> = []
  for (let column = 0; column < columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const x = box.left * UNIT + (column + 0.5) * cellWidth
      const z = zOf(box.top) + (row + 0.5) * cellDepth
      const light = new SpotLight({
        color: 0xffffff,
        intensity: 0,
        range: DARK_HEIGHT * 2,
        coneAngle: cone,
        penumbra: 0.12,
      })
      light.position.set(x, DARK_HEIGHT, z)
      light.lookAt({ x, y: 0, z: z + 0.001 })
      parent.addChild(light)
      cells.push({
        light,
        intensity: -DARK_DEPTH * Math.PI * DARK_HEIGHT * DARK_HEIGHT,
      })
    }
  }
  return cells
}

// THE LIGHTS

export type Lights = Readonly<{
  holder: Container3D
  update: (model: Model) => void
}>

// NOTE: the player's flashlight in the dark: the 2D game's beam is 120 px
// long and pi/7 either side, so the spot sits at the player's chest and
// aims at the floor a beam's length on.
const BEAM_LENGTH = 120 * UNIT
const BEAM_CONE = 180 / 7
const BEAM_HEIGHT = 2.2
const POOL_PX = 46

export const lightsOf = (level: Level, parent: Container3D): Lights => {
  const holder = new Container3D()
  parent.addChild(holder)
  const rooms = level.rooms.map(room => roomLightOf(holder, room))
  const flames: ReadonlyArray<Flame> = flameSpecsOf(level).map(
    (spec, index) => {
      const light = new PointLight({
        color: spec.color,
        intensity: 0,
        range: spec.range,
      })
      holder.addChild(light)
      return {
        light,
        x: spec.x * UNIT,
        z: zOf(spec.y),
        intensity: spec.intensity,
        seed: spec.isSteady === true ? Number.NaN : index * 2.17,
        isLit: spec.isLit ?? (() => true),
        swayOf: spec.swayOf,
        height: spec.height,
      }
    },
  )
  const flashlight = new SpotLight({
    color: 0xfff4d8,
    intensity: 0,
    range: BEAM_LENGTH * 1.6,
    coneAngle: BEAM_CONE,
    penumbra: 0.35,
  })
  holder.addChild(flashlight)
  // NOTE: the pool round the player (46 px in the 2D game): a spot from
  // far overhead, so it falls as an even disc.
  const pool = new SpotLight({
    color: 0xffe6c0,
    intensity: 0,
    range: DARK_HEIGHT * 2,
    coneAngle: (Math.atan((POOL_PX * UNIT) / DARK_HEIGHT) * 180) / Math.PI,
    penumbra: 0.45,
  })
  holder.addChild(pool)

  // NOTE: the lights this module may use: the view's 32 less the four
  // iso.ts keeps (the sun, the lamp, the muzzle flash, and one to spare).
  const budget = MAX_LIGHTS - 4

  const update = (model: Model): void => {
    const t = model.elapsedMs / 1000
    const cellar = level.rooms.find(({ id }) => id === CELLAR_ROOM_ID)
    const isDark = cellar !== undefined && cellar.isOpen && !isCellarLit(model)
    let used = 0
    for (const room of rooms) {
      const isOpen =
        level.rooms.find(({ id }) => id === room.id)?.isOpen ?? false
      const share =
        room.id === CELLAR_ROOM_ID && isDark
          ? 0
          : isOpen
            ? OPEN_FILL
            : SHUT_FILL
      room.fill.intensity = share * room.fillIntensity
      room.fill.visible = share > 0
      used += room.fill.visible ? 1 : 0
      for (const cell of room.dark) {
        cell.light.visible = isDark
        cell.light.intensity = cell.intensity
        used += isDark ? 1 : 0
      }
    }

    const { player } = focusOf(model)
    const px = player.x * UNIT
    const pz = zOf(player.y)
    const isInDark =
      isDark &&
      cellar !== undefined &&
      player.x >= cellar.box.left &&
      player.x <= cellar.box.right &&
      player.y >= cellar.box.top &&
      player.y <= cellar.box.bottom
    flashlight.visible = isInDark
    pool.visible = isInDark
    if (isInDark) {
      used += 2
      const reach = BEAM_LENGTH * 0.55
      flashlight.position.set(px, BEAM_HEIGHT, pz)
      flashlight.lookAt({
        x: px + player.facing.x * reach,
        y: 0,
        z: pz + player.facing.y * reach * STRETCH,
      })
      // NOTE: bright as the room's own light halfway down the beam, where
      // it strikes the floor at a slant (the cosine below).
      const slant = Math.hypot(BEAM_HEIGHT, reach)
      flashlight.intensity =
        ((DARK_DEPTH + 1) * Math.PI * slant * slant * slant) / BEAM_HEIGHT
      pool.position.set(px, DARK_HEIGHT, pz)
      pool.lookAt({ x: px, y: 0, z: pz + 0.001 })
      pool.intensity = (DARK_DEPTH + 0.75) * Math.PI * DARK_HEIGHT * DARK_HEIGHT
    }

    // NOTE: the flames that burn, nearest the player first, as many as the
    // budget has left.
    const burning = flames
      .filter(flame => flame.isLit(model))
      .map(flame => ({
        flame,
        distance: Math.hypot(flame.x - px, flame.z - pz),
      }))
      .sort((a, b) => a.distance - b.distance)
    const shown = new Set(
      burning.slice(0, Math.max(0, budget - used)).map(({ flame }) => flame),
    )
    for (const flame of flames) {
      const isShown = shown.has(flame)
      flame.light.visible = isShown
      if (!isShown) {
        continue
      }
      const sway = flame.swayOf?.(t) ?? 0
      flame.light.position.set(flame.x + sway, flame.height, flame.z)
      flame.light.intensity =
        flame.intensity *
        (Number.isNaN(flame.seed) ? 1 : flickerAt(t, flame.seed))
    }
  }

  return { holder, update }
}
