// NOTE: AGENTS.md "Code shape": helpers are shared, not copied. Fails when
// two files of one kind declare the same top-level helper: the same name and
// the same body, laid out any way, where every top-level name the body reads
// (a constant or type of its own file, or an import) also means the same
// thing. So two `ticksFor`s that divide by a FRAME_MS of 16 and of 50 are
// different helpers, and two that divide by the same one are a copy.
//
// A helper here is a function, or a constant built from something: an object,
// an array, or a call (a Model, a spawn, a locator, a vector). Plain numbers,
// strings, and arithmetic on names (`FRAME_MS = 50`, `CENTER_X =
// PARLOUR.width / 2`) are a file's own tuning and may repeat.
//
// Two kinds of file are checked apart:
//
// - Test files, against each other and the shared test homes
//   (`src/testing.ts`, `src/model.fixture.ts` and the other `*.fixture.ts`
//   files, a package's `test/fixtures.ts`, infra's `worker/testing.ts`), so a
//   copy of what is already shared fails as well.
// - Game modules, the rest of `src`, each package's `src`, and infra's
//   Worker: a canvas helper belongs in `src/drawing.ts`, a menu helper in
//   `src/menuParts.ts`, and anything else in the module it is about.
//
// Files are compared within one code base: `src` and `tools` together, each
// package under `packages/`, and `infra`.
//
//   bun tools/lint/duplicateHelpers.ts [root]

import { Glob } from 'bun'
import { dirname, join } from 'node:path'
import { parseSync } from 'oxc-parser'

// NOTE: the repository, or another checkout of it given as the argument.
const ROOT = join(
  process.argv[2] ?? new URL('../..', import.meta.url).pathname,
  '/',
)

// NOTE: test support that is no test file but is shared like one.
const TEST_HOMES: ReadonlyArray<string> = [
  'src/testing.ts',
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
  file.endsWith('.test.ts') ||
  file.includes('/test/') ||
  file === 'src/testing.ts' ||
  file.endsWith('.fixture.ts') ||
  file === 'src/vitest-setup.ts' ||
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
      "share each from src/testing.ts or src/model.fixture.ts (a package's test/fixtures.ts, infra's worker/testing.ts)",
  },
  {
    name: 'helper',
    patterns: [
      'src/**/*.ts',
      'tools/**/*.ts',
      'packages/*/src/**/*.ts',
      'infra/worker/**/*.ts',
    ],
    isSkipped: file => isTestSupport(file) || file.endsWith('.d.ts'),
    advice:
      'share each: canvas helpers from src/drawing.ts, menu view helpers from src/menuParts.ts, the rest from the module they are about',
  },
]

// NOTE: copies left on purpose, each with its reason. Keep this list short.
const ALLOWED: ReadonlyArray<
  Readonly<{ file: string; name: string; reason: string }>
> = [
  {
    file: 'tools/determinism/build.ts',
    name: 'stringSource',
    reason:
      'determinism:diff copies tools/determinism into an older checkout, so it imports only src and effect',
  },
]

const groupOf = (file: string): string =>
  file.startsWith('packages/')
    ? file.split('/').slice(0, 2).join('/')
    : file.startsWith('infra/')
      ? 'infra'
      : 'src'

const allowedSeen = new Set<string>()

