// NOTE: the project's oxlint rules about work that grows faster than the
// lists it walks: a reduce that copies its accumulator each step, deep
// equality on every frame, and a scan of one list for each item of another.
// Loaded through tools/lint/munchPlugin.ts, which names them; the config
// scopes the last two to the code that runs every frame or tick.

import { Array, Option } from 'effect'

import { defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

import {
  hasName,
  isFunctionNode,
  isStringLiteral,
  mentions,
  propertyName,
} from './ast.ts'

type Node = ESTree.Node

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function

// NOTE: the expression under `x as T`, `x!`, `(x)`, and `a?.b`.
const unwrap = (node: Node): Node =>
  node.type === 'TSAsExpression' ||
  node.type === 'TSSatisfiesExpression' ||
  node.type === 'TSNonNullExpression' ||
  node.type === 'ParenthesizedExpression' ||
  node.type === 'ChainExpression'
    ? unwrap(node.expression)
    : node

// NOTE: `Array.name` off Effect's Array module.
const effectArrayMethod = (callee: Node): string | undefined =>
  callee.type === 'MemberExpression' &&
  callee.object.type === 'Identifier' &&
  callee.object.name === 'Array'
    ? propertyName(callee)
    : undefined

// NOTE: `xs.name` on a value, not off a module (`Option.map`,
// `Effect.forEach`, `String.includes`), whose names start in capitals.
const nativeMethod = (callee: Node): string | undefined =>
  callee.type === 'MemberExpression' &&
  !(callee.object.type === 'Identifier' && /^[A-Z]/.test(callee.object.name))
    ? propertyName(callee)
    : undefined

// NOTE: the name at the root of `acc`, `acc.list`, `zombie.parts[0]`.
const rootName = (node: Node): string | undefined => {
  const inner = unwrap(node)
  return inner.type === 'Identifier'
    ? inner.name
    : inner.type === 'MemberExpression'
      ? rootName(inner.object)
      : undefined
}

const functionArgument = (
  call: ESTree.CallExpression,
): FunctionNode | undefined =>
  Option.getOrUndefined(
    Array.findFirst(call.arguments, (argument): argument is FunctionNode =>
      isFunctionNode(argument),
    ),
  )

// NOTE: every return in a function's body, not in a function nested in it.
// The walk reads each field of a node as unknown, skipping the link back
// to its parent.
const returnsIn = (value: unknown): ReadonlyArray<Node> => {
  if (Array.isArray(value)) {
    return Array.flatMap(value, (child: unknown) => returnsIn(child))
  }
  if (!isNode(value) || isFunctionNode(value)) {
    return []
  }
  if (value.type === 'ReturnStatement') {
    return value.argument === null ? [] : [value.argument]
  }
  return Array.flatMap(
    Array.filter(Reflect.ownKeys(value), key => key !== 'parent'),
    (key: PropertyKey) => returnsIn(Reflect.get(value, key)),
  )
}

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string'

const returnedValues = (fn: FunctionNode): ReadonlyArray<Node> =>
  fn.body === null
    ? []
    : fn.body.type === 'BlockStatement'
      ? returnsIn(fn.body.body)
      : [fn.body]

// NOTE: each value a conditional or a logical expression may give.
const branches = (node: Node): ReadonlyArray<Node> => {
  const inner = unwrap(node)
  return inner.type === 'ConditionalExpression'
    ? [...branches(inner.consequent), ...branches(inner.alternate)]
    : inner.type === 'LogicalExpression'
      ? [...branches(inner.left), ...branches(inner.right)]
      : [inner]
}

const REDUCERS: ReadonlySet<string> = new Set(['reduce', 'reduceRight'])

const LIST_COPIERS: ReadonlySet<string> = new Set([
  'append',
  'appendAll',
  'prepend',
  'prependAll',
])

// NOTE: the copies of the accumulator (or a list on it) a returned value
// makes: `Array.append(acc, x)`, `acc.concat(xs)`, `[...acc, x]`, and the
// same on a field, `{ ...acc, list: [...acc.list, x] }`.
const accumulatorCopies = (
  node: Node,
  accumulator: string,
): ReadonlyArray<Node> =>
  Array.flatMap(branches(node), value => {
    if (value.type === 'CallExpression') {
      const isCopier =
        (hasName(LIST_COPIERS, effectArrayMethod(value.callee)) &&
          value.arguments[0] !== undefined &&
          rootName(value.arguments[0]) === accumulator) ||
        (nativeMethod(value.callee) === 'concat' &&
          value.callee.type === 'MemberExpression' &&
          rootName(value.callee.object) === accumulator)
      return isCopier ? [value] : []
    }
    if (value.type === 'ArrayExpression') {
      return Array.some(
        value.elements,
        element =>
          element?.type === 'SpreadElement' &&
          rootName(element.argument) === accumulator,
      )
        ? [value]
        : []
    }
    if (value.type === 'ObjectExpression') {
      return Array.flatMap(value.properties, property =>
        property.type === 'Property'
          ? accumulatorCopies(property.value, accumulator)
          : [],
      )
    }
    return []
  })

export const noAppendInReduce = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'A reduce that copies its accumulator list each step is quadratic: fill a local array in a loop, or use Array.flatMap or filterMap.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          !hasName(
            REDUCERS,
            effectArrayMethod(node.callee) ?? nativeMethod(node.callee),
          )
        ) {
          return
        }
        const callback = functionArgument(node)
        const accumulator = callback?.params[0]
        if (callback === undefined || accumulator?.type !== 'Identifier') {
          return
        }
        Array.forEach(
          Array.flatMap(returnedValues(callback), value =>
            accumulatorCopies(value, accumulator.name),
          ),
          copy =>
            context.report({
              node: copy,
              message:
                'This reduce copies its accumulator list on every step, so it is quadratic: push into a local array in a loop, or use Array.flatMap or Array.filterMap (AGENTS.md "Code shape").',
            }),
        )
      },
    }
  },
})

