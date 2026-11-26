import { Array } from 'effect'

export type ShadowCone = Readonly<{
  from: Readonly<{ x: number; y: number; z: number }>
  to: Readonly<{ x: number; y: number; z: number }>
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
  cosHalf: number
  sinHalf: number
  range: number
}>

const SPARE_RADIANS = (2 * Math.PI) / 180

const coneOf = ({ from, to, coneAngle, range }: ShadowCone): Cone => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dz = to.z - from.z
  const length = Math.hypot(dx, dy, dz) || 1
  const halfAngle = (coneAngle * Math.PI) / 180 + SPARE_RADIANS
  return {
    x: from.x,
    y: from.y,
    z: from.z,
    axisX: dx / length,
    axisY: dy / length,
    axisZ: dz / length,
    halfAngle,
    cosHalf: Math.cos(halfAngle),
    sinHalf: Math.sin(halfAngle),
    range,
  }
}

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
  const squared = dx * dx + dy * dy + dz * dz
  if (squared <= radius * radius) {
    return true
  }
  const reach = cone.range + radius
  if (squared > reach * reach) {
    return false
  }
  const distance = Math.sqrt(squared)
  const along = dx * cone.axisX + dy * cone.axisY + dz * cone.axisZ
  const filled = radius / distance
  if (
    cone.halfAngle >= Math.PI / 2 &&
    cone.halfAngle + Math.asin(filled) >= Math.PI
  ) {
    return true
  }
  const cosFilled = Math.sqrt(1 - filled * filled)
  return along >= distance * (cone.cosHalf * cosFilled - cone.sinHalf * filled)
}

const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

const bits = new Float32Array(16)
const words = new Int32Array(bits.buffer)

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
    for (let index = 0; index < this.cones.length; index += 1) {
      const cone = this.cones[index]
      if (cone !== undefined && isInCone(cone, x, y, z, radius)) {
        this.sums[index] = ((this.sums[index] ?? 0) + hash) | 0
      }
    }
  }

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
