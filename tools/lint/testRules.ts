// NOTE: the project's oxlint rules about tests: Effects run by it.effect,
// a live test says why, and every Block-aware Story and Scene runs.
// Loaded through tools/lint/munchPlugin.ts, which names them.

import { Array, Option, Record, String } from 'effect'

import { defineRule } from '@oxlint/plugins'
import type { ESTree } from '@oxlint/plugins'

import { hasName, importSource, importedName, propertyName } from './ast.ts'

type Node = ESTree.Node

// NOTE: the ways to run an Effect by hand: off `Effect`, a `Runtime`, or a
// `ManagedRuntime` (`runtime.runPromise(...)`), or imported by name. A test
// runs its Effect with `it.effect` from @effect/vitest instead, which gives
// it a Scope and the TestClock.
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
      // NOTE: a runtime of the test's own: `ManagedRuntime.make(layer)`.
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

// NOTE: `it.live(...)` runs a test on the real clock, which a loaded
// machine can slow into a timeout. The TestClock is the default, so a live
// test says why it needs real time in a NOTE right above it.
const isItLive = (node: ESTree.Expression): boolean =>
  node.type === 'MemberExpression' &&
  !node.computed &&
  node.object.type === 'Identifier' &&
  node.object.name === 'it' &&
  propertyName(node) === 'live'

