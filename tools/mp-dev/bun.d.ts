declare namespace Bun {
  type BuildOutput = {
    success: boolean
    logs: ReadonlyArray<unknown>
    outputs: ReadonlyArray<{ size: number }>
  }
  function build(options: {
    entrypoints: Array<string>
    outdir: string
    target: 'node' | 'browser'
    format: 'esm'
    minify: boolean
    metafile: boolean
    plugins: Array<unknown>
    define: Record<string, string>
  }): Promise<BuildOutput>
  type Server = { readonly port: number; stop(force?: boolean): void }
  function serve(options: {
    port: number
    hostname?: string
    fetch(request: Request): Response | Promise<Response>
  }): Server
  function resolveSync(specifier: string, from: string): string
  function file(path: string): Blob & { exists(): Promise<boolean> }
  type Subprocess = {
    readonly exited: Promise<number>
    kill(signal?: number): void
  }
  function spawn(
    command: ReadonlyArray<string>,
    options?: {
      cwd?: string
      stdout?: 'inherit' | 'pipe' | 'ignore'
      stderr?: 'inherit' | 'pipe' | 'ignore'
      env?: Record<string, string | undefined>
    },
  ): Subprocess
}

interface ImportMeta {
  readonly main: boolean
}
