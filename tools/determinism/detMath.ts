import { Array } from 'effect'
// Deterministic stand-ins for the Math functions the game calls whose results
// differ between engines (hypot, sin, cos, atan2, exp). They use only +, -,
// *, /, and Math.sqrt, which IEEE 754 rounds the same way everywhere, so
// every engine gets the same bits. They are accurate to a few ulps, plenty
// for a pixel game. The spike installs them over Math to test Phase 0 of
// MULTIPLAYER.md; the game would import them from its own module instead.

const HALF_PI_HIGH = 1.5707963267341256
const HALF_PI_LOW = 6.077100506506192e-11
const TWO_OVER_PI = 0.6366197723675814
const LN2_HIGH = 0.6931471803691238
const LN2_LOW = 1.9082149292705877e-10
const INV_LN2 = 1.4426950408889634

// sin and cos on [-pi/4, pi/4] by Taylor series, enough terms for doubles.
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
                      x2 * (-1 / 39916800 + x2 * (1 / 6227020800)))))))
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
                x2 * (1 / 40320 + x2 * (-1 / 3628800 + x2 * (1 / 479001600))))))
  )
}

// Cody and Waite reduction by pi/2 in two parts.
const reduce = (x: number): readonly [quadrant: number, rest: number] => {
  const n = Math.round(x * TWO_OVER_PI)
  return [((n % 4) + 4) % 4, x - n * HALF_PI_HIGH - n * HALF_PI_LOW]
}

const detSin = (x: number): number => {
  const [quadrant, r] = reduce(x)
  return quadrant === 0
    ? sinKernel(r)
    : quadrant === 1
      ? cosKernel(r)
      : quadrant === 2
        ? -sinKernel(r)
        : -cosKernel(r)
}

const detCos = (x: number): number => {
  const [quadrant, r] = reduce(x)
  return quadrant === 0
    ? cosKernel(r)
    : quadrant === 1
      ? -sinKernel(r)
      : quadrant === 2
        ? -cosKernel(r)
        : sinKernel(r)
}

// atan on [0, 1]: halve the argument twice with the half-angle identity,
// then a series that converges fast below tan(pi/16).
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

const detAtan = (x: number): number => {
  const sign = x < 0 ? -1 : 1
  const a = Math.abs(x)
  return sign * (a <= 1 ? atanUnit(a) : Math.PI / 2 - atanUnit(1 / a))
}

const detAtan2 = (y: number, x: number): number => {
  if (x > 0) {
    return detAtan(y / x)
  }
  if (x < 0) {
    return y >= 0 ? detAtan(y / x) + Math.PI : detAtan(y / x) - Math.PI
  }
  return y > 0 ? Math.PI / 2 : y < 0 ? -Math.PI / 2 : 0
}

const detExp = (x: number): number => {
  if (x > 709) {
    return Infinity
  }
  if (x < -745) {
    return 0
  }
  const k = Math.round(x * INV_LN2)
  const r = x - k * LN2_HIGH - k * LN2_LOW
  let term = 1
  let sum = 1
  for (let n = 1; n < 18; n++) {
    term = (term * r) / n
    sum += term
  }
  let scale = 1
  const base = k < 0 ? 0.5 : 2
  for (let i = 0; i < Math.abs(k); i++) {
    scale *= base
  }
  return sum * scale
}

const detHypot = (...values: Array<number>): number =>
  Math.sqrt(Array.reduce(values, 0, (sum, value) => sum + value * value))

// Puts them over Math for the life of the process or isolate.
export const installDeterministicMath = (): void => {
  Object.assign(Math, {
    sin: detSin,
    cos: detCos,
    atan2: detAtan2,
    exp: detExp,
    hypot: detHypot,
  })
}
