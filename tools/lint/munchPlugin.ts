// NOTE: the project's own oxlint rules (AGENTS.md "Code shape"), loaded as a
// JS plugin by .oxlintrc.json and infra's config. TypeScript over oxlint's
// typed AST (`@oxlint/plugins`), so typecheck and lint cover it too; oxlint
// loads it in Node, which strips the types, with no build step.
// tools/lint/munchPlugin.test.ts runs every rule on code it must and must
// not flag.

import { Array, Option, Record, String } from 'effect'

import {
  type ESTree,
  type SourceCode,
  definePlugin,
  defineRule,
} from '@oxlint/plugins'

import {
  hasName,
  importSource,
  importedName,
  isStringLiteral,
  propertyName,
} from './ast.ts'
import {
  liveTestNote,
  noFloatingStory,
  noPlainStory,
  noRunInTests,
} from './testRules.ts'

type Node = ESTree.Node

const isTagMember = (
  node: Node | null | undefined,
): node is ESTree.StaticMemberExpression =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === '_tag'

// NOTE: a variable holding a tag itself: `tag`, `kindTag`.
const isTagName = (node: Node): node is ESTree.IdentifierReference =>
  node.type === 'Identifier' && /^tag$|Tag$/.test(node.name)

const unwrapChain = (node: ESTree.Expression): Node =>
  node.type === 'ChainExpression' ? node.expression : node

// NOTE: the source text of X in `X._tag === 'Name'` or of a tag held in
// a variable, `tag === 'Name'` (either side, === or !==), or of the shared X in `X._tag === 'A' || X._tag === 'B'`, or of the
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
        ? left.object
        : isTagMember(right) && isStringLiteral(left)
          ? right.object
          : isTagName(left) && isStringLiteral(right)
            ? left
            : isTagName(right) && isStringLiteral(left)
              ? right
              : undefined
    return member === undefined ? undefined : sourceCode.getText(member)
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
      Array.forEach(body, (current, index) => {
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
  Array.some(
    node.members,
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
}

const isStepCallOn = (
  node: ESTree.Expression,
  name: string | undefined,
): boolean =>
  name !== undefined &&
  node.type === 'CallExpression' &&
  (Array.some(node.arguments, argument => mentions(argument, name)) ||
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
              'A Step run on a condition: use stepWhen(isDue, step) from src/shared/stepWhen.ts, or match the union when the condition narrows it (AGENTS.md "Code shape").',
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
        Array.forEach(node.properties, (property, index) => {
          if (
            index > 0 &&
            property.type === 'SpreadElement' &&
            isWorldNamed(property.argument)
          ) {
            context.report({
              node: property,
              message:
                'A World spread over a Model: use withWorld(model, step) from src/world/schema/world.ts (AGENTS.md "Code shape").',
            })
          }
        })
      },
    }
  },
})

// NOTE: the Model fields that say which menu is up. menuState in
// src/app/menuState.ts reads them; everything else reads menuState. A new
// dialog Binding joins this list and MenuState together.
const DIALOG_FIELDS: ReadonlySet<string> = new Set([
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
              'Which menu is up comes from menuState(model) in src/app/menuState.ts (or isCoopOpen for co-op), so every gate agrees (AGENTS.md "Code shape").',
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
        Array.forEach(
          Array.filter(commands, command => !called.has(command.name)),
          command =>
            context.report({
              node: command,
              message: `${command.name} is never returned here: define a Command beside the update that returns it, and its .layer joins CommandsLayer in src/app/layer.ts (AGENTS.md "Code shape").`,
            }),
        )
      },
    }
  },
})

// NOTE: a press acts on its OnClick. src/input/touchTaps.ts makes every touch tap
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
  'Act on OnClick: src/input/touchTaps.ts turns every touch tap into a click, so the press works with another finger down and acts once. OnPointerDown is the one press handler for acting as a finger lands.'

const tapByClick = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Act on OnClick (made from each finger by src/input/touchTaps.ts), never on a touch or mouse release or a touch start.',
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

