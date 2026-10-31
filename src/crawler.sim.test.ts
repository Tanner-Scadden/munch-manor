// The Ankle Biter sim test: a whole wave 7 played twice from one seed. It
// takes about a second, so it runs in `bun run test:full` and CI, not in
// `bun run test`. The Ankle Biter's rules are in crawler.story.test.ts.
import { Array, Option } from 'effect'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PREPARATION_MS } from './constants'
import { rollSpawns } from './endlessWaves'
import { frenzyPacksOf } from './frenzy'
import { update } from './main'
import { Message } from './message'
import { type Model, Phase, initialModel } from './model'
import { asVeteran } from './veteran'

describe('the Ankle Biter', () => {
  test('a wave with Ankle Biters, a Big Leaguer, and frenzied packs replays the same from the same seed', () => {
    const play = (seed: number): Model => {
      const [rngState, spawns] = rollSpawns(seed, 7)
      const start = modifyFields(asVeteran(initialModel), {
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
        player: player =>
          modifyFields(player, {
            hp: () => 1e6,
          }),
      })
      const started = update(start, Message.ClickedStartWaveButton()).model
      const skipped = update(
        started,
        Message.PressedKey({ code: 'Enter' }),
      ).model
      const held = update(
        update(skipped, Message.ReleasedKey({ code: 'Enter' })).model,
        Message.PressedKey({ code: 'KeyD' }),
      ).model
      return Array.reduce(
        Array.makeBy(1800, index => index),
        held,
        (current, index) =>
          update(
            current,
            Message.TickedFrame({ deltaTime: index % 3 === 0 ? 33 : 17 }),
          ).model,
      )
    }

    const first = play(2024)
    const again = play(2024)
    expect(again.zombies).toEqual(first.zombies)
    expect(again.player).toEqual(first.player)
    expect(again.rngState).toBe(first.rngState)
    expect(again.phase).toEqual(first.phase)
    expect(again.frenzyPacks).toEqual(first.frenzyPacks)
    expect(
      Array.some(
        first.zombies,
        zombie => zombie.kind === 'Crawler' || zombie.kind === 'Thrower',
      ) || first.stats.kills.Crawler + first.stats.kills.Thrower > 0,
    ).toBe(true)
  })
})
