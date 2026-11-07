import { Array, Effect, FileSystem, String } from 'effect'
import type { Plugin } from 'vite'

import { foldkit } from '@foldkit/vite-plugin'

import { nodeRuntime } from '../node.ts'

// The Foldkit Vite plugin, branding view modules only. Its view identity
// transform wraps every function return in every application module in
// `brandViewResult`, which stamps a returned vnode (or each vnode of a
// returned array) with the function that made it. That includes the
// simulation, the pathing, and the canvas shape builders, which never
// return a vnode, and for each array they return it looks at every element:
// about 12 ms of a 2 s worst-case profile at 4x CPU throttle.
//
// A module can only make a vnode through Foldkit's HTML builder, a
// `@foldkit/ui` component, `Canvas.view`, or a Submodel's `defineView`, so a
// module whose source names none of them is left as written. The plugin
// sees the code after TypeScript is stripped, which drops a type-only
// import such as `import type { HtmlBuilder } from 'foldkit/html'`, so the
// markers are read from the file on disk.

const VIEW_IDENTITY_PLUGIN = 'foldkit:view-identity'

const VIEW_MODULE_MARKERS: ReadonlyArray<RegExp> = [
  /from ['"](?:foldkit\/html|@foldkit\/ui)(?:['"/])/,
  /\bCanvas\.view\(/,
  /\bdefineView\b/,
]

export const isViewSource = (source: string): boolean =>
  Array.some(VIEW_MODULE_MARKERS, marker => marker.test(source))

const sourceOf = (
  id: string,
  code: string,
): Effect.Effect<string, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = Array.headNonEmpty(String.split('?')(id))
    return yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => code))
  })

const brandingViewModulesOnly = (plugin: Plugin): Plugin => {
  const { transform } = plugin
  if (typeof transform !== 'function') {
    throw new Error(
      `${VIEW_IDENTITY_PLUGIN} no longer has a plain transform: check tools/vite/viewIdentity.ts against @foldkit/vite-plugin`,
    )
  }
  return {
    ...plugin,
    transform(code, id, options) {
      return nodeRuntime
        .runPromise(sourceOf(id, code))
        .then(source =>
          isViewSource(source) ? transform.call(this, code, id, options) : null,
        )
    },
  }
}

export const foldkitBrandingViews = (
  ...options: Parameters<typeof foldkit>
): Array<Plugin> => {
  const plugins = foldkit(...options)
  if (!Array.some(plugins, plugin => plugin.name === VIEW_IDENTITY_PLUGIN)) {
    throw new Error(
      `@foldkit/vite-plugin has no ${VIEW_IDENTITY_PLUGIN} plugin: check tools/vite/viewIdentity.ts`,
    )
  }
  return Array.map(plugins, plugin =>
    plugin.name === VIEW_IDENTITY_PLUGIN
      ? brandingViewModulesOnly(plugin)
      : plugin,
  )
}
