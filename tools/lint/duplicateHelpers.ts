import { Glob } from 'bun'
import {
  Array,
  Console,
  Effect,
  FileSystem,
  Option,
  type Order,
  Path,
  Record,
  Runtime,
  Schema,
  String,
} from 'effect'
import { parseSync } from 'oxc-parser'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

const TEST_HOMES: ReadonlyArray<string> = [
  'src/test/testing.ts',
  'src/**/*.fixture.ts',
  'tools/**/*.fixture.ts',
  'packages/*/test/fixtures.ts',
  'infra/worker/testing.ts',
]

type Kind = Readonly<{
  name: string
  patterns: ReadonlyArray<string>
  isSkipped: (file: string) => boolean
  advice: string
}>

const isTestSupport = (file: string): boolean =>
  String.endsWith('.test.ts')(file) ||
  String.includes('/test/')(file) ||
  file === 'src/test/testing.ts' ||
  String.endsWith('.fixture.ts')(file) ||
  file === 'src/test/vitest-setup.ts' ||
  file === 'infra/worker/testing.ts'

const KINDS: ReadonlyArray<Kind> = [
  {
    name: 'test helper',
    patterns: [
      'src/**/*.test.ts',
      'tools/**/*.test.ts',
      'packages/*/test/**/*.test.ts',
      'infra/**/*.test.ts',
      ...TEST_HOMES,
    ],
    isSkipped: () => false,
    advice:
      "share each from src/test/testing.ts or src/test/model.fixture.ts (a package's test/fixtures.ts, infra's worker/testing.ts)",
  },
  {
    name: 'helper',
    patterns: [
      'src/**/*.ts',
      'tools/**/*.ts',
      'packages/*/src/**/*.ts',
      'infra/worker/**/*.ts',
    ],
    isSkipped: file => isTestSupport(file) || String.endsWith('.d.ts')(file),
    advice:
      'share each: canvas helpers from src/render/drawing.ts, menu view helpers from src/ui/menuParts.ts, the rest from the module they are about',
  },
]

const ALLOWED: ReadonlyArray<
  Readonly<{ file: string; name: string; reason: string }>
> = [
  {
    file: 'tools/studio/notes.ts',
    name: 'Pin',
    reason:
      "the Vite config loads notes.ts natively, which needs file extensions that src's imports leave out",
  },
  {
    file: 'tools/determinism/bundle.ts',
    name: 'stringSource',
    reason:
      'determinism:diff copies tools/determinism into an older checkout, so it imports only src and effect',
  },
  {
    file: 'tools/determinism/request.ts',
    name: 'ScriptMode',
    reason:
      'the orchestrator loads request.ts without the game, and determinism:diff copies it into an older checkout',
  },
  {
    file: 'src/platform/analytics/analytics.ts',
    name: 'SummaryKind',
    reason:
      'the analytics Worker bundles analytics.ts without the game; analytics.story.test.ts checks it matches ZombieKind',
  },
  {
    file: 'src/platform/analytics/analytics.ts',
    name: 'SummaryMode',
    reason:
      'the analytics Worker bundles analytics.ts without the game; analytics.story.test.ts checks it matches HomeMode',
  },
  {
    file: 'src/platform/analytics/analytics.ts',
    name: 'SummaryDevice',
    reason:
      'the analytics Worker bundles analytics.ts without the game; analytics.story.test.ts checks it matches InputDevice',
  },
  {
    file: 'tools/sprites/manifest.ts',
    name: 'SpriteKeys',
    reason:
      'a list of strings that means sprite keys here and power-up ids in SavedPowerUps: the same shape, not one value',
  },
  {
    file: 'src/shared/records/playerData.ts',
    name: 'RecordUnlock',
    reason:
      'whether RECORD MY RUNS shows; SavedNightmare is a save field with the same two words, not one value',
  },
  {
    file: 'tools/audit/harness/entry.ts',
    name: 'container',
    reason:
      "its own page's #root; the game's lookup is in src/app/entry.ts, which mounts the game as it loads, so no page may import it",
  },
  {
    file: 'tools/studio/entry.ts',
    name: 'root',
    reason:
      "its own page's #root; the game's lookup is in src/app/entry.ts, which mounts the game as it loads, so no page may import it",
  },
]

