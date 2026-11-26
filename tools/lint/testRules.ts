import { Array } from 'effect'

import { defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

import {
  hasName,
  importSource,
  importedName,
  isFunctionNode,
  propertyName,
} from './ast.ts'

type Node = ESTree.Node

const RUN_METHODS: ReadonlySet<string> = new Set([
  'runPromise',
  'runPromiseExit',
  'runSync',
  'runSyncExit',
  'runFork',
  'runCallback',
])

const RUN_IN_TESTS_MESSAGE =
  'A test runs its Effect with it.effect from @effect/vitest (it.live for real time, layer(...) to share a Layer), not by hand or through a runtime (AGENTS.md "Code shape").'

const EFFECT_MODULES = /^effect(\/(Effect|Runtime|ManagedRuntime))?$/

export const noRunInTests = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Run a test's Effect with it.effect from @effect/vitest, not Effect.runPromise, runSync, runFork, or a runtime's.",
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (hasName(RUN_METHODS, propertyName(node))) {
          context.report({ node, message: RUN_IN_TESTS_MESSAGE })
        }
      },
      ImportSpecifier(node) {
        if (
          EFFECT_MODULES.test(importSource(node) ?? '') &&
          RUN_METHODS.has(importedName(node))
        ) {
          context.report({ node, message: RUN_IN_TESTS_MESSAGE })
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'ManagedRuntime' &&
          propertyName(node.callee) === 'make'
        ) {
          context.report({ node, message: RUN_IN_TESTS_MESSAGE })
        }
      },
    }
  },
})

const STORY_NAMESPACES: ReadonlySet<string> = new Set([
  'Story',
  'Scene',
  'HtmlScene',
  'HtmlPlay',
])

const isStoryCall = (node: ESTree.CallExpression, name: string): boolean =>
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  STORY_NAMESPACES.has(node.callee.object.name) &&
  propertyName(node.callee) === name

const EFFECT_RUNNERS: ReadonlySet<string> = new Set([
  'effect',
  'live',
  'scoped',
  'scopedLive',
  'flakyTest',
])

const EFFECT_CARRIERS: ReadonlySet<string> = new Set([
  'Effect',
  'Layer',
  'Stream',
  'Function',
])

const FLOATING_STORY_MESSAGE =
  'Story.make, Scene.make, HtmlScene.make, and HtmlPlay.make are scoped Effects that run only when yielded (`const s = yield* Story.make(...)` in it.effect), returned from it.effect, or passed to an Effect combinator (Effect.forEach, Effect.all): in Array.forEach, a plain test, or a statement they never run (AGENTS.md "Every Story is yielded or returned").'

const calleePath = (node: Node): ReadonlyArray<string> =>
  node.type === 'Identifier'
    ? [node.name]
    : node.type === 'MemberExpression'
      ? [...calleePath(node.object), propertyName(node) ?? '?']
      : node.type === 'CallExpression'
        ? calleePath(node.callee)
        : node.type === 'ChainExpression'
          ? calleePath(node.expression)
          : ['?']

type CallRole = 'Runs' | 'Carries' | 'Drops'

const callRole = (call: ESTree.CallExpression): CallRole => {
  const path = calleePath(call.callee)
  const root = path[0] ?? '?'
  const last = path.at(-1) ?? '?'
  if (root === 'it' && Array.some(path, name => EFFECT_RUNNERS.has(name))) {
    return 'Runs'
  }
  if (EFFECT_CARRIERS.has(root) || last === 'pipe' || last === 'map') {
    return 'Carries'
  }
  return 'Drops'
}

const enclosingFunction = (node: Node): Node | undefined =>
  node.parent === null
    ? undefined
    : isFunctionNode(node.parent)
      ? node.parent
      : enclosingFunction(node.parent)

const isArgumentOf = (
  node: Node,
  parent: Node,
): parent is ESTree.CallExpression =>
  parent.type === 'CallExpression' &&
  parent.callee !== node &&
  Array.some(parent.arguments, argument => argument === node)

