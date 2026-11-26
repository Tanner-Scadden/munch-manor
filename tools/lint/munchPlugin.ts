import { Array, Option, String } from 'effect'

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
  isWorldNamed,
  propertyName,
} from './ast.ts'
import {
  noAppendInReduce,
  noDeepEqualPerFrame,
  noNestedScan,
  noStringKeyPerFrame,
  stepWorldAlone,
} from './perfRules.ts'
import { noFloatingStory, noPlainStory, noRunInTests } from './testRules.ts'

type Node = ESTree.Node

const isTagMember = (
  node: Node | null | undefined,
): node is ESTree.StaticMemberExpression =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  node.property.type === 'Identifier' &&
  node.property.name === '_tag'

const isTagName = (node: Node): node is ESTree.IdentifierReference =>
  node.type === 'Identifier' && /^tag$|Tag$/.test(node.name)

const unwrapChain = (node: ESTree.Expression): Node =>
  node.type === 'ChainExpression' ? node.expression : node

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

const UNSTABLE_MATH: ReadonlySet<string> = new Set([
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atan2',
  'atanh',
  'cbrt',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'hypot',
  'log',
  'log10',
  'log1p',
  'log2',
  'pow',
  'sin',
  'sinh',
  'tan',
  'tanh',
])

const isMathObject = (node: ESTree.Expression): boolean =>
  (node.type === 'Identifier' && node.name === 'Math') ||
  (node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === 'globalThis' &&
    node.property.type === 'Identifier' &&
    node.property.name === 'Math')

const isLiteralTwo = (node: ESTree.Node): boolean =>
  node.type === 'Literal' && node.value === 2

const stableMath = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Use src/shared/detMath.ts, not Math functions or `**` whose last bit differs between engines, where the World and the intent it reads are stepped.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          isMathObject(node.object) &&
          hasName(UNSTABLE_MATH, propertyName(node))
        ) {
          context.report({
            node,
            message: `Math.${propertyName(node) ?? ''} rounds its last bit differently in JavaScriptCore and V8, so the step plays differently on each engine: use DetMath from src/shared/detMath.ts (AGENTS.md "Keep the game deterministic").`,
          })
        }
      },
      BinaryExpression(node) {
        if (node.operator === '**' && !isLiteralTwo(node.left)) {
          context.report({
            node,
            message:
              '`**` is the engine\'s own pow, which rounds its last bit differently in JavaScriptCore and V8: multiply, or raise the literal 2 (AGENTS.md "Keep the game deterministic").',
          })
        }
      },
      AssignmentExpression(node) {
        if (node.operator === '**=') {
          context.report({
            node,
            message:
              '`**=` is the engine\'s own pow, which rounds its last bit differently in JavaScriptCore and V8: multiply instead (AGENTS.md "Keep the game deterministic").',
          })
        }
      },
    }
  },
})

const bareModelName = (node: ESTree.Expression): string | undefined => {
  if (
    node.type === 'MemberExpression' &&
    !node.computed &&
    node.object.type === 'Identifier' &&
    node.object.name === '$' &&
    propertyName(node) === 'model'
  ) {
    return node.object.name
  }
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'unchanged' &&
    node.arguments.length === 1 &&
    node.arguments[0]?.type === 'Identifier' &&
    node.arguments[0].name === '$'
  ) {
    return node.arguments[0].name
  }
  return undefined
}

const isStepCallOn = (
  node: ESTree.Expression,
  name: string | undefined,
): boolean =>
  name !== undefined &&
  node.type === 'CallExpression' &&
  (Array.some(
    node.arguments,
    argument => argument.type === 'Identifier' && argument.name === name,
  ) ||
    (node.callee.type === 'MemberExpression' &&
      node.callee.object.type === 'Identifier' &&
      node.callee.object.name === name &&
      propertyName(node.callee) === 'combine') ||
    isStepCallOn(node.callee, name))

const noConditionalStep = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Run a Step on a condition with stepWhen, not a ternary whose other branch is $.model.',
    },
  },
  create(context) {
    return {
      ConditionalExpression(node) {
        if (
          isStepCallOn(node.consequent, bareModelName(node.alternate)) ||
          isStepCallOn(node.alternate, bareModelName(node.consequent))
        ) {
          context.report({
            node,
            message:
              'A Step run on a condition: use stepWhen(isDue, step) from src/shared/stepWhen.ts, or match the union when the condition narrows it; between two Steps, pick the Step itself (`cond ? step : unchanged`) (AGENTS.md "Code shape").',
          })
        }
      },
    }
  },
})

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

