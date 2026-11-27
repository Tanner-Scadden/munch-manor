const DOME_DEPTH = 3

const SHADE_WEIGHT = 0.6

const STEEPNESS = 4

const STEP = 16

const steppedByte = (component: number): number =>
  Math.min(255, Math.round((component * 127.5) / STEP) * STEP + 128)

const OPAQUE = 128
const FLAT: readonly [number, number, number] = [128, 128, 255]

const lightnessOf = (pixels: Uint8ClampedArray, offset: number): number =>
  (0.299 * (pixels[offset] ?? 0) +
    0.587 * (pixels[offset + 1] ?? 0) +
    0.114 * (pixels[offset + 2] ?? 0)) /
  255

const depthsOf = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Uint8Array => {
  const depths = new Uint8Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    depths[index] = (pixels[index * 4 + 3] ?? 0) < OPAQUE ? 0 : DOME_DEPTH
  }
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height
      ? 0
      : (depths[y * width + x] ?? 0)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const own = depths[index] ?? 0
      if (own > 0) {
        depths[index] = Math.min(own, at(x - 1, y) + 1, at(x, y - 1) + 1)
      }
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = y * width + x
      const own = depths[index] ?? 0
      if (own > 0) {
        depths[index] = Math.min(own, at(x + 1, y) + 1, at(x, y + 1) + 1)
      }
    }
  }
  return depths
}

const heightsOf = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array => {
  const depths = depthsOf(pixels, width, height)
  const heights = new Float32Array(width * height)
  for (let index = 0; index < width * height; index += 1) {
    const depth = depths[index] ?? 0
    if (depth > 0) {
      const inward = 1 - depth / DOME_DEPTH
      const dome = Math.sqrt(1 - inward * inward)
      const shade = lightnessOf(pixels, index * 4) - 0.5
      heights[index] = dome + shade * SHADE_WEIGHT
    }
  }
  return heights
}

export const normalPixelsOf = (
  sheet: Readonly<{
    pixels: Uint8ClampedArray
    width: number
    height: number
  }>,
): Uint8ClampedArray<ArrayBuffer> => {
  const { pixels, width, height } = sheet
  const heights = heightsOf(pixels, width, height)
  const at = (x: number, y: number): number =>
    x < 0 || y < 0 || x >= width || y >= height
      ? 0
      : (heights[y * width + x] ?? 0)
  const normals = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      const offset = index * 4
      if ((pixels[offset + 3] ?? 0) < OPAQUE) {
        normals[offset] = FLAT[0]
        normals[offset + 1] = FLAT[1]
        normals[offset + 2] = FLAT[2]
      } else {
        const slopeX = (at(x + 1, y) - at(x - 1, y)) / 2
        const slopeDown = (at(x, y + 1) - at(x, y - 1)) / 2
        const nx = -slopeX * STEEPNESS
        const ny = slopeDown * STEEPNESS
        const length = Math.hypot(nx, ny, 1)
        const red = steppedByte(nx / length)
        const green = steppedByte(ny / length)
        const packedX = (red - 128) / 127.5
        const packedY = (green - 128) / 127.5
        normals[offset] = red
        normals[offset + 1] = green
        normals[offset + 2] = Math.round(
          (Math.sqrt(Math.max(0, 1 - packedX * packedX - packedY * packedY)) /
            2 +
            0.5) *
            255,
        )
      }
      normals[offset + 3] = 255
    }
  }
  return normals
}
