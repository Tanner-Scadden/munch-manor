// Which room lights' shadow maps changed this frame. A fill's shadow map is
// 2048 pixels a side and holds every caster in its cone, so drawing it again
// each frame costs a phone more fill than the screen itself (four of them in
// a busy view, about 17 million depth pixels a frame: `tools/audit/gpuWork.ts`).
// Most frames nothing in a room's cone moved: the furniture stands still, and
// in a break only the players walk. So each fill keeps its map
// (`shadow.update = 'manual'`) and draws it again only on a frame its casters
// changed, as a game engine caches a static light's shadow.
// Every caster drawn this frame is summed into each cone it can reach: its
// shape and the matrix it stands at, hashed, so the sum is the same for the
// same casters in any order. A cone whose sum moved draws again. What casts
// outside the voxel batch and changes with the frame (the chandelier's sway,
// a fern's or a carve's caster culled in or out) is noted for every cone.

import { Array } from 'effect'

export type ShadowCone = Readonly<{
  from: Readonly<{ x: number; y: number; z: number }>
  to: Readonly<{ x: number; y: number; z: number }>
  // NOTE: the outer half angle, in degrees, as a SpotLight's `coneAngle`.
  coneAngle: number
  range: number
}>

type Cone = Readonly<{
  x: number
  y: number
  z: number
  axisX: number
  axisY: number
  axisZ: number
  halfAngle: number
  range: number
}>

// NOTE: a little past the cone, for the penumbra's edge and rounding.
const SPARE_RADIANS = (2 * Math.PI) / 180

const coneOf = ({ from, to, coneAngle, range }: ShadowCone): Cone => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz) || 1
  return {
    x: from.x,
    y: from.y,
    z: from.z,
    axisX: dx / length,
    axisY: dy / length,
    axisZ: dz / length,
    halfAngle: (coneAngle * Math.PI) / 180 + SPARE_RADIANS,
    range,
  }
}

// NOTE: whether a sphere at `x, y, z` of `radius` reaches into the cone: a
// point a light lights lies inside its cone, and so does anything between
// the light and that point, so a caster outside the cone never shows in its
// shadow.
const isInCone = (
  cone: Cone,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean => {
  const dx = x - cone.x
  const dy = y - cone.y
  const dz = z - cone.z
  const distance = Math.hypot(dx, dy, dz)
  if (distance <= radius) {
    return true
  }
  if (distance - radius > cone.range) {
    return false
  }
  const cos = (dx * cone.axisX + dy * cone.axisY + dz * cone.axisZ) / distance
  const angle = Math.acos(Math.max(-1, Math.min(1, cos)))
  return angle <= cone.halfAngle + Math.asin(radius / distance)
}

// NOTE: the matrix's turn, lean, and scale, without its move.
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

// NOTE: the last caster's matrix as float32s, read as its words to hash it
// and as its numbers to place its sphere.
const bits = new Float32Array(16)
const words = new Int32Array(bits.buffer)

// NOTE: one 32 bit hash of a caster's shape and its matrix's floats.
const casterHash = (id: number, elements: ArrayLike<number>): number => {
  for (let index = 0; index < 16; index += 1) {
    bits[index] = elements[index] ?? 0
  }
  let hash = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b)
  for (let index = 0; index < 16; index += 1) {
    hash = Math.imul(hash ^ (words[index] ?? 0), 0x01000193)
    hash ^= hash >>> 15
  }
  return hash | 0
}

export class ShadowWatch {
  private cones: ReadonlyArray<Cone> = []
  private sums: Int32Array = new Int32Array(0)
  private lastSums: Int32Array = new Int32Array(0)
  private changed: Array<boolean> = []
  private shared = 0
  private lastShared = 0
  private readonly ids = new WeakMap<object, number>()
  private nextId = 1

  // NOTE: the cones of a new level's fills, in their order; each draws its
  // map the first frame after.
  watch(cones: ReadonlyArray<ShadowCone>): void {
    this.cones = Array.map(cones, coneOf)
    this.sums = new Int32Array(cones.length)
    this.lastSums = new Int32Array(cones.length)
    this.changed = Array.map(cones, () => true)
  }

  begin(): void {
    this.sums.fill(0)
    this.shared = 0
  }

  // NOTE: a caster drawn this frame: its shape (any object, known by
  // identity), the column-major matrix it stands at, and its bounding
  // sphere in its own space. The sphere goes through the matrix, its radius
  // grown by the matrix's whole size, so a lean or a stretch never shrinks
  // it.
  cast(
    input: Readonly<{
      shape: object
      elements: ArrayLike<number>
      center: Readonly<{ x: number; y: number; z: number }>
      radius: number
    }>,
  ): void {
    const { shape, elements, center } = input
    const hash = casterHash(this.idOf(shape), elements)
    const e = (index: number): number => bits[index] ?? 0
    const x = e(0) * center.x + e(4) * center.y + e(8) * center.z + e(12)
    const y = e(1) * center.x + e(5) * center.y + e(9) * center.z + e(13)
    const z = e(2) * center.x + e(6) * center.y + e(10) * center.z + e(14)
    let squares = 0
    for (const index of LINEAR) {
      squares += e(index) * e(index)
    }
    const radius = input.radius * Math.sqrt(squares)
    // NOTE: a level has a fill per room, at most about eight.
    for (let index = 0; index < this.cones.length; index += 1) {
      const cone = this.cones[index]
      if (cone !== undefined && isInCone(cone, x, y, z, radius)) {
        this.sums[index] = ((this.sums[index] ?? 0) + hash) | 0
      }
    }
  }

  // NOTE: something that casts in every cone changed with this key: the
  // chandelier's sway, which casters are culled in.
  note(key: number): void {
    this.shared = Math.imul(this.shared ^ (key | 0), 0x01000193) ^ 0x2f
  }

  end(): void {
    const isSharedChanged = this.shared !== this.lastShared
    this.lastShared = this.shared
    for (let index = 0; index < this.sums.length; index += 1) {
      this.changed[index] =
        isSharedChanged || this.sums[index] !== this.lastSums[index]
    }
    this.lastSums.set(this.sums)
  }

  // NOTE: whether the cone at `index` saw its casters change in the frame
  // `end` closed.
  isChanged(index: number): boolean {
    return this.changed[index] ?? true
  }

  private idOf(shape: object): number {
    const known = this.ids.get(shape)
    if (known !== undefined) {
      return known
    }
    const id = this.nextId
    this.nextId += 1
    this.ids.set(shape, id)
    return id
  }
}