const DIALOG_FIELDS: ReadonlySet<string> = new Set(['rootDialog'])

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
      MemberExpression(node) {
        const name = memberName(node)
        const owner = memberName(node.object)
        if (
          hasName(DIALOG_FIELDS, name) ||
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

const isCallOf = (
  node: Node | null,
  name: string,
): node is ESTree.CallExpression =>
  node?.type === 'CallExpression' &&
  ((node.callee.type === 'Identifier' && node.callee.name === name) ||
    memberName(node.callee) === name)

const isCommandMake = (node: Node | null): boolean =>
  node?.type === 'CallExpression' &&
  node.callee.type === 'MemberExpression' &&
  node.callee.object.type === 'Identifier' &&
  node.callee.object.name === 'Command' &&
  propertyName(node.callee) === 'make'

const isCommandService = (node: Node | null): boolean =>
  node !== null &&
  (node.type === 'CallExpression'
    ? isCommandService(node.callee)
    : node.type === 'MemberExpression'
      ? node.object.type === 'Identifier' &&
        node.object.name === 'Command' &&
        propertyName(node) === 'Service'
      : false)

const commandBesideUpdate = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Define a Command in the module whose update issues it, not in a module of Commands.',
    },
  },
  create(context) {
    const commands: Array<ESTree.BindingIdentifier> = []
    const issued = new Set<string>()
    return {
      VariableDeclarator(node) {
        if (node.id.type === 'Identifier' && isCommandMake(node.init)) {
          commands.push(node.id)
        }
      },
      ClassDeclaration(node) {
        if (node.id !== null && isCommandService(node.superClass)) {
          commands.push(node.id)
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          propertyName(node.callee) === 'make'
        ) {
          issued.add(node.callee.object.name)
        }
      },
      'Program:exit'() {
        Array.forEach(
          Array.filter(commands, command => !issued.has(command.name)),
          command =>
            context.report({
              node: command,
              message: `${command.name} is never issued here (${command.name}.make(...)): define a Command beside the update that runs it, and a Command.Service's .layer joins CommandsLayer in src/app/layer.ts (AGENTS.md "Code shape").`,
            }),
        )
      },
    }
  },
})

const RELEASE_EVENTS: ReadonlySet<string> = new Set([
  'touchstart',
  'touchend',
  'touchcancel',
  'pointerup',
  'mousedown',
  'mouseup',
])

const TAP_BY_CLICK_MESSAGE =
  "Act on .on('click', ...): src/input/touchTaps.ts turns every touch tap into a click, so the press works with another finger down and acts once. 'pointerdown' is the one press event for acting as a finger lands."

const tapByClick = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        "Act on an element's click (made from each finger by src/input/touchTaps.ts), never on a touch or mouse release or a touch start.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const event = node.arguments[0]
        if (
          node.callee.type === 'MemberExpression' &&
          propertyName(node.callee) === 'on' &&
          isStringLiteral(event) &&
          RELEASE_EVENTS.has(event.value)
        ) {
          context.report({ node, message: TAP_BY_CLICK_MESSAGE })
        }
      },
    }
  },
})

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

const SEAT_WRITERS: ReadonlyArray<string> = [
  'evolve',
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

const STANDING_BASIS = new Set(['CAMERA_UP', 'TOWARD_CAMERA'])

const standThroughSpace = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Stand anything in the 3D world through standingPointOf, never a height tuned along the camera.',
    },
  },
  create(context) {
    return {
      ImportSpecifier(node) {
        if (STANDING_BASIS.has(importedName(node))) {
          context.report({
            node,
            message:
              'Stand it through standingPointOf in src/render/iso/space.ts, given the game pixel its sprite draws, not a height tuned along the camera (AGENTS.md "Rules").',
          })
        }
      },
    }
  },
})

const DIALOG_WRITERS: ReadonlyArray<string> = ['evolve', 'set']