// NOTE: deep equality, which hashes or walks both whole values: Equal's
// `equals` and `equivalence`, and Schema's equivalences.
const DEEP_EQUAL: Readonly<Record<string, ReadonlySet<string>>> = {
  Equal: new Set(['equals', 'equivalence']),
  Schema: new Set(['toEquivalence', 'equivalence']),
}

const MODULE_SOURCES: Readonly<Record<string, string>> = {
  'effect/Equal': 'Equal',
  'effect/Schema': 'Schema',
}

const DEEP_EQUAL_MESSAGE =
  'Deep equality walks both whole values on every frame: compare references, or the few fields that matter (AGENTS.md "Keep the frame cheap").'

export const noDeepEqualPerFrame = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Code that runs every frame compares references or a few fields, never deep equality (Equal.equals, Schema.toEquivalence).',
    },
  },
  create(context) {
    // NOTE: the local name of each module, by the module: `Equal` from
    // `import { Equal } from 'effect'` or `import * as Eq from 'effect/Equal'`.
    const modules = new Map<string, string>()
    return {
      ImportSpecifier(node) {
        if (node.parent.type !== 'ImportDeclaration') {
          return
        }
        const source = node.parent.source.value
        const imported = isStringLiteral(node.imported)
          ? node.imported.value
          : node.imported.name
        if (source === 'effect' && imported in DEEP_EQUAL) {
          modules.set(node.local.name, imported)
          return
        }
        const module = MODULE_SOURCES[source]
        if (
          module !== undefined &&
          (DEEP_EQUAL[module]?.has(imported) ?? false)
        ) {
          context.report({ node, message: DEEP_EQUAL_MESSAGE })
        }
      },
      ImportNamespaceSpecifier(node) {
        if (node.parent.type !== 'ImportDeclaration') {
          return
        }
        const module = MODULE_SOURCES[node.parent.source.value]
        if (module !== undefined) {
          modules.set(node.local.name, module)
        }
      },
      MemberExpression(node) {
        if (node.object.type !== 'Identifier') {
          return
        }
        const module = modules.get(node.object.name)
        const methods = module === undefined ? undefined : DEEP_EQUAL[module]
        if (methods !== undefined && hasName(methods, propertyName(node))) {
          context.report({ node, message: DEEP_EQUAL_MESSAGE })
        }
      },
    }
  },
})

// NOTE: the calls that run a callback once for each item of a list.
const EFFECT_ITERATIONS: ReadonlySet<string> = new Set([
  'map',
  'filter',
  'filterMap',
  'flatMap',
  'forEach',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'findFirst',
  'findFirstIndex',
  'findLast',
  'findLastIndex',
  'partition',
  'partitionMap',
  'sortWith',
  'groupBy',
  'mapAccum',
  'takeWhile',
  'dropWhile',
  'span',
  'zipWith',
])

const NATIVE_ITERATIONS: ReadonlySet<string> = new Set([
  'map',
  'filter',
  'flatMap',
  'forEach',
  'reduce',
  'reduceRight',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
])

