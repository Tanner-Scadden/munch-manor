// NOTE: the project's own oxlint rules (AGENTS.md "Code shape"), loaded as a
// JS plugin by .oxlintrc.json and infra's config. TypeScript over oxlint's
// typed AST (`@oxlint/plugins`), so typecheck and lint cover it too; oxlint
// loads it in Node, which strips the types, with no build step.
// tools/lint/munchPlugin.test.ts runs every rule on code it must and must
// not flag.

import { definePlugin, defineRule } from '@oxlint/plugins'
import type { ESTree, SourceCode } from '@oxlint/plugins'

type Node = ESTree.Node

const isTagMember = (
  node: Node | null | undefined,
): node is ESTree.StaticMemberExpression =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === '_tag'

const unwrapChain = (node: ESTree.Expression): Node =>
  node.type === 'ChainExpression' ? node.expression : node

const isStringLiteral = (
  node: Node | null | undefined,
): node is ESTree.StringLiteral =>
  node?.type === 'Literal' && typeof node.value === 'string'

// NOTE: the source text of X in `X._tag === 'Name'` (either side, === or
// !==), or of the shared X in `X._tag === 'A' || X._tag === 'B'`, or of the
// first X in `X._tag === 'A' && more`. Anything else has no subject.
const tagSubject = (
  node: ESTree.Expression,
  sourceCode: SourceCode,
): string | undefined => {
  if (
    node.type === 'BinaryExpression' &&
    (node.operator === '===' || node.operator === '!==')
  ) {
    const left = unwrapChain(node.left)
    const right = unwrapChain(node.right)
    const member =
      isTagMember(left) && isStringLiteral(right)
        ? left
        : isTagMember(right) && isStringLiteral(left)
          ? right
          : undefined
    return member === undefined ? undefined : sourceCode.getText(member.object)
  }
  if (node.type === 'LogicalExpression' && node.operator === '||') {
    const left = tagSubject(node.left, sourceCode)
    return left !== undefined && left === tagSubject(node.right, sourceCode)
      ? left
      : undefined
  }
  if (node.type === 'LogicalExpression' && node.operator === '&&') {
    return tagSubject(node.left, sourceCode)
  }
  return undefined
}

const endsInReturn = (node: ESTree.Statement): boolean =>
  node.type === 'ReturnStatement' ||
  (node.type === 'BlockStatement' &&
    node.body.at(-1)?.type === 'ReturnStatement')

const TAG_CHAIN_MESSAGE =
  'A chain of _tag checks on one value: match it exhaustively with the union\'s .match, Match.valueTags, or Match.tags (AGENTS.md "Code shape").'

const noTagChain = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Match a union exhaustively instead of chaining checks on its _tag.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    // NOTE: `if (x._tag === 'A') { return … } if (x._tag === 'B') { return … }`
    const checkBody = (body: ReadonlyArray<Node>): void => {
      body.forEach((current, index) => {
        const previous = body[index - 1]
        if (
          previous?.type !== 'IfStatement' ||
          current.type !== 'IfStatement' ||
          previous.alternate !== null ||
          !endsInReturn(previous.consequent)
        ) {
          return
        }
        const subject = tagSubject(previous.test, sourceCode)
        if (
          subject !== undefined &&
          tagSubject(current.test, sourceCode) === subject
        ) {
          context.report({ node: previous, message: TAG_CHAIN_MESSAGE })
        }
      })
    }
    return {
      // NOTE: `if (x._tag === 'A') … else if (x._tag === 'B') …`
      IfStatement(node) {
        if (
          node.parent.type === 'IfStatement' &&
          node.parent.alternate === node
        ) {
          return
        }
        const subject = tagSubject(node.test, sourceCode)
        if (subject === undefined) {
          return
        }
        const next = node.alternate
        if (
          next?.type === 'IfStatement' &&
          tagSubject(next.test, sourceCode) === subject
        ) {
          context.report({ node, message: TAG_CHAIN_MESSAGE })
        }
      },
      BlockStatement: node => checkBody(node.body),
      Program: node => checkBody(node.body),
      StaticBlock: node => checkBody(node.body),
      // NOTE: `x._tag === 'A' ? a : x._tag === 'B' ? b : c`
      ConditionalExpression(node) {
        if (
          node.parent.type === 'ConditionalExpression' &&
          node.parent.alternate === node
        ) {
          return
        }
        const subject = tagSubject(node.test, sourceCode)
        const next = node.alternate
        if (
          subject !== undefined &&
          next.type === 'ConditionalExpression' &&
          tagSubject(next.test, sourceCode) === subject
        ) {
          context.report({ node, message: TAG_CHAIN_MESSAGE })
        }
      },
    }
  },
})