const noDialogFieldWrite = defineRule({
  meta: {
    type: 'problem',
    docs: {
      description:
        'Open and close a root dialog through openRootDialog and closeRootDialog, never by writing the rootDialog field.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!Array.some(DIALOG_WRITERS, writer => isCallOf(node, writer))) {
          return
        }
        Array.forEach(
          Array.filter(
            Array.flatMap(node.arguments, argument =>
              argument.type === 'ObjectExpression' ? argument.properties : [],
            ),
            property => hasName(DIALOG_FIELDS, keyName(property)),
          ),
          property =>
            context.report({
              node: property,
              message:
                'A root dialog opens and closes through openRootDialog(name) and closeRootDialog(name) in src/app/update/dialog.ts, never by writing its field (AGENTS.md "Components and dialogs").',
            }),
        )
      },
    }
  },
})

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

const ROOM_PACKAGES = /^(effect(\/.*)?|@effect\/ui)$/

const ROOM_TYPE_PACKAGES = /^@munch\/netcode$/

const ROOT_TYPES: Readonly<Record<string, ReadonlyArray<string>>> = {
  'app/model': ['Model'],
  'app/definition': [
    'ApplicationViewBuilder',
    'ApplicationHtml',
    'ApplicationMount',
  ],
}

const CHILD_BLOCKS: Readonly<Record<string, ReadonlyArray<string>>> = {
  lobby: ['heroes'],
  coop: ['heroes'],
  munchopedia: ['guide'],
}

const CONTRACT_FILES: ReadonlyArray<string> = ['block', 'model', 'message']

const isTestPath = (path: string): boolean =>
  String.startsWith('test/')(path) || String.includes('__tests__/')(path)

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

const featureOf = (path: string): string =>
  Option.getOrElse(Array.get(String.split('/')(path), 1), () => '')

const withoutExtension = (path: string): string =>
  String.replace(/\.ts$/, '')(path)

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

const ROOT_MESSAGE_PATH = 'app/message'

const ROOT_MESSAGE_IMPORT_MESSAGE =
  'Only src/app/ imports the root\'s Message union (src/app/message.ts). Build and type a Message from its group, in the folder of the feature that sends it (AGENTS.md "Folders").'

const UPWARD_MESSAGE = (folder: string, target: string): string =>
  `src/${folder}/ imports only its own layer and the ones below it (app, then screens, then features, then ui, domain, render, art, audio, input, and platform, then world, then shared), not src/${target}. Move what both need down to the layer they share, or move the code that puts them together up. The one way up is \`import type\` of the root's Model or view aliases (AGENTS.md "Folders").`

const SIBLING_MESSAGE = (feature: string, target: string): string =>
  `src/features/${feature}/ never imports another feature (src/${target}): move what both need down, or wire them in src/app/. Only a parent component imports the contract (${Array.join(CONTRACT_FILES, ', ')}) of a child it draws (AGENTS.md "Folders").`

const SCREEN_MESSAGE = (screen: string, target: string): string =>
  `src/screens/${screen}/ never imports another screen (src/${target}): move what both need down to a feature or a shared layer (AGENTS.md "Folders").`

const FOLDER_IMPORTS_MESSAGE = (
  folder: string,
  allowed: ReadonlyArray<string>,
): string =>
  `src/${folder}/ imports only ${Array.join(
    Array.map(allowed, name => `src/${name}/`),
    ' and ',
  )}${folder === 'world' ? ', since the co-op room loads it,' : ''} and Effect and Effect UI's root module (AGENTS.md "Folders").`

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
        'Keep the layers of src one way (app over screens over features over the client layers over world over shared), screens apart, features apart but for a parent and its child component, src/world/ to what the co-op room may load, tests out of shipped code, and the root Message union in src/app/.',
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

const noComments = defineRule({
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'No comments: code says what it does through its names and types, and a rule is never silenced in place.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode
    return {
      Program() {
        const comments = Array.filter(
          sourceCode.getAllComments(),
          comment => comment.type !== 'Shebang',
        )
        Array.forEach(comments, comment =>
          context.report({
            loc: sourceCode.getLoc(comment),
            message:
              'Comments are not allowed: name the code so it reads on its own, and fix what a rule flags instead of silencing it (AGENTS.md "Strictness").',
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
    'stand-through-space': standThroughSpace,
    'no-dialog-field-write': noDialogFieldWrite,
    'no-comments': noComments,
    'folder-imports': folderImports,
    'no-append-in-reduce': noAppendInReduce,
    'no-deep-equal-per-frame': noDeepEqualPerFrame,
    'no-string-key-per-frame': noStringKeyPerFrame,
    'no-nested-scan': noNestedScan,
    'step-world-alone': stepWorldAlone,
    'stable-math': stableMath,
  },
})
