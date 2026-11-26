import { Array, Option } from 'effect'

import { defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

import {
  hasName,
  isFunctionNode,
  isStringLiteral,
  isWorldNamed,
  mentions,
  propertyName,
} from './ast.ts'

type Node = ESTree.Node

type FunctionNode = ESTree.ArrowFunctionExpression | ESTree.Function

const unwrap = (node: Node): Node =>
  node.type === 'TSAsExpression' ||
  node.type === 'TSSatisfiesExpression' ||
  node.type === 'TSNonNullExpression' ||
  node.type === 'ParenthesizedExpression' ||
  node.type === 'ChainExpression'
    ? unwrap(node.expression)
    : node

const effectArrayMethod = (callee: Node): string | undefined =>
  callee.type === 'MemberExpression' &&
  callee.object.type === 'Identifier' &&
  callee.object.name === 'Array'
    ? propertyName(callee)
    : undefined

const nativeMethod = (callee: Node): string | undefined =>
  callee.type === 'MemberExpression' &&
  !(callee.object.type === 'Identifier' && /^[A-Z]/.test(callee.object.name))
    ? propertyName(callee)
    : undefined

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

const scannedList = (call: ESTree.CallExpression): Node | undefined => {
  const effectName = effectArrayMethod(call.callee)
  const arity = effectName === undefined ? undefined : EFFECT_SCANS[effectName]
  if (arity !== undefined) {
    return call.arguments.length >= arity ? call.arguments[0] : undefined
  }
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
    return {
      inside: true,
      names: [...outer.names, ...boundNames(parent.left)],
    }
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

const isWorldOfCall = (node: Node): boolean => {
  const inner = unwrap(node)
  return (
    (inner.type === 'CallExpression' &&
      inner.callee.type === 'Identifier' &&
      inner.callee.name === 'worldOf') ||
    isWorldNamed(inner)
  )
}

export const stepWorldAlone = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Step the World alone: hand stepWorld worldOf(model), never the whole client Model.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type !== 'Identifier' ||
          node.callee.name !== 'stepWorld'
        ) {
          return
        }
        const first = node.arguments[0]
        if (first === undefined || isWorldOfCall(first)) {
          return
        }
        context.report({
          node,
          message:
            'stepWorld given the client Model copies every Model field on each World write: pass worldOf(model) and merge back with withWorld (AGENTS.md "Keep the frame cheap").',
        })
      },
    }
  },
})

const KEYED_METHODS: ReadonlySet<string> = new Set([
  'get',
  'has',
  'set',
  'add',
  'delete',
])

const isBuiltString = (node: Node | null | undefined): boolean => {
  if (node === null || node === undefined) {
    return false
  }
  const inner = unwrap(node)
  return inner.type === 'TemplateLiteral' && inner.expressions.length > 0
}

const isKeyName = (name: string): boolean => /(key|Key|KeyOf)$/.test(name)

const STRING_KEY_MESSAGE =
  'A key built as a string on every frame allocates and hashes it each time: key the table by a number, by the object itself, or by its parts as a Map of Maps, or build the key once per level (AGENTS.md "Keep the frame cheap").'

export const noStringKeyPerFrame = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Code that runs every frame looks tables up by numbers or objects, never by a string key built for the lookup.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const { callee } = node
        if (
          callee.type === 'MemberExpression' &&
          hasName(KEYED_METHODS, propertyName(callee)) &&
          isBuiltString(node.arguments[0])
        ) {
          context.report({ node, message: STRING_KEY_MESSAGE })
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !isKeyName(node.id.name)) {
          return
        }
        const init = node.init === null ? undefined : unwrap(node.init)
        const isKeyBuilder =
          init?.type === 'ArrowFunctionExpression' &&
          init.body.type !== 'BlockStatement' &&
          isBuiltString(init.body)
        if (isBuiltString(init) || isKeyBuilder) {
          context.report({ node, message: STRING_KEY_MESSAGE })
        }
      },
    }
  },
})
