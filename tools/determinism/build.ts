// Bundles the harness for the engines Bun cannot run directly, into
// tools/determinism/out (gitignored):
// - out/cli.js for Node,
// - out/page.html, a page with the harness inlined as a classic script, for
//   headless Chrome from a file URL (a module script would not load there),
// - out/worker.js for workerd.
// bundle.ts makes the game's Vite-only imports plain.
//   bun tools/determinism/build.ts

import { Console, Effect, FileSystem, Path, String } from 'effect'

import * as NodeRuntime from '@effect/platform-node/NodeRuntime'
import * as NodeServices from '@effect/platform-node/NodeServices'

import { bundle } from './bundle'

const here = import.meta.dirname

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const outdir = path.resolve(here, 'out')
  yield* fs.makeDirectory(outdir, { recursive: true })
  yield* bundle({
    outdir,
    entry: path.resolve(here, 'cli.ts'),
    target: 'node',
    format: 'esm',
  })
  yield* bundle({
    outdir,
    entry: path.resolve(here, 'worker.ts'),
    target: 'browser',
    format: 'esm',
  })
  const pagePath = yield* bundle({
    outdir,
    entry: path.resolve(here, 'page.ts'),
    target: 'browser',
    format: 'iife',
  })
  const pageScript = yield* fs.readFileString(pagePath)
  yield* fs.writeFileString(
    path.resolve(outdir, 'page.html'),
    `<!doctype html><html><head><meta charset="utf-8"><title>determinism</title></head><body><script>${String.replaceAll('</script', '<\\/script')(pageScript)}</script></body></html>`,
  )
  yield* Console.error(`Built the harness into ${outdir}`)
})

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)))
