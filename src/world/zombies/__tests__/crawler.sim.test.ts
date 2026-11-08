// The Ankle Biter sim test: a whole wave 7 played twice from one seed. It
// takes about a second, so it runs in `bun run test:full` and CI, not in
// `bun run test`. The Ankle Biter's rules are in crawler.story.test.ts.
import { Array, Effect, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it } from '@effect/vitest'

import { Message } from '../../../app/message'
import { Phase } from '../../../app/model'
import { initialModel } from '../../../app/pureApp'
import { PREPARATION_MS } from '../../../shared/constants'
import { playedThrough } from '../../../test/testing'
import { asVeteran } from '../../../test/veteran'
import { focusOf, modifyFocus } from '../../party/party'
import { rollSpawns } from '../../waves/endlessWaves'
import { frenzyPacksOf } from '../frenzy'

describe('the Ankle Biter', () => {
  it.effect(
    'a wave with Ankle Biters, a Big Leaguer, and frenzied packs replays the same from the same seed',
    () =>
      Effect.gen(function* () {
        const play = (seed: number) => {
          const [rngState, spawns] = rollSpawns(seed, 7)
          const start = modifyFocus(
            modifyFields(asVeteran(initialModel), {
              maybeSurface: () =>
                Option.some({ left: 0, top: 0, width: 800, height: 400 }),
              rngState: () => rngState,
              phase: () =>
                Phase.Preparation({
                  wave: 7,
                  remainingMs: PREPARATION_MS,
                  durationMs: PREPARATION_MS,
                  spawns,
                }),
              frenzyPacks: () => frenzyPacksOf(spawns),
            }),
            {
              player: player =>
                modifyFields(player, {
                  hp: () => 1e6,
                }),
            },
          )
          return playedThrough(start, [
            Message.ClickedStartWaveButton(),
            Message.PressedKey({ code: 'Enter' }),
            Message.ReleasedKey({ code: 'Enter' }),
            Message.PressedKey({ code: 'KeyD' }),
            ...Array.makeBy(1800, index =>
              Message.TickedFrame({ deltaTime: index % 3 === 0 ? 33 : 17 }),
            ),
          ])
        }

        const first = yield* play(2024)
        const again = yield* play(2024)
        expect(again.zombies).toEqual(first.zombies)
        expect(focusOf(again).player).toEqual(focusOf(first).player)
        expect(again.rngState).toBe(first.rngState)
        expect(again.phase).toEqual(first.phase)
        expect(again.frenzyPacks).toEqual(first.frenzyPacks)
        expect(
          Array.some(
            first.zombies,
            zombie => zombie.kind === 'Crawler' || zombie.kind === 'Thrower',
          ) || first.stats.kills.Crawler + first.stats.kills.Thrower > 0,
        ).toBe(true)
      }),
  )
})
