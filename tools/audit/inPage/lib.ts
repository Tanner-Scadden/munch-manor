export const pixelDiffOf = async ([first, second]: readonly [
  string,
  string,
]) => {
  const load = async (src: string) => {
    const image = new Image()
    image.src = src
    await image.decode()
    return image
  }
  const gl = document.createElement('canvas').getContext('webgl2')
  if (gl === null) {
    throw new Error('No WebGL2 context for the pixel compare')
  }
  const pixels = async (src: string) => {
    const image = await load(src)
    const width = image.naturalWidth
    const height = image.naturalHeight
    const texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      image,
    )
    const framebuffer = gl.createFramebuffer()
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0,
    )
    const data = new Uint8ClampedArray(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.deleteFramebuffer(framebuffer)
    gl.deleteTexture(texture)
    return { width, height, data }
  }
  const a = await pixels(first)
  const b = await pixels(second)
  const out = new ImageData(a.width, a.height)
  let differing = 0
  let maxDelta = 0
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  const before = a.data
  const after = b.data
  const at = (data: Uint8ClampedArray, index: number) => data[index] ?? 0
  for (let i = 0; i < before.length; i += 4) {
    const delta = Math.max(
      Math.abs(at(before, i) - at(after, i)),
      Math.abs(at(before, i + 1) - at(after, i + 1)),
      Math.abs(at(before, i + 2) - at(after, i + 2)),
    )
    const gray = Math.round(
      (at(after, i) + at(after, i + 1) + at(after, i + 2)) / 12,
    )
    out.data[i] = delta > 0 ? 255 : gray
    out.data[i + 1] = delta > 0 ? 0 : gray
    out.data[i + 2] = delta > 0 ? 255 : gray
    out.data[i + 3] = 255
    if (delta > 0) {
      differing++
      const pixel = i / 4
      const x = pixel % a.width
      const y = Math.floor(pixel / a.width)
      left = Math.min(left, x)
      top = Math.min(top, y)
      right = Math.max(right, x)
      bottom = Math.max(bottom, y)
    }
    maxDelta = Math.max(maxDelta, delta)
  }
  const diffUrl = async () => {
    const diff = document.createElement('canvas')
    diff.width = a.width
    diff.height = a.height
    const renderer = diff.getContext('bitmaprenderer')
    if (renderer === null) {
      throw new Error('No bitmaprenderer context for the pixel diff')
    }
    renderer.transferFromImageBitmap(await createImageBitmap(out))
    return diff.toDataURL('image/png')
  }
  return {
    differing,
    total: a.data.length / 4,
    maxDelta,
    box: differing > 0 ? { left, top, right, bottom } : null,
    diffUrl: differing > 0 ? await diffUrl() : null,
  }
}