// NOTE: a player action's rule lives once, in src/world/step/stepWorld.ts, where the
// co-op room runs it; single player applies it through its lead seat
// (src/app/update/action.ts). A client module that imports a rule's own steps,
// or writes the fields a seat action owns, is deciding the action again.
const SEAT_ACTION_STEPS: ReadonlySet<string> = new Set([
  'swapInHand',
  'drawMelee',
  'drawSlot',
  'beginReload',
  'cycleTrap',
  'placeTrapIn',
  'startWaveEarly',
  'markReady',
])

const SEAT_ACTION_MODULES = /(^|\/)(weapons|traps|waves|revive)$/

const SEAT_ACTION_FIELDS: ReadonlySet<string> = new Set([
  'player',
  'traps',
  'trapStock',
  'selectedTrap',
])

// NOTE: the calls that change a seat's fields: any Model's fields, the seat a
// screen is about, a seat by slot, and the `seats` transform.
const SEAT_WRITERS: ReadonlyArray<string> = [
  'modifyFields',
  'modifyFocus',
  'modifySeat',
  'atSeat',
]

const SEAT_ACTION_MESSAGE =
  'A player action\'s rule lives once, in src/world/step/stepWorld.ts: apply it as a seat action (actAsLead or tryAsLead in src/app/update/action.ts) and wrap only the client cues around it (AGENTS.md "Code shape").'

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
        "Apply a player action as a seat action from src/world/step/stepWorld.ts, never with the rule's own steps.",
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
        if (!Array.some(SEAT_WRITERS, writer => isCallOf(node, writer))) {
          return
        }
        const maybeChanges = Array.findFirst(
          Array.drop(node.arguments, 1),
          (argument): argument is ESTree.ObjectExpression =>
            argument.type === 'ObjectExpression',
        )
        Array.forEach(
          Array.filter(
            Option.match(maybeChanges, {
              onNone: () => [],
              onSome: changes => changes.properties,
            }),
            property => hasName(SEAT_ACTION_FIELDS, keyName(property)),
          ),
          property =>
            context.report({ node: property, message: SEAT_ACTION_MESSAGE }),
        )
      },
    }
  },
})

// NOTE: READY's key is the interact key, held to buy at a purchasable, so
// only the one key table (src/input/keyActions.ts) asks whether the interact is
// taken. A key handler that asks itself is mapping keys to actions again.
const keyActionOnce = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Map a key to a seat action through src/input/keyActions.ts, the one key table.',
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        if (importedName(node) === 'isInteractTaken') {
          context.report({
            node,
            message:
              'A key presses a seat action through keyActionOf or playerKeyAction in src/input/keyActions.ts, which also keeps READY\'s key from starting a wave at a purchasable (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

// NOTE: the Model fields a child Block lives on through its Binding
// (src/app/bindings.ts, the Profile's own in
// src/features/profile/composition.ts, the lobby's in
// src/features/lobby/bindings.ts, the Munchopedia's in
// src/features/munchopedia/bindings.ts, and co-op's in
// src/features/coop/bindings.ts). The parent asks the child through its
// operations and never writes the field itself. A new Binding joins this
// list.
const BINDING_FIELDS: ReadonlySet<string> = new Set([
  ...DIALOG_FIELDS,
  'dialog',
  'profile',
  'tabs',
  'character',
  'lobby',
  'heroPicker',
  'heroDialog',
  'munchopedia',
  'guide',
  'coop',
])

const noBindingFieldWrite = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Change a child Block's state through its Binding's operations, never by writing its field.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const changes = node.arguments[1]
        if (
          !isCallOf(node, 'modifyFields') ||
          changes?.type !== 'ObjectExpression'
        ) {
          return
        }
        Array.forEach(
          Array.filter(changes.properties, property =>
            hasName(BINDING_FIELDS, keyName(property)),
          ),
          property =>
            context.report({
              node: property,
              message:
                'A child Block\'s field changes only through its Binding: call an operation (CoopBinding.requestKeepTracers(...)) from a makeStep (AGENTS.md "Blocks and Bindings").',
            }),
        )
      },
    }
  },
})