const callKeeps = (call: ESTree.CallExpression): boolean => {
  const role = callRole(call)
  return role === 'Runs' || (role === 'Carries' && isKept(call))
}

const returnKeeps = (fn: Node): boolean =>
  fn.parent === null || !isArgumentOf(fn, fn.parent) || callKeeps(fn.parent)

const PASS_THROUGH: ReadonlySet<string> = new Set([
  'ParenthesizedExpression',
  'TSAsExpression',
  'TSSatisfiesExpression',
  'TSNonNullExpression',
  'ChainExpression',
  'LogicalExpression',
  'ArrayExpression',
  'SpreadElement',
])

const DROPS: ReadonlySet<string> = new Set([
  'ExpressionStatement',
  'SequenceExpression',
  'AwaitExpression',
  'UnaryExpression',
])

const isKept = (node: Node): boolean => {
  const parent = node.parent
  if (parent === null) {
    return true
  }
  if (
    PASS_THROUGH.has(parent.type) ||
    (parent.type === 'ConditionalExpression' && parent.test !== node)
  ) {
    return isKept(parent)
  }
  if (DROPS.has(parent.type)) {
    return false
  }
  if (parent.type === 'YieldExpression' || parent.type === 'ReturnStatement') {
    const fn = enclosingFunction(parent)
    return fn === undefined || returnKeeps(fn)
  }
  if (parent.type === 'ArrowFunctionExpression' && parent.body === node) {
    return returnKeeps(parent)
  }
  if (
    parent.type === 'MemberExpression' &&
    parent.object === node &&
    propertyName(parent) === 'pipe' &&
    parent.parent.type === 'CallExpression'
  ) {
    return isKept(parent.parent)
  }
  if (isArgumentOf(node, parent)) {
    return callKeeps(parent)
  }
  return true
}

export const noFloatingStory = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Story.make, Scene.make, HtmlScene.make, and HtmlPlay.make are yielded, returned to it.effect, or passed to an Effect combinator, so they run.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isStoryCall(node, 'make') && !isKept(node)) {
          context.report({ node, message: FLOATING_STORY_MESSAGE })
        }
      },
    }
  },
})

const ROOT_RUNNERS = /(^|\/)app\/(pureApp|main)(\.ts)?$/

const PURE_RUNNERS: ReadonlySet<string> = new Set(['update', 'view', 'init'])

const THROW_ASSERTS: ReadonlySet<string> = new Set([
  'throws',
  'throw',
  'toThrow',
  'toThrowError',
])

const PLAIN_STORY_MESSAGE =
  'Drive the game through Story.make, Scene.make, or HtmlScene.make over the root component or a child component, not the root\'s update, view, or init by hand (src/app/pureApp.ts, src/app/main.ts) (AGENTS.md "Tests drive the root through Stories and Scenes").'

const START_MESSAGE =
  'A Story or Scene made with start has no end check, so a Command left pending passes: use make (`yield* Story.make(...)`), or keep start inside the assert that the step throws (AGENTS.md "Tests drive the root through Stories and Scenes").'

const insideThrowAssert = (node: Node): boolean =>
  node.parent !== null &&
  ((node.parent.type === 'CallExpression' &&
    Array.some(calleePath(node.parent.callee), name =>
      THROW_ASSERTS.has(name),
    )) ||
    insideThrowAssert(node.parent))

export const noPlainStory = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Drive the game through a Story or Scene over a component, not the root's update, view, or init by hand, and make it with an end check.",
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        const isTypeOnly =
          node.importKind === 'type' ||
          (node.parent.type === 'ImportDeclaration' &&
            node.parent.importKind === 'type')
        if (
          ROOT_RUNNERS.test(importSource(node) ?? '') &&
          PURE_RUNNERS.has(importedName(node)) &&
          !isTypeOnly
        ) {
          context.report({ node, message: PLAIN_STORY_MESSAGE })
        }
      },
      CallExpression(node) {
        if (isStoryCall(node, 'start') && !insideThrowAssert(node)) {
          context.report({ node, message: START_MESSAGE })
        }
      },
    }
  },
})
