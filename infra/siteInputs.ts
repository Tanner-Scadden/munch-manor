// NOTE: every input of the game's build, relative to the repo's root. The
// site is rebuilt only when one of them changes (alchemy.run.ts's memo, with
// bun.lock as its lockfile), and the deploy's check reads them too
// (sameSite.ts). src/features/whatsNew/changelog.ts reads CHANGELOG.md at build time,
// patches/ holds the Foldkit patch that `bun install` applies, and
// tools/sprites/ builds the sprite atlas.
export const SITE_INPUTS: ReadonlyArray<string> = [
  'src/**',
  'packages/*/src/**',
  'packages/*/package.json',
  'public/**',
  'patches/**',
  'tools/sprites/**',
  'index.html',
  'CHANGELOG.md',
  'vite.config.ts',
  'tsconfig.json',
  'package.json',
]
