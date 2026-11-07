import {
  Array,
  Config,
  Console,
  Effect,
  Option,
  Record,
  Schema,
  String,
} from 'effect'

import { encodeJson } from '../json'
import { HARNESS, openBrowser, runAudit } from './lib'
import { FrameRow, measureScenario } from './measure'
import { attempt } from './page'
import { SCENARIOS } from './scenarios'

runAudit(
  Effect.gen(function* () {
    const base = yield* Config.String('BASE').pipe(Config.withDefault(HARNESS))
    const seconds = yield* Config.String('SECONDS').pipe(
      Config.withDefault('6'),
      Config.map(Number),
    )
    const ratesText = yield* Config.String('RATES').pipe(
      Config.withDefault('1,4,6'),
    )
    const rates = Array.map(String.split(',')(ratesText), Number)
    const only = yield* Config.String('ONLY').pipe(
      Config.map(String.split(',')),
      Config.option,
    )
    const tag = yield* Config.String('TAG').pipe(Config.withDefault('run'))

    const browser = yield* openBrowser
    const results: Array<FrameRow> = []
    for (const name of Record.keys(SCENARIOS)) {
      if (Option.isSome(only) && !Array.contains(only.value, name)) {
        continue
      }
      for (const rate of rates) {
        const row = yield* measureScenario(browser, base, name, rate, seconds)
        yield* Console.log(encodeJson(FrameRow)(row))
        results.push(row)
      }
    }
    const json = encodeJson(Schema.Array(FrameRow), 1)(results)
    yield* attempt(() => Bun.write(`${import.meta.dir}/perf-${tag}.json`, json))
  }),
)
