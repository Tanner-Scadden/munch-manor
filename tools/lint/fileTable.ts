// NOTE: AGENTS.md "Where things are" is the map of `src`, so it must stay
// true. Fails when a module or stylesheet in `src` is not named in the first
// column of the file table, or when the table names a file that does not
// exist. Test files (`*.test.ts`) are left out: each sits beside what it
// tests.
//
//   bun tools/lint/fileTable.ts [root]

import { Glob } from 'bun'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// NOTE: the repository, or another checkout of it given as the argument.
const ROOT = process.argv[2] ?? new URL('../..', import.meta.url).pathname

const TABLE_START = '### Where things are'
const TABLE_END = '### Elsewhere'

const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
const start = agents.indexOf(TABLE_START)
const end = agents.indexOf(TABLE_END)
if (start < 0 || end < start) {
  console.error(
    `tools/lint/fileTable.ts: AGENTS.md has no "${TABLE_START}" section before "${TABLE_END}".`,
  )
  process.exit(1)
}

// NOTE: the files a row names: every backticked path in its first cell.
const named = new Set(
  agents
    .slice(start, end)
    .split('\n')
    .filter(line => line.startsWith('| `'))
    .flatMap(line =>
      Array.from(
        (line.split('|')[1] ?? '').matchAll(/`([^`]+)`/g),
        ([, path]) => path ?? '',
      ),
    ),
)

const isMapped = (file: string): boolean =>
  !file.endsWith('.test.ts') && !file.endsWith('.d.ts')

const files = new Set(
  Array.from(
    new Glob('**/*.{ts,css}').scanSync({ cwd: join(ROOT, 'src') }),
  ).filter(isMapped),
)

const missing = [...files].filter(file => !named.has(file)).sort()
const stale = [...named].filter(file => !files.has(file)).sort()

for (const file of missing) {
  console.error(
    `src/${file}: not in AGENTS.md's file table. Add it to a row, with what it holds.`,
  )
}
for (const file of stale) {
  console.error(
    `AGENTS.md: the file table names ${file}, which is not in src. Drop or rename it.`,
  )
}
if (missing.length + stale.length > 0) {
  process.exit(1)
}
