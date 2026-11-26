import { Function } from 'effect'

const HALF_PI_HIGH = 1.5707963267341256
const HALF_PI_LOW = 6.077100506506192e-11
const TWO_OVER_PI = 0.6366197723675814
const LN2_HIGH = 0.6931471803691238
const LN2_LOW = 1.9082149292705877e-10
const INV_LN2 = 1.4426950408889634

const sinKernel = (x: number): number => {
  const x2 = x * x
  return (
    x *
    (1 +
      x2 *
        (-1 / 6 +
          x2 *
            (1 / 120 +
              x2 *
                (-1 / 5040 +
                  x2 *
                    (1 / 362880 +
                      x2 *
                        (-1 / 39916800 +
                          x2 *
                            (1 / 6227020800 +
                              x2 *
                                (-1 / 1307674368000 +
                                  x2 * (1 / 355687428096000)))))))))
  )
}

const cosKernel = (x: number): number => {
  const x2 = x * x
  return (
    1 +
    x2 *
      (-1 / 2 +
        x2 *
          (1 / 24 +
            x2 *
              (-1 / 720 +
                x2 *
                  (1 / 40320 +
                    x2 *
                      (-1 / 3628800 +
                        x2 *
                          (1 / 479001600 +
                            x2 *
                              (-1 / 87178291200 +
                                x2 *
                                  (1 / 20922789888000 +
                                    x2 * (-1 / 6402373705728000)))))))))
  )
}

const quadrantOf = (x: number): number => {
  const n = Math.round(x * TWO_OVER_PI)
  return ((n % 4) + 4) % 4
}

const restOf = (x: number): number => {
  const n = Math.round(x * TWO_OVER_PI)
  return x - n * HALF_PI_HIGH - n * HALF_PI_LOW
}

export const sin = (x: number): number => {
  const rest = restOf(x)
  const quadrant = quadrantOf(x)
  if (quadrant === 0) {
    return sinKernel(rest)
  }
  if (quadrant === 1) {
    return cosKernel(rest)
  }
  if (quadrant === 2) {
    return -sinKernel(rest)
  }
  return -cosKernel(rest)
}

export const cos = (x: number): number => {
  const rest = restOf(x)
  const quadrant = quadrantOf(x)
  if (quadrant === 0) {
    return cosKernel(rest)
  }
  if (quadrant === 1) {
    return -sinKernel(rest)
  }
  if (quadrant === 2) {
    return -cosKernel(rest)
  }
  return sinKernel(rest)
}

export const tan = (x: number): number => sin(x) / cos(x)

const atanUnit = (x: number): number => {
  const once = x / (1 + Math.sqrt(1 + x * x))
  const twice = once / (1 + Math.sqrt(1 + once * once))
  const t2 = twice * twice
  let term = twice
  let sum = twice
  for (let k = 1; k < 12; k++) {
    term *= -t2
    sum += term / (2 * k + 1)
  }
  return 4 * sum
}

export const atan = (x: number): number => {
  const sign = x < 0 ? -1 : 1
  const size = Math.abs(x)
  return sign * (size <= 1 ? atanUnit(size) : Math.PI / 2 - atanUnit(1 / size))
}

export const atan2: {
  (x: number): (y: number) => number
  (y: number, x: number): number
} = Function.dual(2, (y: number, x: number): number => {
  if (x > 0) {
    return atan(y / x)
  }
  if (x < 0) {
    return y >= 0 ? atan(y / x) + Math.PI : atan(y / x) - Math.PI
  }
  if (y > 0) {
    return Math.PI / 2
  }
  return y < 0 ? -Math.PI / 2 : 0
})

export const acos = (x: number): number => {
  const held = Math.max(-1, Math.min(1, x))
  return atan2(Math.sqrt((1 - held) * (1 + held)), held)
}

export const exp = (x: number): number => {
  if (x > 709) {
    return Infinity
  }
  if (x < -745) {
    return 0
  }
  const k = Math.round(x * INV_LN2)
  const rest = x - k * LN2_HIGH - k * LN2_LOW
  let term = 1
  let sum = 1
  for (let n = 1; n < 18; n++) {
    term = (term * rest) / n
    sum += term
  }
  let scale = 1
  const base = k < 0 ? 0.5 : 2
  for (let step = 0; step < Math.abs(k); step++) {
    scale *= base
  }
  return sum * scale
}

export const hypot: {
  (y: number): (x: number) => number
  (x: number, y: number): number
} = Function.dual(2, (x: number, y: number): number => Math.sqrt(x * x + y * y))