// NOTE: the folders of src (AGENTS.md "Folders"), in layers that import only
// down: src/app/ over src/screens/ (one folder per screen, each apart from
// the others) over src/features/ over the shared client layers
// (src/ui/, src/domain/, src/render/, src/art/, src/audio/, src/input/,
// src/platform/, which import each other freely) over src/world/ over
// src/shared/. src/world/ is what the co-op room loads, so it reaches only
// itself and src/shared/; src/shared/ reaches only itself. Both import only
// the packages the room's bundle carries (Effect and Foldkit's pure struct
// and schema modules) and the netcode package's types. Shipped code never
// imports a test home (src/test/) or a test's folder (__tests__/). Tests
// may import anything.
const SRC_PATH = /(?:^|\/)src\/(.*)$/

const LAYER_RANKS: Readonly<Record<string, number>> = {
  app: 5,
  screens: 4,
  features: 3,
  ui: 2,
  domain: 2,
  render: 2,
  art: 2,
  audio: 2,
  input: 2,
  platform: 2,
  world: 1,
  shared: 0,
}

const FOLDERS_ALLOWED: Readonly<Record<string, ReadonlyArray<string>>> = {
  world: ['world', 'shared'],
  shared: ['shared'],
}

const ROOM_PACKAGES = /^(effect(\/.*)?|foldkit\/(struct|schema))$/

const ROOM_TYPE_PACKAGES = /^@munch\/netcode$/

// NOTE: the one way up: a type, never a value, of the root's one Model and
// of its view builder. A feature's rules and views, and the client layers'
// drawing, read the root's Model, which is the World's fields beside the
// client's own (src/app/model.ts); a view built with the root's builder
// sends the root's Messages. Each is a type, so it brings no module along.
const ROOT_TYPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'app/model': ['Model'],
  'app/composition': ['ApplicationViewBuilder', 'ApplicationAttribute'],
}

// NOTE: a feature never imports another, but for a parent Block that binds a
// child Block (FOLDKIT.md "File organization"): the parent imports the
// child's contract, the files a Binding needs and nothing more.
const CHILD_BLOCKS: Readonly<Record<string, ReadonlyArray<string>>> = {
  // NOTE: the single player lobby opens the hero picker from its hero card.
  lobby: ['heroes'],
  // NOTE: co-op's lobby opens the same hero picker from its hero pill.
  coop: ['heroes'],
  // NOTE: the Munchopedia shows the guide to the house's finds on its
  // Finds page.
  munchopedia: ['guide'],
}

const CONTRACT_FILES: ReadonlyArray<string> = [
  'block',
  'layer',
  'model',
  'message',
  'inMessage',
]

const isTestPath = (path: string): boolean =>
  String.startsWith('test/')(path) || String.includes('__tests__/')(path)

// NOTE: a relative import's path under src, from the importer's path under
// src, or none when it leaves src.
const resolveUnderSrc = (
  importer: string,
  spec: string,
): Option.Option<string> =>
  Option.map(
    Array.reduce(
      String.split('/')(spec),
      Option.some(Array.dropRight(String.split('/')(importer), 1)),
      (maybeSegments, segment) =>
        Option.flatMap(maybeSegments, segments =>
          segment === '.'
            ? Option.some(segments)
            : segment === '..'
              ? Array.isReadonlyArrayNonEmpty(segments)
                ? Option.some(Array.dropRight(segments, 1))
                : Option.none()
              : Option.some(Array.append(segments, segment)),
        ),
    ),
    Array.join('/'),
  )

const folderOf = (path: string): string =>
  Option.getOrElse(Array.head(String.split('/')(path)), () => '')

// NOTE: the feature (or screen) a path under src/features/ (or src/screens/)
// belongs to: its folder there.
const featureOf = (path: string): string =>
  Option.getOrElse(Array.get(String.split('/')(path), 1), () => '')

const withoutExtension = (path: string): string =>
  String.replace(/\.ts$/, '')(path)

// NOTE: a file straight in a feature's folder that its parent may import:
// `features/heroes/block`, not `features/heroes/view`.
const isContractOf = (child: string, target: string): boolean => {
  const segments = String.split('/')(withoutExtension(target))
  return (
    segments.length === 3 &&
    segments[1] === child &&
    Array.contains(CONTRACT_FILES, segments[2] ?? '')
  )
}

