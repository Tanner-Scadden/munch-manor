import { Schema, SchemaAST } from 'effect'

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
    interface Annotations {
      readonly wire?: WireHint | undefined
    }
  }
}

export const PositionNumber = Schema.Finite.annotate({ wire: 'Position' })
export const VelocityNumber = Schema.Finite.annotate({ wire: 'Velocity' })
export const UnitNumber = Schema.Finite.annotate({ wire: 'Unit' })
export const MillisNumber = Schema.Finite.annotate({ wire: 'Millis' })

export const Point = Schema.Struct({ x: PositionNumber, y: PositionNumber })
export const Heading = Schema.Struct({ x: UnitNumber, y: UnitNumber })
export const Push = Schema.Struct({ x: VelocityNumber, y: VelocityNumber })

const resolveWire = SchemaAST.resolveAt<WireHint>('wire')

export const wireHintOf = (ast: SchemaAST.AST): WireHint =>
  resolveWire(ast) ?? 'Exact'