const groupOf = (file: string): string =>
  String.startsWith('packages/')(file)
    ? Array.join(String.split('/')(file).slice(0, 2), '/')
    : String.startsWith('infra/')(file)
      ? 'infra'
      : 'src'

const allowedSeen = new Set<string>()

const isAllowed = (file: string, name: string): boolean => {
  const isListed = Array.some(
    ALLOWED,
    entry => entry.file === file && entry.name === name,
  )
  if (isListed) {
    allowedSeen.add(`${file}#${name}`)
  }
  return isListed
}

type Node = Readonly<{ type: string; start: number; end: number }> &
  Readonly<Record<string, unknown>>

const isNode = (value: unknown): value is Node =>
  typeof value === 'object' &&
  value !== null &&
  'type' in value &&
  typeof value.type === 'string'

const nodesIn = (value: unknown): ReadonlyArray<Node> =>
  Array.isArray(value) ? Array.filter(value, isNode) : []

const nameOf = (value: unknown): string =>
  isNode(value) && typeof value['name'] === 'string' ? value['name'] : ''

const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Array.flatMap(Record.values(node), value =>
    Array.isArray(value)
      ? Array.filter(value, isNode)
      : isNode(value)
        ? [value]
        : [],
  )

const readsIn = (node: Node): ReadonlyArray<Node> => {
  const reads: Array<Node> = []
  const visit = (current: Node): void => {
    if (current.type === 'Identifier' && typeof current['name'] === 'string') {
      reads.push(current)
    }
    const skipped =
      (current.type === 'MemberExpression' && current['computed'] !== true) ||
      (current.type === 'Property' &&
        current['computed'] !== true &&
        current['shorthand'] !== true)
        ? (current['property'] ?? current['key'])
        : undefined
    Array.forEach(
      Array.filter(childrenOf(current), child => child !== skipped),
      visit,
    )
  }
  visit(node)
  return reads
}

const namesIn = (node: Node): ReadonlySet<string> =>
  new Set(Array.map(readsIn(node), nameOf))

const bodyOf = (text: string, node: Node, name: string): string => {
  const own = Array.filter(readsIn(node), read => nameOf(read) === name)
  return String.replace(
    /,([)\]}>])/g,
    '$1',
  )(
    String.replace(
      /\s+/g,
      '',
    )(
      Array.reduce(
        [...own].sort((a, b) => b.start - a.start),
        String.slice(node.start, node.end)(text),
        (body, read) =>
          `${String.slice(0, read.start - node.start)(body)}\u0000${String.slice(read.end - node.start)(body)}`,
      ),
    ),
  )
}

const isPlain = (node: Node): boolean => {
  switch (node.type) {
    case 'Literal':
    case 'Identifier':
      return true
    case 'TemplateLiteral':
      return (
        Array.isArray(node['expressions']) && node['expressions'].length === 0
      )
    case 'MemberExpression':
      return isNode(node['object']) && isPlain(node['object'])
    case 'UnaryExpression':
      return isNode(node['argument']) && isPlain(node['argument'])
    case 'BinaryExpression':
      return (
        isNode(node['left']) &&
        isPlain(node['left']) &&
        isNode(node['right']) &&
        isPlain(node['right'])
      )
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return isNode(node['expression']) && isPlain(node['expression'])
    default:
      return false
  }
}

const OWN_READS =
  /import\.meta|process\.(argv|env)|performance\.now\(\)|nowMs\(\)/

const isOwnState = (node: Node, body: string): boolean => {
  switch (node.type) {
    case 'AwaitExpression':
      return true
    case 'CallExpression':
      return (
        (Array.isArray(node['arguments']) &&
          node['arguments'].length === 0 &&
          String.startsWith('create')(nameOf(node['callee']))) ||
        OWN_READS.test(body)
      )
    case 'ArrayExpression':
      return Array.isArray(node['elements']) && node['elements'].length === 0
    case 'ObjectExpression':
      return (
        Array.isArray(node['properties']) && node['properties'].length === 0
      )
    case 'NewExpression':
      return Array.isArray(node['arguments']) && node['arguments'].length === 0
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
      return isNode(node['expression']) && isOwnState(node['expression'], body)
    default:
      return OWN_READS.test(body)
  }
}

type Declaration = Readonly<{ node: Node; line: number }>

type Helper = Readonly<{
  file: string
  name: string
  line: number
  key: string
}>

