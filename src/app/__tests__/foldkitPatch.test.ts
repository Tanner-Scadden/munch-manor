// @vitest-environment happy-dom
import { Effect, Schema, Struct } from 'effect'
import { Canvas } from 'foldkit'
import { inertHtml } from 'foldkit/html'
import { taggedStruct } from 'foldkit/schema'
import { describe, expect, test } from 'vitest'

// The parts of patches/foldkit@0.170.0.patch that change no API: building a
// shape skips `schema.make` for its optional keys, and a style entry that
// passed its checks is remembered. Both must behave as before.

describe('a Canvas shape built every frame', () => {
  test('leaves out an optional key the input leaves out', () => {
    expect(Canvas.Rect({ x: 1, y: 2, width: 3, height: 4 })).toStrictEqual({
      _tag: 'Rect',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    })
  })

  test('keeps an optional key the input gives, even undefined', () => {
    expect(
      Canvas.Rect({ x: 1, y: 2, width: 3, height: 4, fill: '#fff' }),
    ).toStrictEqual({
      _tag: 'Rect',
      x: 1,
      y: 2,
      width: 3,
      height: 4,
      fill: '#fff',
    })
    expect(
      Struct.keys(Canvas.Circle({ x: 0, y: 0, radius: 2, fill: undefined })),
    ).toStrictEqual(['_tag', 'x', 'y', 'radius', 'fill'])
  })

  test('builds a plain object, as make does', () => {
    const rect = Canvas.Rect({ x: 0, y: 0, width: 1, height: 1 })
    expect(Object.getPrototypeOf(rect)).toBe(Object.prototype)
  })

  test('still refuses undefined for an exact optional key', () => {
    const Exact = taggedStruct('Exact', {
      label: Schema.optionalKey(Schema.String),
    })
    expect(Exact({})).toStrictEqual({ _tag: 'Exact' })
    // NOTE: the types refuse it too, so it goes in untyped, as from JavaScript.
    expect((): unknown =>
      Reflect.apply(Exact, undefined, [{ label: undefined }]),
    ).toThrow('Schema validation failed')
  })

  test('still applies a constructor default', () => {
    const Defaulted = taggedStruct('Defaulted', {
      size: Schema.Finite.pipe(
        Schema.withConstructorDefault(Effect.succeed(7)),
      ),
    })
    expect(Defaulted({})).toStrictEqual({ _tag: 'Defaulted', size: 7 })
  })
})

describe('an inline style built every frame', () => {
  const h = inertHtml

  test('is checked once and then remembered', () => {
    const style = { left: '12px', '--tint': 'rgb(1, 2, 3)' }
    expect(h.div([h.Style(style)], [])?.data?.style).toStrictEqual(style)
    expect(h.div([h.Style(style)], [])?.data?.style).toStrictEqual(style)
  })

  test('still refuses an unsafe value every time', () => {
    const unsafe = { color: 'red; background: blue' }
    expect(() => h.div([h.Style(unsafe)], [])).toThrow(/unsafe CSS/)
    expect(() => h.div([h.Style(unsafe)], [])).toThrow(/unsafe CSS/)
  })

  test('still refuses two spellings of one declaration after each passed', () => {
    expect(() => h.div([h.Style({ fontSize: '1px' })], [])).not.toThrow()
    expect(() => h.div([h.Style({ 'font-size': '1px' })], [])).not.toThrow()
    expect(() =>
      h.div([h.Style({ fontSize: '1px', 'font-size': '1px' })], []),
    ).toThrow(/both name/)
  })
})