const unwrapReadonly = (
  node: ESTree.TSType | undefined,
): ESTree.TSType | undefined =>
  node?.type === 'TSTypeReference' &&
  node.typeName.type === 'Identifier' &&
  node.typeName.name === 'Readonly' &&
  node.typeArguments?.params.length === 1
    ? node.typeArguments.params[0]
    : node

const hasTagMember = (node: ESTree.TSType | undefined): boolean =>
  node?.type === 'TSTypeLiteral' &&
  node.members.some(
    member =>
      member.type === 'TSPropertySignature' &&
      ((member.key.type === 'Identifier' && member.key.name === '_tag') ||
        (isStringLiteral(member.key) && member.key.value === '_tag')),
  )

const noExtractTag = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Name a union variant once beside the union instead of Extract<Union, { _tag }>.',
    },
  },
  create(context) {
    return {
      TSTypeReference(node) {
        const params = node.typeArguments?.params
        if (
          node.typeName.type === 'Identifier' &&
          node.typeName.name === 'Extract' &&
          params?.length === 2 &&
          hasTagMember(unwrapReadonly(params[1]))
        ) {
          context.report({
            node,
            message:
              'Name the variant once beside its union (type Turret = typeof Trap.Turret.Type) and use that name (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

// NOTE: `JSON.parse` and `JSON.stringify`, or the same off `globalThis`.
// oxlint's no-restricted-properties would do, but an override replaces its
// whole list, so the files allowed raw JSON would have to repeat every
// other restricted property. A rule of its own is turned off file by file.
const isJsonObject = (node: ESTree.Expression): boolean =>
  (node.type === 'Identifier' && node.name === 'JSON') ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === 'globalThis' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'JSON')

const propertyName = (node: ESTree.MemberExpression): string | undefined =>
  node.computed
    ? isStringLiteral(node.property)
      ? node.property.value
      : undefined
    : node.property.type === 'Identifier'
      ? node.property.name
      : undefined

const hasName = (
  names: ReadonlySet<string>,
  name: string | undefined,
): boolean => name !== undefined && names.has(name)

const RAW_JSON_METHODS: ReadonlySet<string> = new Set(['parse', 'stringify'])

const noRawJson = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Read and write JSON through a Schema (Schema.fromJsonString, schemaBodyJson) instead of raw JSON.parse or JSON.stringify.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          isJsonObject(node.object) &&
          hasName(RAW_JSON_METHODS, propertyName(node))
        ) {
          context.report({
            node,
            message:
              'Raw JSON skips the Schema: use Schema.fromJsonString(YourSchema) or HttpClientRequest.schemaBodyJson, or add the file to the no-raw-json allowlist with a reason (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

// NOTE: the name m in `{ model: m }`, `{ model }`, or `unchanged(m)`: a
// Step's result that changes nothing. Anything else has no name.
const bareModelName = (node: ESTree.Expression): string | undefined => {
  const only =
    node.type === 'ObjectExpression' && node.properties.length === 1
      ? node.properties[0]
      : undefined
  if (
    only?.type === 'Property' &&
    !only.computed &&
    only.key.type === 'Identifier' &&
    only.key.name === 'model' &&
    only.value.type === 'Identifier'
  ) {
    return only.value.name
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'unchanged' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === 'Identifier'
  ) {
    return node.arguments[0].name
  }
  return undefined
}

// NOTE: whether the name appears in the node, at any depth: `step(m)`,
// `leaveFor(m, 'Kicked')`, `playSounds(cues)(keep(m))`. The walk reads each
// field of a node as unknown, skipping the link back to its parent.
const mentions = (value: unknown, name: string): boolean => {
  if (Array.isArray(value)) {
    return value.some((child: unknown) => mentions(child, name))
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  if ('type' in value && value.type === 'Identifier') {
    return 'name' in value && value.name === name
  }
  return Object.keys(value).some(key => {
    const child: unknown = Reflect.get(value, key)
    return key !== 'parent' && mentions(child, name)
  })
}

const isStepCallOn = (
  node: ESTree.Expression,
  name: string | undefined,
): boolean =>
  name !== undefined &&
  node.type === 'CallExpression' &&
  (node.arguments.some(argument => mentions(argument, name)) ||
    isStepCallOn(node.callee, name))

const noConditionalStep = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Run a Step on a condition with stepWhen, not a ternary whose other branch is { model }.',
    },
  },
  create(context) {
    return {
      // NOTE: `cond ? step(m) : { model: m }`, either way round.
      ConditionalExpression(node) {
        if (
          isStepCallOn(node.consequent, bareModelName(node.alternate)) ||
          isStepCallOn(node.alternate, bareModelName(node.consequent))
        ) {
          context.report({
            node,
            message:
              'A Step run on a condition: use stepWhen(isDue, step) from src/stepWhen.ts, or match the union when the condition narrows it (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

const WORLD_NAME = /^world$|World$/

// NOTE: a value named as a World: `world`, `nextWorld`, `x.world`.
const isWorldNamed = (node: ESTree.Expression): boolean =>
  (node.type === 'Identifier' && WORLD_NAME.test(node.name)) ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.property.type === 'Identifier' &&
    WORLD_NAME.test(node.property.name))

const noWorldSpread = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Merge a World into a Model with withWorld, not by spreading it.',
    },
  },
  create(context) {
    return {
      // NOTE: `{ ...model, ...world }`: a spread after the first one.
      ObjectExpression(node) {
        node.properties.forEach((property, index) => {
          if (
            index > 0 &&
            property.type === 'SpreadElement' &&
            isWorldNamed(property.argument)
          ) {
            context.report({
              node: property,
              message:
                'A World spread over a Model: use withWorld(model, step) from src/world.ts (AGENTS.md "Code shape").',
            })
          }
        })
      },
    }
  },
})

// NOTE: the Model fields that say which menu is up. menuState in
// src/menuState.ts reads them; everything else reads menuState. A new
// dialog Binding joins this list and MenuState together.
const DIALOG_FIELDS: ReadonlySet<string> = new Set([
  'shopDialog',
  'profileDialog',
  'panelDialog',
  'handDialog',
  'homeScreenSteps',
  'updateGreeting',
])

const memberName = (node: Node): string | undefined =>
  node.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier'
    ? node.property.name
    : undefined

const noMenuField = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Read which menu is up from menuState(model), not from the dialog and co-op fields.',
    },
  },
  create(context) {
    return {
      // NOTE: `model.profileDialog.isOpen`, `model.coop.screen`.
      MemberExpression(node) {
        const name = memberName(node)
        const owner = memberName(node.object)
        if (
          (name === 'isOpen' && hasName(DIALOG_FIELDS, owner)) ||
          (name === 'screen' && owner === 'coop')
        ) {
          context.report({
            node,
            message:
              'Which menu is up comes from menuState(model) in src/menuState.ts (or isCoopOpen for co-op), so every gate agrees (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

// NOTE: `f(...)` or `Owner.f(...)` for the named f.
const isCallOf = (
  node: Node | null,
  name: string,
): node is ESTree.CallExpression =>
  node?.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === name) ||
    memberName(node.callee) === name)

const commandBesideUpdate = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Define a Command in the module whose update returns it, not in a module of Commands.',
    },
  },
  create(context) {
    const commands: Array<ESTree.BindingIdentifier> = []
    const called = new Set<string>()
    return {
      // NOTE: `const X = makeCommand(...)` or `const X = Definition.makeCommand(...)`.
      VariableDeclarator(node) {
        if (
          node.id.type === 'Identifier' &&
          isCallOf(node.init, 'makeCommand')
        ) {
          commands.push(node.id)
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier') {
          called.add(node.callee.name)
        }
      },
      'Program:exit'() {
        commands
          .filter(command => !called.has(command.name))
          .forEach(command =>
            context.report({
              node: command,
              message: `${command.name} is never returned here: define a Command beside the update that returns it, and its .layer joins CommandsLayer in src/layer.ts (AGENTS.md "Code shape").`,
            }),
          )
      },
    }
  },
})

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

const importSource = (node: ESTree.ImportSpecifier): string | undefined =>
  node.parent.type === 'ImportDeclaration'
    ? node.parent.source.value
    : undefined

const importedName = (node: ESTree.ImportSpecifier): string =>
  isStringLiteral(node.imported) ? node.imported.value : node.imported.name

const noRunInTests = defineRule({
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

// NOTE: a press acts on its OnClick. src/touchTaps.ts makes every touch tap
// a click from that finger's own pointer events, so a button works with
// another finger on the glass and acts once. A handler on a touch's or a
// mouse's release, or on a touch's start, would act beside that click, or
// in its place on one device only. OnPointerDown stays allowed: the game
// surface, the HUD slots, and the hold-to-buy button act the moment a
// finger lands, which no click can.
const RELEASE_HANDLERS: ReadonlySet<string> = new Set([
  'OnTouchStart',
  'OnTouchEnd',
  'OnTouchCancel',
  'OnPointerUp',
  'OnMouseDown',
  'OnMouseUp',
])

const TAP_BY_CLICK_MESSAGE =
  'Act on OnClick: src/touchTaps.ts turns every touch tap into a click, so the press works with another finger down and acts once. OnPointerDown is the one press handler for acting as a finger lands.'

const tapByClick = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Act on OnClick (made from each finger by src/touchTaps.ts), never on a touch or mouse release or a touch start.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (hasName(RELEASE_HANDLERS, propertyName(node))) {
          context.report({ node, message: TAP_BY_CLICK_MESSAGE })
        }
      },
    }
  },
})

// NOTE: a player action's rule lives once, in src/stepWorld.ts, where the
// co-op room runs it; single player applies it through its lead seat
// (src/update/action.ts). A client module that imports a rule's own steps,
// or writes the fields a seat action owns, is deciding the action again.
const SEAT_ACTION_STEPS: ReadonlySet<string> = new Set([
  'swapInHand',
  'drawMelee',
  'drawSlot',
  'beginReload',
  'cycleTrap',
  'placeTrapIn',
  'purchase',
  'tryPurchase',
  'startWaveEarly',
  'markReady',
])

const SEAT_ACTION_MODULES = /(^|\/)(weapons|traps|shop|waves|revive)$/

const SEAT_ACTION_FIELDS: ReadonlySet<string> = new Set([
  'player',
  'wallet',
  'traps',
  'trapStock',
  'selectedTrap',
])

const SEAT_ACTION_MESSAGE =
  'A player action\'s rule lives once, in src/stepWorld.ts: apply it as a seat action (actAsLead or tryAsLead in src/update/action.ts) and wrap only the client cues around it (AGENTS.md "Code shape").'

const keyName = (property: ESTree.ObjectPropertyKind): string | undefined =>
  property.type === 'Property' && !property.computed
    ? property.key.type === 'Identifier'
      ? property.key.name
      : isStringLiteral(property.key)
        ? property.key.value
        : undefined
    : undefined

const seatActionOnce = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Apply a player action as a seat action from src/stepWorld.ts, never with the rule's own steps.",
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        if (
          SEAT_ACTION_MODULES.test(importSource(node) ?? '') &&
          SEAT_ACTION_STEPS.has(importedName(node))
        ) {
          context.report({ node, message: SEAT_ACTION_MESSAGE })
        }
      },
      CallExpression(node) {
        const changes = node.arguments[1]
        if (
          !isCallOf(node, 'modifyFields') ||
          changes?.type !== 'ObjectExpression'
        ) {
          return
        }
        changes.properties
          .filter(property => hasName(SEAT_ACTION_FIELDS, keyName(property)))
          .forEach(property =>
            context.report({ node: property, message: SEAT_ACTION_MESSAGE }),
          )
      },
    }
  },
})

export default definePlugin({
  meta: { name: 'munch' },
  rules: {
    'no-tag-chain': noTagChain,
    'no-extract-tag': noExtractTag,
    'no-raw-json': noRawJson,
    'no-conditional-step': noConditionalStep,
    'no-world-spread': noWorldSpread,
    'no-menu-field': noMenuField,
    'command-beside-update': commandBesideUpdate,
    'no-run-in-tests': noRunInTests,
    'tap-by-click': tapByClick,
    'seat-action-once': seatActionOnce,
  },
})