const moduleOf = (path: Path.Path, file: string, source: string): string =>
  String.startsWith('.')(source)
    ? String.replace(
        /\.(ts|js|mjs)$/,
        '',
      )(path.join(path.dirname(file), source))
    : source

const lineOf = (text: string, offset: number): number =>
  String.split('\n')(String.slice(0, offset)(text)).length

const helpersOf = (
  path: Path.Path,
  file: string,
  text: string,
): ReadonlyArray<Helper> => {
  const { program } = parseSync(file, text)
  const values = new Map<string, Declaration>()
  const types = new Map<string, Declaration>()
  const helperNames = new Set<string>()
  const ownState = new Set<string>()
  const imports = new Map<string, string>()
  const record = (
    map: Map<string, Declaration>,
    name: string,
    node: Node,
    at: number,
  ): void => {
    map.set(name, { node, line: lineOf(text, at) })
  }

  for (const raw of nodesIn(program.body)) {
    const statement =
      raw.type === 'ExportNamedDeclaration' && isNode(raw['declaration'])
        ? raw['declaration']
        : raw
    if (statement.type === 'ImportDeclaration') {
      const source = isNode(statement['source'])
        ? statement['source']['value']
        : undefined
      for (const specifier of nodesIn(statement['specifiers'])) {
        const local = nameOf(specifier['local'])
        const imported = isNode(specifier['imported'])
          ? globalThis.String(
              specifier['imported']['name'] ?? specifier['imported']['value'],
            )
          : specifier.type
        imports.set(
          local,
          `${moduleOf(path, file, globalThis.String(source))}#${imported}`,
        )
      }
    }
    if (
      (statement.type === 'TSTypeAliasDeclaration' ||
        statement.type === 'TSInterfaceDeclaration') &&
      isNode(statement['id'])
    ) {
      record(types, nameOf(statement['id']), statement, statement.start)
    }
    if (statement.type === 'FunctionDeclaration' && isNode(statement['id'])) {
      const name = nameOf(statement['id'])
      record(values, name, statement, statement.start)
      helperNames.add(name)
    }
    if (statement.type === 'VariableDeclaration') {
      const isReassigned = statement['kind'] !== 'const'
      for (const declarator of nodesIn(statement['declarations'])) {
        const id = declarator['id']
        const init = declarator['init']
        if (isNode(id) && id.type === 'Identifier' && isNode(init)) {
          const name = nameOf(id)
          record(values, name, init, declarator.start)
          if (
            isReassigned ||
            isOwnState(init, String.slice(init.start, init.end)(text))
          ) {
            ownState.add(name)
          } else if (!isPlain(init)) {
            helperNames.add(name)
          }
        }
      }
    }
  }

  const keys = new Map<Declaration, string>()
  const isDeclared = (name: string): boolean =>
    values.has(name) || types.has(name)
  const keyOf = (
    declaration: Declaration,
    name: string,
    seen: ReadonlySet<string>,
  ): string => {
    const known = keys.get(declaration)
    if (known !== undefined) {
      return known
    }
    const inner = new Set([...seen, name])
    const body = bodyOf(text, declaration.node, name)
    const meanings = Array.map(
      Array.filter(
        Array.filter([...namesIn(declaration.node)], other => other !== name),
        other => isDeclared(other) || imports.has(other),
      ).sort(),
      other => `${other}=${meaningOf(other, inner)}`,
    )
    const key = Array.join([body, ...meanings], '\n')
    keys.set(declaration, key)
    return key
  }
  const meaningOf = (name: string, seen: ReadonlySet<string>): string => {
    if (!isDeclared(name)) {
      return imports.get(name) ?? ''
    }
    if (seen.has(name)) {
      return `cycle:${name}`
    }
    if (ownState.has(name)) {
      return `own:${file}#${name}`
    }
    return Array.join(
      Array.flatMap([values.get(name), types.get(name)], declaration =>
        declaration === undefined ? [] : [keyOf(declaration, name, seen)],
      ),
      '\n&\n',
    )
  }

  return Array.flatMap([...helperNames], name => {
    const declaration = values.get(name)
    return declaration === undefined
      ? []
      : [
          {
            file,
            name,
            line: declaration.line,
            key: keyOf(declaration, name, new Set()),
          },
        ]
  })
}

const filesMatching = (root: string, pattern: string): ReadonlyArray<string> =>
  Array.filter(
    Array.fromIterable(new Glob(pattern).scanSync({ cwd: root })),
    file => !String.includes('node_modules')(file),
  )