// NOTE: Effect's linear scans, by the count of arguments their data-first
// call takes, the one form whose list the rule can name.
const EFFECT_SCANS: Readonly<Record<string, number>> = {
  contains: 2,
  findFirst: 2,
  findFirstIndex: 2,
  findLast: 2,
  findLastIndex: 2,
  filter: 2,
  some: 2,
  every: 2,
  dedupe: 1,
  dedupeWith: 2,
  sort: 2,
}

const NATIVE_SCANS: ReadonlySet<string> = new Set([
  'includes',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'filter',
  'some',
  'every',
  'indexOf',
  'lastIndexOf',
])

const isIteration = (call: Node): boolean =>
  call.type === 'CallExpression' &&
  (hasName(EFFECT_ITERATIONS, effectArrayMethod(call.callee)) ||
    hasName(NATIVE_ITERATIONS, nativeMethod(call.callee)))

const isTextLiteral = (node: Node): boolean =>
  isStringLiteral(node) || node.type === 'TemplateLiteral'

// NOTE: the list a call scans, when the rule can name it.
const scannedList = (call: ESTree.CallExpression): Node | undefined => {
  const effectName = effectArrayMethod(call.callee)
  const arity = effectName === undefined ? undefined : EFFECT_SCANS[effectName]
  if (arity !== undefined) {
    return call.arguments.length >= arity ? call.arguments[0] : undefined
  }
  // NOTE: `Array.containsWith(isEquivalent)(list, item)`.
  if (
    call.callee.type === 'CallExpression' &&
    effectArrayMethod(call.callee.callee) === 'containsWith'
  ) {
    return call.arguments.length === 2 ? call.arguments[0] : undefined
  }
  if (
    call.callee.type === 'MemberExpression' &&
    hasName(NATIVE_SCANS, nativeMethod(call.callee)) &&
    !isTextLiteral(call.callee.object)
  ) {
    return call.callee.object
  }
  return undefined
}

// NOTE: every name a parameter or a loop variable binds:
// `zombie`, `{ player, slot }`, `[key, value]`.
const boundNames = (pattern: unknown): ReadonlyArray<string> => {
  if (!isNode(pattern)) {
    return []
  }
  return pattern.type === 'Identifier'
    ? [pattern.name]
    : pattern.type === 'ObjectPattern'
      ? Array.flatMap(
          Array.map(pattern.properties, (property): unknown =>
            property.type === 'RestElement'
              ? property.argument
              : property.value,
          ),
          boundNames,
        )
      : pattern.type === 'ArrayPattern'
        ? Array.flatMap(
            Array.map(pattern.elements, (element): unknown => element),
            boundNames,
          )
        : pattern.type === 'AssignmentPattern'
          ? boundNames(pattern.left)
          : pattern.type === 'RestElement'
            ? boundNames(pattern.argument)
            : pattern.type === 'VariableDeclaration'
              ? Array.flatMap(pattern.declarations, declaration =>
                  boundNames(declaration.id),
                )
              : []
}

// NOTE: the names the iterations around a node bind for their current item,
// or none when no iteration holds it: a callback to one, or a for...of
// loop's body.
const iterationNames = (
  node: Node,
): { readonly inside: boolean; readonly names: ReadonlyArray<string> } => {
  const parent = node.parent
  if (parent === null) {
    return { inside: false, names: [] }
  }
  const outer = iterationNames(parent)
  if (
    isFunctionNode(node) &&
    parent.type === 'CallExpression' &&
    parent.callee !== node &&
    isIteration(parent)
  ) {
    return {
      inside: true,
      names: [...outer.names, ...Array.flatMap(node.params, boundNames)],
    }
  }
  if (parent.type === 'ForOfStatement' && parent.body === node) {
    return { inside: true, names: [...outer.names, ...boundNames(parent.left)] }
  }
  return outer
}

export const noNestedScan = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A linear scan of one list for each item of another is O(n times m) every tick: index the inner list once, or name its bound in a NOTE and disable the rule.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const list = scannedList(node)
        if (list === undefined) {
          return
        }
        // NOTE: a list read off the current item (`zombie.parts`,
        // `drawingOf(kind)(box, level)`) is that item's own work.
        const around = iterationNames(node)
        if (
          !around.inside ||
          Array.some(around.names, name => mentions(list, name))
        ) {
          return
        }
        context.report({
          node,
          message:
            'A scan of one list inside a loop over another runs n times m every tick: index the inner list once (a Map or Set built before the loop), or, when a list is bounded, name the bound in a NOTE and disable the rule (AGENTS.md "Keep the frame cheap").',
        })
      },
    }
  },
})