const isAllowed = (file: string, name: string): boolean => {
  const isListed = ALLOWED.some(
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

// NOTE: the nodes in a field that holds a list of them, or none.
const nodesIn = (value: unknown): ReadonlyArray<Node> =>
  Array.isArray(value) ? value.filter(isNode) : []

// NOTE: the name of an identifier node, or '' for anything else.
const nameOf = (value: unknown): string =>
  isNode(value) && typeof value['name'] === 'string' ? value['name'] : ''

const childrenOf = (node: Node): ReadonlyArray<Node> =>
  Object.values(node).flatMap(value =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  )

const namesIn = (node: Node): ReadonlySet<string> => {
  const names = new Set<string>()
  const visit = (current: Node): void => {
    if (current.type === 'Identifier' && typeof current['name'] === 'string') {
      names.add(current['name'])
    }
    // NOTE: `x.name` and `{ name: x }` do not read a binding called `name`.
    const skipped =
      (current.type === 'MemberExpression' && current['computed'] !== true) ||
      (current.type === 'Property' &&
        current['computed'] !== true &&
        current['shorthand'] !== true)
        ? (current['property'] ?? current['key'])
        : undefined
    childrenOf(current)
      .filter(child => child !== skipped)
      .forEach(visit)
  }
  visit(node)
  return names
}

// NOTE: a value with no structure of its own: a literal, a name, a member of
// a name, or arithmetic on those.
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

// NOTE: a value that is its own file's, never a copy: what a script awaits
// (its browser, its page), an empty list, object, or `new` to fill as it
// runs, or anything read from `import.meta` (its own path), its arguments,
// its environment, or its clock. A helper built on one is the file's own too.
const isOwnState = (node: Node, body: string): boolean => {
  switch (node.type) {
    case 'AwaitExpression':
      return true
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
      return /import\.meta|process\.(argv|env)|performance\.now\(\)/.test(body)
  }
}

type Declaration = Readonly<{ node: Node; line: number }>

type Helper = Readonly<{
  file: string
  name: string
  line: number
  key: string
}>

// NOTE: a relative import as a path from the root, so `./zombies` in src and
// `../../src/zombies` in tools name the same module.
const moduleOf = (file: string, source: string): string =>
  source.startsWith('.')
    ? join(dirname(file), source).replace(/\.(ts|js|mjs)$/, '')
    : source

const lineOf = (text: string, offset: number): number =>
  text.slice(0, offset).split('\n').length

const helpersOf = (file: string, text: string): ReadonlyArray<Helper> => {
  const { program } = parseSync(file, text)
  // NOTE: a name may be both a value and a type (`const Message` and
  // `type Message`). A helper is its value; a name it reads means both.
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
          ? String(
              specifier['imported']['name'] ?? specifier['imported']['value'],
            )
          : specifier.type
        imports.set(local, `${moduleOf(file, String(source))}#${imported}`)
      }
    }
    // NOTE: a type a helper names is part of what it means, but no helper.
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
      for (const declarator of nodesIn(statement['declarations'])) {
        const id = declarator['id']
        const init = declarator['init']
        if (isNode(id) && id.type === 'Identifier' && isNode(init)) {
          const name = nameOf(id)
          record(values, name, init, declarator.start)
          if (isOwnState(init, text.slice(init.start, init.end))) {
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
    const body = text
      .slice(declaration.node.start, declaration.node.end)
      .replace(/\s+/g, '')
      .replace(/,([)\]}>])/g, '$1')
    const meanings = [...namesIn(declaration.node)]
      .filter(other => other !== name)
      .filter(other => isDeclared(other) || imports.has(other))
      .sort()
      .map(other => `${other}=${meaningOf(other, inner)}`)
    const key = [body, ...meanings].join('\n')
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
    return [values.get(name), types.get(name)]
      .flatMap(declaration =>
        declaration === undefined ? [] : [keyOf(declaration, name, seen)],
      )
      .join('\n&\n')
  }

  return [...helperNames].flatMap(name => {
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

const copiesOf = async (kind: Kind): Promise<number> => {
  const copies = new Map<string, Array<Helper>>()
  for (const pattern of kind.patterns) {
    for await (const file of new Glob(pattern).scan({ cwd: ROOT })) {
      if (file.includes('node_modules') || kind.isSkipped(file)) {
        continue
      }
      const text = await Bun.file(`${ROOT}${file}`).text()
      for (const helper of helpersOf(file, text)) {
        if (isAllowed(file, helper.name)) {
          continue
        }
        const at = `${groupOf(file)}\n${helper.name}\n${helper.key}`
        const list = copies.get(at) ?? []
        // NOTE: a file two patterns both match is read once.
        if (!list.some(other => other.file === file)) {
          copies.set(at, [...list, helper])
        }
      }
    }
  }

  const repeated = [...copies.values()]
    .filter(list => list.length > 1)
    .sort((a, b) => (a[0]?.name ?? '').localeCompare(b[0]?.name ?? ''))

  for (const list of repeated) {
    const [first, ...rest] = list
    console.error(
      `${first?.file}:${first?.line}: \`${first?.name}\` is copied in ${rest.map(({ file, line }) => `${file}:${line}`).join(', ')}`,
    )
  }
  if (repeated.length > 0) {
    console.error(
      `${repeated.length} ${kind.name}(s) copied between files: ${kind.advice}.`,
    )
  }
  return repeated.length
}

let total = 0
for (const kind of KINDS) {
  total += await copiesOf(kind)
}
// NOTE: an allowed copy that is gone is dropped from ALLOWED, so the list
// never hides a new copy under an old name.
for (const { file, name } of ALLOWED) {
  if (!allowedSeen.has(`${file}#${name}`)) {
    console.error(
      `tools/lint/duplicateHelpers.ts: \`${name}\` in ${file} is no longer declared there: drop it from ALLOWED.`,
    )
    total += 1
  }
}
if (total > 0) {
  process.exit(1)
}