const firstNameOf = (list: ReadonlyArray<Helper>): string => list[0]?.name ?? ''

const byFirstName: Order.Order<ReadonlyArray<Helper>> = (a, b) =>
  String.localeCompare(firstNameOf(b))(firstNameOf(a))

const copiesOf = (root: string, kind: Kind) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const copies = new Map<string, Array<Helper>>()
    for (const pattern of kind.patterns) {
      for (const file of filesMatching(root, pattern)) {
        if (kind.isSkipped(file)) {
          continue
        }
        const text = yield* fs.readFileString(`${root}${file}`)
        for (const helper of helpersOf(path, file, text)) {
          if (isAllowed(file, helper.name)) {
            continue
          }
          const at = `${groupOf(file)}\n${helper.key}`
          const list = copies.get(at) ?? []
          if (!Array.some(list, other => other.file === file)) {
            copies.set(at, [...list, helper])
          }
        }
      }
    }

    const repeated = Array.sort(
      Array.filter([...copies.values()], list => list.length > 1),
      byFirstName,
    )

    for (const list of repeated) {
      const [first, ...rest] = list
      const copied = Array.map(rest, ({ file, line, name }) =>
        name === first?.name
          ? `${file}:${line}`
          : `${file}:${line} as \`${name}\``,
      )
      yield* Console.error(
        `${first?.file}:${first?.line}: \`${first?.name}\` is copied in ${Array.join(copied, ', ')}`,
      )
    }
    if (repeated.length > 0) {
      yield* Console.error(
        `${repeated.length} ${kind.name}(s) copied between files: ${kind.advice}.`,
      )
    }
    return repeated.length
  })

const exportedNames = (file: string, text: string): ReadonlyArray<string> =>
  Array.filter(
    Array.flatMap(
      Array.filter(
        nodesIn(parseSync(file, text).program.body),
        statement => statement.type === 'ExportNamedDeclaration',
      ),
      (statement: Node) => {
        const declaration = statement['declaration']
        if (!isNode(declaration)) {
          return []
        }
        return declaration.type === 'VariableDeclaration'
          ? Array.map(nodesIn(declaration['declarations']), declarator =>
              nameOf(declarator['id']),
            )
          : [nameOf(declaration['id'])]
      },
    ),
    name => name !== '',
  )

const sharedNameClashes = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const homes = new Map<string, Array<string>>()
    for (const pattern of TEST_HOMES) {
      for (const file of filesMatching(root, pattern)) {
        const text = yield* fs.readFileString(`${root}${file}`)
        for (const name of exportedNames(file, text)) {
          const at = `${groupOf(file)}\n${name}`
          const files = homes.get(at) ?? []
          if (!Array.contains(files, file)) {
            homes.set(at, [...files, file])
          }
        }
      }
    }
    const clashes = Array.filter(
      [...homes.entries()],
      ([, files]) => files.length > 1,
    )
    for (const [at, files] of clashes) {
      const name = Option.getOrElse(
        Array.get(String.split('\n')(at), 1),
        () => '',
      )
      yield* Console.error(
        `\`${name}\` is exported by more than one shared test home: ${Array.join(files, ', ')}. Keep one, or give the other a name that says which.`,
      )
    }
    return clashes.length
  })

class CopiesFound extends Schema.TaggedError<
  CopiesFound,
  { readonly brand: unique symbol }
>()('CopiesFound', {
  count: Schema.Finite,
}) {
  override get [Runtime.errorExitCode](): number {
    return 1
  }
  override readonly [Runtime.errorReported] = false
}

const program = Effect.gen(function* () {
  const path = yield* Path.Path
  const root = path.join(
    Option.getOrElse(Array.get(process.argv, 2), () =>
      path.resolve(import.meta.dirname, '../..'),
    ),
    '/',
  )
  let total = yield* sharedNameClashes(root)
  for (const kind of KINDS) {
    total += yield* copiesOf(root, kind)
  }
  for (const { file, name } of ALLOWED) {
    if (!allowedSeen.has(`${file}#${name}`)) {
      yield* Console.error(
        `tools/lint/duplicateHelpers.ts: \`${name}\` in ${file} is no longer declared there: drop it from ALLOWED.`,
      )
      total += 1
    }
  }
  if (total > 0) {
    return yield* CopiesFound.make({ count: total })
  }
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
