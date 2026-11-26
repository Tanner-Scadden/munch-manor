import { Array, Console, Effect } from 'effect'

import { SITE_INPUTS } from './siteInputs'

const patterns = Array.map(
  [...SITE_INPUTS, 'bun.lock'],
  pattern => new Bun.Glob(pattern),
)

const program = Effect.gen(function* () {
  const changed = Array.filter(Array.drop(process.argv, 2), file =>
    Array.some(patterns, glob => glob.match(file)),
  )
  if (Array.isReadonlyArrayNonEmpty(changed)) {
    yield* Console.log(
      `The site's inputs changed:\n  ${Array.join(changed, '\n  ')}`,
    )
    return false
  }
  yield* Console.log("No input of the site's build changed.")
  return true
})

process.exitCode = Effect.runSync(program) ? 0 : 1
