import { Schema, SchemaAST } from 'effect'

// How the co-op wire packs a number (src/world/net/worldCodec.ts), named on the
// Schema that holds it. A number with no `wire` annotation goes exactly,
// so a new field is never rounded unless its Schema says so.
//
// - Exact: a small integer as a varint, anything else as a float64.
// - Position: int16 in eighths of a pixel.
// - Velocity: int16 in eighths of a pixel a second.
// - Unit: int16 in 4096ths, for directions and scales near 1.
// - Millis: whole milliseconds, as a zigzag varint.

export const WireHint = Schema.Literals([
  'Exact',
  'Position',
  'Velocity',
  'Unit',
  'Millis',
])
export type WireHint = typeof WireHint.Type

declare module 'effect/Schema' {
  namespace Annotations {
    // oxlint-disable-next-line no-shadow -- Effect names the interface after its namespace; this adds to it.
    interface Annotations {
      readonly wire?: WireHint | undefined
    }
  }
}

export const PositionNumber = Schema.Finite.annotate({ wire: 'Position' })
export const VelocityNumber = Schema.Finite.annotate({ wire: 'Velocity' })
export const UnitNumber = Schema.Finite.annotate({ wire: 'Unit' })
export const MillisNumber = Schema.Finite.annotate({ wire: 'Millis' })

// NOTE: the same `{ x, y }` as `Vector`, packed by what it holds.
export const Point = Schema.Struct({ x: PositionNumber, y: PositionNumber })
export const Heading = Schema.Struct({ x: UnitNumber, y: UnitNumber })
export const Push = Schema.Struct({ x: VelocityNumber, y: VelocityNumber })

const resolveWire = SchemaAST.resolveAt<WireHint>('wire')

export const wireHintOf = (ast: SchemaAST.AST): WireHint =>
  resolveWire(ast) ?? 'Exact'