const isChildContract = (importer: string, target: string): boolean =>
  Array.some(CHILD_BLOCKS[featureOf(importer)] ?? [], child =>
    isContractOf(child, target),
  )

// NOTE: a type-only import of exactly the root's types ROOT_TYPES lists.
const isRootType = (
  target: string,
  isTypeOnly: boolean,
  names: ReadonlyArray<string>,
): boolean => {
  const allowed = ROOT_TYPES[withoutExtension(target)]
  return (
    isTypeOnly &&
    allowed !== undefined &&
    Array.isReadonlyArrayNonEmpty(names) &&
    Array.every(names, name => Array.contains(allowed, name))
  )
}

// NOTE: the root's Message union is only the join of its groups, each in
// the folder of the feature that sends it (AGENTS.md "Folders"), so code
// below src/app/ builds and types its Messages from its own group.
const ROOT_MESSAGE_PATH = 'app/message'

const ROOT_MESSAGE_IMPORT_MESSAGE =
  'Only src/app/ imports the root\'s Message union (src/app/message.ts). Build and type a Message from its group, in the folder of the feature that sends it (AGENTS.md "Folders").'

const UPWARD_MESSAGE = (folder: string, target: string): string =>
  `src/${folder}/ imports only its own layer and the ones below it (app, then screens, then features, then ui, domain, render, art, audio, input, and platform, then world, then shared), not src/${target}. Move what both need down to the layer they share, or move the code that puts them together up. The one way up is \`import type\` of the root's Model or view builder (AGENTS.md "Folders").`

const SIBLING_MESSAGE = (feature: string, target: string): string =>
  `src/features/${feature}/ never imports another feature (src/${target}): move what both need down, or wire them in src/app/. Only a parent Block imports the contract (${Array.join(CONTRACT_FILES, ', ')}) of a child it binds (AGENTS.md "Folders").`

const SCREEN_MESSAGE = (screen: string, target: string): string =>
  `src/screens/${screen}/ never imports another screen (src/${target}): move what both need down to a feature or a shared layer (AGENTS.md "Folders").`

const FOLDER_IMPORTS_MESSAGE = (
  folder: string,
  allowed: ReadonlyArray<string>,
): string =>
  `src/${folder}/ imports only ${Array.join(
    Array.map(allowed, name => `src/${name}/`),
    ' and ',
  )}${folder === 'world' ? ', since the co-op room loads it,' : ''} and Effect and Foldkit's struct and schema modules (AGENTS.md "Folders").`

// NOTE: the names a declaration imports: none for a bare or namespace
// import, which the root's types never allow.
const importedNamesOf = (
  node: ESTree.ImportDeclaration,
): ReadonlyArray<string> => {
  const named = Array.filter(
    node.specifiers,
    (specifier): specifier is ESTree.ImportSpecifier =>
      specifier.type === 'ImportSpecifier',
  )
  return named.length === node.specifiers.length
    ? Array.map(named, importedName)
    : []
}

