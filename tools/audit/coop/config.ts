import { Array, Config, Console, Effect, Option, String } from 'effect'

import { AUDIT_PARAM } from '@game/features/coop/audit/readout'

type CoopConfig = Readonly<{
  base: string
  players: number
  isQuick: boolean
  pickMode: string | undefined
  pickDifficulty: string | undefined
  netRtt: number | undefined
  netJitter: number | undefined
  netLoss: number | undefined
}>

export const coopConfig = Effect.gen(function* () {
  const maybeEnvBase = yield* Config.String('BASE').pipe(Config.option)
  const maybeBase = Option.orElse(
    Option.fromUndefinedOr(process.argv[2]),
    () => maybeEnvBase,
  )
  if (Option.isNone(maybeBase)) {
    yield* Console.error('Usage: bun tools/audit/coop.ts <game url> [players]')
    return yield* Effect.sync(() => process.exit(2))
  }
  const audited = new URL(maybeBase.value)
  audited.searchParams.set(AUDIT_PARAM, '1')
  const quick = yield* Config.String('QUICK').pipe(Config.withDefault(''))
  const pick = yield* Config.String('PICK').pipe(Config.withDefault(''))
  const net = yield* Config.String('NET').pipe(Config.withDefault(''))
  const [pickMode, pickDifficulty] = String.split(',')(pick)
  const [netRtt, netJitter, netLoss] = Array.map(String.split(',')(net), Number)
  const config: CoopConfig = {
    base: audited.href,
    players: Math.min(3, Math.max(2, Number(process.argv[3] ?? 3))),
    isQuick: quick === '1',
    pickMode,
    pickDifficulty,
    netRtt,
    netJitter,
    netLoss,
  }
  return config
})
