import { Array, Function, Record } from 'effect'

import type { ESTree } from '@oxlint/plugins'

type Node = ESTree.Node

export const isStringLiteral = (
  node: Node | null | undefined,
): node is ESTree.StringLiteral =>
  node?.type === 'Literal' && typeof node.value === 'string'

export const propertyName = (
  node: ESTree.MemberExpression,
): string | undefined =>
  node.computed
    ? isStringLiteral(node.property)
      ? node.property.value
      : undefined
    : node.property.type === 'Identifier'
      ? node.property.name
      : undefined

export const hasName: {
  (name: string | undefined): (names: ReadonlySet<string>) => boolean
  (names: ReadonlySet<string>, name: string | undefined): boolean
} = Function.dual(
  2,
  (names: ReadonlySet<string>, name: string | undefined): boolean =>
    name !== undefined && names.has(name),
)

export const importSource = (
  node: ESTree.ImportSpecifier,
): string | undefined =>
  node.parent.type === 'ImportDeclaration'
    ? node.parent.source.value
    : undefined

export const importedName = (node: ESTree.ImportSpecifier): string =>
  isStringLiteral(node.imported) ? node.imported.value : node.imported.name

export const isFunctionNode = (
  node: Node,
): node is ESTree.ArrowFunctionExpression | ESTree.Function =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionExpression' ||
  node.type === 'FunctionDeclaration'

export const mentions: {
  (name: string): (value: unknown) => boolean
  (value: unknown, name: string): boolean
} = Function.dual(2, (value: unknown, name: string): boolean => {
  if (Array.isArray(value)) {
    return Array.some(value, (child: unknown) => mentions(child, name))
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if ('type' in value && value.type === 'Identifier') {
    return 'name' in value && value.name === name
  }
  return Array.some(Record.keys(value), key => {
    const child: unknown = Reflect.get(value, key)
    return key !== 'parent' && mentions(child, name)
  })
})

const WORLD_NAME = /^world$|World$/

export const isWorldNamed = (node: ESTree.Node): boolean =>
  (node.type === 'Identifier' && WORLD_NAME.test(node.name)) ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    WORLD_NAME.test(node.property.name))