const folderImports = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Keep the layers of src one way (app over screens over features over the client layers over world over shared), screens apart, features apart but for a parent and its child Block, src/world/ to what the co-op room may load, tests out of shipped code, and the root Message union in src/app/.',
    },
  },
  create(context) {
    const match = SRC_PATH.exec(String.replaceAll('\\', '/')(context.filename))
    const importer = match?.[1]
    if (importer === undefined || isTestPath(importer)) {
      return {}
    }
    const folder = folderOf(importer)
    const allowed = FOLDERS_ALLOWED[folder]
    const check = (
      node: Node,
      source: ESTree.StringLiteral | ESTree.Expression | null | undefined,
      isTypeOnly: boolean,
      names: ReadonlyArray<string>,
    ): void => {
      if (!isStringLiteral(source)) {
        return
      }
      const spec = source.value
      if (!String.startsWith('.')(spec)) {
        if (
          allowed !== undefined &&
          !ROOM_PACKAGES.test(spec) &&
          !(isTypeOnly && ROOM_TYPE_PACKAGES.test(spec))
        ) {
          context.report({
            node,
            message: FOLDER_IMPORTS_MESSAGE(folder, allowed),
          })
        }
        return
      }
      const maybeTarget = resolveUnderSrc(importer, spec)
      if (Option.isNone(maybeTarget)) {
        return
      }
      const target = maybeTarget.value
      if (isTestPath(target)) {
        context.report({
          node,
          message:
            'Shipped code never imports a test home (src/test/) or a test\'s folder (__tests__/) (AGENTS.md "Folders").',
        })
        return
      }
      if (allowed !== undefined && !Array.contains(allowed, folderOf(target))) {
        context.report({
          node,
          message: FOLDER_IMPORTS_MESSAGE(folder, allowed),
        })
        return
      }
      if (folder !== 'app' && withoutExtension(target) === ROOT_MESSAGE_PATH) {
        context.report({ node, message: ROOT_MESSAGE_IMPORT_MESSAGE })
        return
      }
      const importerRank = LAYER_RANKS[folder]
      const targetRank = LAYER_RANKS[folderOf(target)]
      if (importerRank === undefined || targetRank === undefined) {
        return
      }
      if (targetRank > importerRank && !isRootType(target, isTypeOnly, names)) {
        context.report({ node, message: UPWARD_MESSAGE(folder, target) })
        return
      }
      if (
        folder === 'screens' &&
        folderOf(target) === 'screens' &&
        featureOf(importer) !== featureOf(target)
      ) {
        context.report({
          node,
          message: SCREEN_MESSAGE(featureOf(importer), target),
        })
        return
      }
      if (
        folder === 'features' &&
        folderOf(target) === 'features' &&
        featureOf(importer) !== featureOf(target) &&
        !isChildContract(importer, target)
      ) {
        context.report({
          node,
          message: SIBLING_MESSAGE(featureOf(importer), target),
        })
      }
    }
    return {
      ImportDeclaration(node) {
        check(
          node,
          node.source,
          node.importKind === 'type' ||
            (node.specifiers.length > 0 &&
              Array.every(
                node.specifiers,
                specifier =>
                  specifier.type === 'ImportSpecifier' &&
                  specifier.importKind === 'type',
              )),
          importedNamesOf(node),
        )
      },
      ExportNamedDeclaration(node) {
        check(node, node.source, node.exportKind === 'type', [])
      },
      ExportAllDeclaration(node) {
        check(node, node.source, node.exportKind === 'type', [])
      },
      ImportExpression(node) {
        check(node, node.source, false, [])
      },
    }
  },
})

// NOTE: a comment that silences a rule: oxlint's or the Effect language
// service's.
const SILENCER = /^\s*(oxlint-disable|@effect-diagnostics)/

// NOTE: how far above a silencer its NOTE may sit, so a NOTE over a short
// expression still covers the disable inside it.
const NOTE_REACH_LINES = 6

const disableNeedsReason = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A comment that silences a rule says why: a NOTE just above it, or a reason after `--`.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    return {
      Program() {
        const comments = sourceCode.getAllComments()
        const noteEnds = Array.map(
          Array.filter(comments, comment =>
            String.startsWith('NOTE:')(String.trim(comment.value)),
          ),
          comment => sourceCode.getLoc(comment).end.line,
        )
        Array.forEach(
          Array.filter(
            Array.filter(
              Array.filter(comments, comment => SILENCER.test(comment.value)),
              comment => !/\s--\s*\S/.test(comment.value),
            ),
            comment => {
              const line = sourceCode.getLoc(comment).start.line
              return !Array.some(
                noteEnds,
                end => end <= line && line - end <= NOTE_REACH_LINES,
              )
            },
          ),
          comment =>
            context.report({
              loc: sourceCode.getLoc(comment),
              message:
                'A silenced rule needs its reason: a // NOTE: just above, or `-- why` after the rule (AGENTS.md "Strictness").',
            }),
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
    'no-floating-story': noFloatingStory,
    'no-plain-story': noPlainStory,
    'tap-by-click': tapByClick,
    'seat-action-once': seatActionOnce,
    'key-action-once': keyActionOnce,
    'no-binding-field-write': noBindingFieldWrite,
    'live-test-note': liveTestNote,
    'disable-needs-reason': disableNeedsReason,
    'folder-imports': folderImports,
  },
})