export const liveTestNote = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A test on the real clock (it.live) says why in a NOTE right above it.',
    },
  },
  create(context) {
    return {
      ExpressionStatement(node) {
        const call = node.expression
        if (call.type !== 'CallExpression' || !isItLive(call.callee)) {
          return
        }
        const hasNote = Array.some(
          context.sourceCode.getCommentsBefore(node),
          comment => String.startsWith('NOTE:')(String.trim(comment.value)),
        )
        if (!hasNote) {
          context.report({
            node,
            message:
              'it.live runs on the real clock: use it.effect and the TestClock (settle, first), or say why this needs real time in a // NOTE: right above it (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

// NOTE: a Block-aware Story or Scene (`Story.story(APPLICATION, ...)`) is
// an Effect: built and dropped, it never runs, and its asserts pass by not
// running. The plain form over an update function (`story(update, ...)`,
// `scene(ROOT, ...)`) runs on the spot, so a statement of it is fine.
const STORY_MODULES = /^foldkit(\/(story|scene))?$/

const STORY_NAMESPACES: Readonly<Record<string, string>> = {
  Story: 'story',
  Scene: 'scene',
}

const PLAIN_UPDATE = /^(update|ROOT)$|Update$/

// NOTE: the plain form's subject: an update function by name, or a record
// with an update in it (`{ update, view }`). A Block's config never has one
// (`{ block, layer }`, `{ ...COOP, viewInputs }`).
const isPlainSubject = (node: Node | undefined): boolean =>
  (node?.type === 'Identifier' && PLAIN_UPDATE.test(node.name)) ||
  (node?.type === 'ObjectExpression' &&
    Array.some(
      node.properties,
      property =>
        property.type === 'Property' &&
        property.key.type === 'Identifier' &&
        property.key.name === 'update',
    ))

// NOTE: a test runner that runs the Effect its callback returns. A plain
// `test` or `it` takes the Effect as a value and never runs it.
const EFFECT_RUNNERS: ReadonlySet<string> = new Set([
  'effect',
  'live',
  'scoped',
  'scopedLive',
  'flakyTest',
])

// NOTE: calls that hand the Effect on, so where the call's own value goes
// decides: Effect's, Layer's, and Stream's combinators, pipe, and a map
// that makes a list of Effects (for Effect.all).
const EFFECT_CARRIERS: ReadonlySet<string> = new Set([
  'Effect',
  'Layer',
  'Stream',
  'Function',
])

const FLOATING_STORY_MESSAGE =
  'A Block-aware Story or Scene is an Effect that runs only when yielded, returned from it.effect, or passed to an Effect combinator (Effect.forEach, Effect.all): in Array.forEach, a plain test, or a statement it never runs (AGENTS.md "Every Story is yielded or returned").'

// NOTE: the names along a callee: `it.effect.each(rows)` is it, effect,
// each; `Effect.forEach` is Effect, forEach.
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

const isFunctionNode = (node: Node): boolean =>
  node.type === 'ArrowFunctionExpression' ||
  node.type === 'FunctionExpression' ||
  node.type === 'FunctionDeclaration'

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

// NOTE: whether the Effect a call makes reaches something that runs it.
const callKeeps = (call: ESTree.CallExpression): boolean => {
  const role = callRole(call)
  return role === 'Runs' || (role === 'Carries' && isKept(call))
}

// NOTE: a function that returns or yields the Effect keeps it when its
// caller does: a callback to a runner or an Effect combinator, or one held
// by name. A callback to anything else (Array.forEach, a plain test)
// drops what it returns.
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
        'A Block-aware Story or Scene is yielded, returned to it.effect, or passed to an Effect combinator, so it runs.',
    },
  },
  create(context) {
    const bareNames = new Set<string>()
    const isStoryCallee = (callee: Node): boolean =>
      callee.type === 'Identifier'
        ? bareNames.has(callee.name)
        : callee.type === 'MemberExpression' &&
          callee.object.type === 'Identifier' &&
          Option.isSome(
            Option.filter(
              Record.get(STORY_NAMESPACES, callee.object.name),
              name => name === propertyName(callee),
            ),
          )
    return {
      ImportSpecifier(node) {
        const name = importedName(node)
        if (
          STORY_MODULES.test(importSource(node) ?? '') &&
          (name === 'story' || name === 'scene')
        ) {
          bareNames.add(node.local.name)
        }
      },
      CallExpression(node) {
        if (!isStoryCallee(node.callee) || isPlainSubject(node.arguments[0])) {
          return
        }
        if (!isKept(node)) {
          context.report({ node, message: FLOATING_STORY_MESSAGE })
        }
      },
    }
  },
})

// NOTE: a test drives the game as a Block-aware Story or Scene over the
// root (`APPLICATION` in src/test/testing.ts) or a child Block, never the
// plain form over an update function, which skips the Block's graph
// (`story(update, ...)`, `Scene.scene({ update, view }, ...)`), nor
// pureApp's acquired update, view, or init called by hand. A view of its
// own over the acquired root is a custom renderer, written inside
// `Story.withBlock(...)` (FOLDKIT.md "Testing"). The one plain Scene left,
// over a bare canvas with no Block, is named in the config's override.
const PURE_APP = /(^|\/)app\/pureApp$/

const PURE_RUNNERS: ReadonlySet<string> = new Set(['update', 'view', 'init'])

const PLAIN_STORY_MESSAGE =
  'Drive the game through a Block-aware Story or Scene over APPLICATION (src/test/testing.ts) or a child Block, not a plain story or scene over an update function or pureApp\'s update, view, or init; a view of its own goes inside Story.withBlock (AGENTS.md "Tests drive the root through Block-aware Stories and Scenes").'

const isWithBlockCall = (node: Node): boolean =>
  node.type === 'CallExpression' &&
  calleePath(node.callee).at(-1) === 'withBlock'

const insideWithBlock = (node: Node): boolean =>
  node.parent !== null &&
  (isWithBlockCall(node.parent) || insideWithBlock(node.parent))

export const noPlainStory = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Drive the game through a Block-aware Story or Scene, not a plain one over an update function or pureApp's update, view, or init.",
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        const source = importSource(node) ?? ''
        const name = importedName(node)
        const isTypeOnly =
          node.importKind === 'type' ||
          (node.parent.type === 'ImportDeclaration' &&
            node.parent.importKind === 'type')
        if (
          (STORY_MODULES.test(source) &&
            source !== 'foldkit' &&
            (name === 'story' || name === 'scene')) ||
          (PURE_APP.test(source) && PURE_RUNNERS.has(name) && !isTypeOnly)
        ) {
          context.report({ node, message: PLAIN_STORY_MESSAGE })
        }
      },
      CallExpression(node) {
        const path = calleePath(node.callee)
        const isStoryCall =
          path.length === 2 &&
          Option.isSome(
            Option.filter(
              Record.get(STORY_NAMESPACES, path[0] ?? ''),
              name => name === path[1],
            ),
          )
        if (
          isStoryCall &&
          isPlainSubject(node.arguments[0]) &&
          !insideWithBlock(node)
        ) {
          context.report({ node, message: PLAIN_STORY_MESSAGE })
        }
      },
    }
  },
})
