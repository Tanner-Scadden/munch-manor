import './globals'
import { answer } from './engine'
import { requestOf } from './request'

const engineName =
  'Bun' in globalThis
    ? `bun ${process.versions['bun'] ?? ''} (JavaScriptCore)`
    : `node ${process.version} (V8)`

process.stdout.write(
  answer(engineName, requestOf(new URLSearchParams(process.argv[2] ?? ''))),
)
