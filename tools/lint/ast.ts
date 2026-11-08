// NOTE: small readers of oxlint's typed AST that the project's rules
// share (tools/lint/munchPlugin.ts, tools/lint/testRules.ts).

import { Function } from 'effect'

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
