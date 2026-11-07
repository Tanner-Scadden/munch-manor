// NOTE: the root package has no Bun types, so this declares the slice of
// the Bun global that the harness uses.
declare namespace Bun {
  type OnResolveArgs = { path: string; importer: string }
  type OnLoadArgs = { path: string }
  type PluginBuilder = {
    onResolve(
      options: { filter: RegExp },
      callback: (args: OnResolveArgs) => { path: string; namespace: string },
    ): void
    onLoad(
      options: { filter: RegExp; namespace: string },
      callback: (
        args: OnLoadArgs,
      ) => Promise<{ contents: string; loader: 'js' }>,
    ): void
  }
  type BunPlugin = { name: string; setup(build: PluginBuilder): void }
  type BuildOutput = {
    success: boolean
    logs: ReadonlyArray<unknown>
    outputs: ReadonlyArray<{ size: number; path: string }>
    metafile?: { inputs: Record<string, unknown> }
  }
  function file(path: string): { text(): Promise<string> }
  function build(options: {
    entrypoints: Array<string>
    outdir: string
    target: 'node' | 'browser'
    format: 'esm' | 'iife'
    minify: boolean
    metafile: boolean
    plugins: Array<BunPlugin>
    define: Record<string, string>
  }): Promise<BuildOutput>
}
