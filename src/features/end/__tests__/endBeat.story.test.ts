import { Array, Effect, Option } from 'effect'

import { Component, UiStruct } from '@effect/ui'
import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '#app/message.ts'
import { AudioState, type Model, Phase, RunMode } from '#app/model.ts'
import { SendShareEvent } from '#app/update/end.ts'
import { PlaySound } from '#app/update/sound.ts'
import { withBests } from '#domain/run.ts'
import {
  SHARE_COPIED_MS,
  TIMELINES,
  doneMs,
  isShareCopied,
  lensOf,
  rowLandMs,
  rowStartMs,
  sharePathOf,
  shownValue,
  tallyRowsOf,
} from '#features/end/endBeat.ts'
import {
  GAME_URL,
  copiedLineOf,
  sharePostOf,
  shareText,
} from '#features/end/share.ts'
import { mergeRunRecords } from '#platform/save/playerProjection.ts'
import { RUNNING_BUILD } from '#platform/version.ts'
import { bestsFor } from '#screens/home/home.ts'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  RESTART_GRACE_MS,
} from '#shared/constants.ts'
import { noSavedRunRecords } from '#shared/records/playerData.ts'
import { lastHeart, readyModel, withKeys } from '#test/model.fixture.ts'
import {
  type AppStory,
  checkModel,
  modelAfter,
  press,
  resolveAll,
  resolvePlayed,
  send,
  storyOf,
  throughIntro,
  tick,
  ticks,
} from '#test/testing.ts'
import { focusOf, seatCrew } from '#world/party/party.ts'
import { withWorld } from '#world/schema/world.ts'

const midRun: Model = UiStruct.evolve(readyModel, {
  phase: () => Phase.Wave({ wave: 4, elapsedMs: 4000, spawns: [] }),
})

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  UiStruct.evolve(readyModel, {
    phase: () => phase,
    screenMs: () => screenMs,
    mode: () => RunMode.Campaign(),
  })

const audible = (base: Model): Model =>
  UiStruct.evolve(base, {
    audio: () => AudioState.Ready,
    settings: UiStruct.evolve({ soundSetting: () => 'On' as const }),
  })

const gameOver = Phase.GameOver({ wave: 4 })

describe('the death beat', () => {
  it.effect(
    'the last bite starts the beat: the clock from 0 and the lens',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(lastHeart(midRun))
        s.pipe(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(after => {
            expect(after.phase).toEqual(gameOver)
            expect(after.screenMs).toBe(0)
            expect(lensOf(after)).toEqual(
              Option.some({ zoom: 1, saturation: 1 }),
            )
          }),
          ticks(1, 400),
          checkModel(after => {
            expect(after.screenMs).toBe(MAX_FRAME_DELTA_MS)
            const lens = Option.getOrThrow(lensOf(after))
            expect(lens.zoom).toBeGreaterThan(1)
            expect(lens.saturation).toBeLessThan(1)
          }),
        )
      }),
  )

  it.effect('the stamp lands with a stomp and a shake', () => {
    const stampAtMs = TIMELINES.Munched.stampAtMs
    return Effect.gen(function* () {
      const s = yield* storyOf(audible(onEndScreen(gameOver, stampAtMs - 10)))
      s.pipe(
        tick(20),
        checkModel(after => {
          expect(after.shake.trauma).toBeGreaterThan(0)
        }),
        (story: AppStory) =>
          story.expectHas(PlaySound.make({ sound: 'BossStomp', variation: 0 })),
        resolvePlayed,
      )
    })
  })

  it.effect('the world stands still while the beat plays', () =>
    Effect.gen(function* () {
      const zombiesAt = (current: Model) =>
        Array.map(current.zombies, zombie => [zombie.x, zombie.y])
      const fallen = yield* modelAfter(lastHeart(midRun), tick(FIXED_STEP_MS))
      const s = yield* storyOf(fallen)
      s.pipe(
        ticks(20, 50),
        checkModel(after => {
          expect(zombiesAt(after)).toEqual(zombiesAt(fallen))
          expect(focusOf(after).player).toEqual(focusOf(fallen).player)
          expect(after.phase).toEqual(gameOver)
        }),
      )
    }),
  )
})

describe('skipping and retrying', () => {
  it.effect(
    'any key in the beat skips to the finished card, and does nothing else',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(onEndScreen(gameOver, 100))
        s.pipe(
          press('KeyW'),
          checkModel(after => {
            expect(after.screenMs).toBe(doneMs('Munched'))
            expect(after.phase).toEqual(gameOver)
          }),
        )
      }),
  )

  it.effect(
    'Enter before the restart grace only skips, so a held key never retries',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(onEndScreen(gameOver, 100))
        s.pipe(
          press('Enter'),
          checkModel(after => {
            expect(after.phase).toEqual(gameOver)
            expect(after.screenMs).toBe(doneMs('Munched'))
          }),
          press('Enter'),
          throughIntro,
          checkModel(after => {
            expect(after.phase._tag).toBe('Preparation')
          }),
        )
      }),
  )

  it.effect(
    'Enter after the grace retries at once, mid beat, in the run own mode',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(
            onEndScreen(Phase.GameOver({ wave: 13 }), RESTART_GRACE_MS),
            {
              mode: () => RunMode.Endless(),
            },
          ),
        )
        s.pipe(
          press('Enter'),
          throughIntro,
          checkModel(after => {
            expect(after.phase._tag).toBe('Preparation')
            expect(after.mode).toEqual(RunMode.Endless())
          }),
        )
      }),
  )

  it.effect('a tap on the game skips the beat but never starts a run', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onEndScreen(Phase.Escaped({ wave: 10 }), 200))
      s.pipe(
        send(
          Message.PressedPointer({
            pointerId: 1,
            device: 'Touch',
            clientX: 100,
            clientY: 100,
          }),
        ),
        checkModel(after => {
          expect(after.screenMs).toBe(doneMs('Won'))
          expect(after.phase).toEqual(Phase.Escaped({ wave: 10 }))
        }),
      )
    }),
  )

  it.effect('RETRY starts the run again', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(onEndScreen(gameOver, doneMs('Munched')))
      s.pipe(
        send(Message.ClickedRetryButton()),
        throughIntro,
        checkModel(after => {
          expect(after.phase._tag).toBe('Preparation')
        }),
      )
    }),
  )
})

describe('the tally', () => {
  const tallied = withKeys(
    UiStruct.evolve(onEndScreen(gameOver, 0), {
      bestStreak: () => 12,
      stats: stats =>
        UiStruct.evolve(stats, {
          kills: kills => UiStruct.evolve(kills, { Shambler: () => 40 }),
          shotsFired: () => 100,
          shotsHit: () => 55,
        }),
    }),
    24,
  )

  test('a loss counts the wave, the kills, the streak, the aim, and the keys found', () => {
    const rows = tallyRowsOf(tallied)
    expect(Array.map(rows, row => row.label)).toEqual([
      'WAVE',
      'SPLATTED',
      'STREAK',
      'AIM',
      'KEYS',
    ])
    expect(Array.map(rows, row => row.value)).toEqual([4, 40, 12, 55, 24])
    expect(Array.map(rows, row => row.format(row.value))).toEqual([
      '4/10',
      '40',
      '12',
      '55%',
      '$24',
    ])
  })

  test('each row counts up from 0 on its turn and lands on its value', () => {
    const [, kills] = tallyRowsOf(tallied)
    const row = kills!
    expect(shownValue(row, 'Munched', 1, rowStartMs('Munched', 1) - 1)).toBe(0)
    const midway = shownValue(
      row,
      'Munched',
      1,
      (rowStartMs('Munched', 1) + rowLandMs('Munched', 1)) / 2,
    )
    expect(midway).toBeGreaterThan(0)
    expect(midway).toBeLessThan(40)
    expect(shownValue(row, 'Munched', 1, rowLandMs('Munched', 1))).toBe(40)
  })

  test('a win counts the time first', () => {
    const won = UiStruct.evolve(tallied, {
      phase: () => Phase.Escaped({ wave: 10 }),
      stats: stats => UiStruct.evolve(stats, { runMs: () => 371_000 }),
    })
    const [first] = tallyRowsOf(won)
    expect(first?.format(first.value)).toBe('6:11')
  })
})

describe('NEW BEST', () => {
  const endlessAt = (best: number, wave: number): Model =>
    lastHeart(
      withBests(
        UiStruct.evolve(midRun, {
          mode: () => RunMode.Endless(),
          phase: () => Phase.Wave({ wave, elapsedMs: 4000, spawns: [] }),
        }),
        bests =>
          UiStruct.evolve(bests, {
            maybeBestEndlessWave: () => Option.some(best),
          }),
      ),
    )

  it.effect(
    'falling deeper than the endless best is a NEW BEST on the wave',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(endlessAt(12, 14))
        s.pipe(
          send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
          checkModel(after => {
            expect(after.runRecords).toEqual(['Wave'])
            expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
          }),
        )
      }),
  )

  it.effect('falling short of it, or matching it, is no NEW BEST', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(endlessAt(14, 14))
      s.pipe(
        send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        checkModel(after => {
          expect(after.runRecords).toEqual([])
        }),
      )
    }),
  )

  it.effect('a NEW BEST bursts with its own sound as its row lands', () => {
    const best = UiStruct.evolve(
      audible(onEndScreen(Phase.GameOver({ wave: 14 }), 0)),
      {
        mode: () => RunMode.Endless(),
        runRecords: () => ['Wave' as const],
      },
    )
    const landMs = rowLandMs('Munched', 0)
    return Effect.gen(function* () {
      const s = yield* storyOf(
        UiStruct.evolve(best, { screenMs: () => landMs - 5 }),
      )
      s.pipe(
        tick(10),
        (story: AppStory) =>
          story.expectHas(PlaySound.make({ sound: 'PowerUp', variation: 0 })),
        resolveAll(PlaySound)(Component.noop),
      )
    })
  })
})

describe('the run records', () => {
  const campaignAt = (furthestWave: number, mostKills: number): Model =>
    lastHeart(
      withBests(
        UiStruct.evolve(midRun, {
          phase: () => Phase.Wave({ wave: 5, elapsedMs: 4000, spawns: [] }),
          stats: stats =>
            UiStruct.evolve(stats, {
              kills: kills => UiStruct.evolve(kills, { Shambler: () => 34 }),
            }),
        }),
        bests =>
          UiStruct.evolve(bests, {
            maybeFurthestWave: () => Option.some(furthestWave),
            maybeMostKills: () => Option.some(mostKills),
          }),
      ),
    )

  const fall = send(Message.TickedFrame({ deltaTime: FIXED_STEP_MS }))

  it.effect(
    'a campaign death past the furthest wave is a NEW BEST, and is kept',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(campaignAt(3, 100))
        s.pipe(
          fall,
          checkModel(after => {
            expect(after.runRecords).toEqual(['Wave'])
            expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
            expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
            expect(bestsFor(after).maybeMostKills).toEqual(Option.some(100))
          }),
        )
      }),
  )

  it.effect('dying on the furthest wave again is no NEW BEST', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(campaignAt(5, 100))
      s.pipe(
        fall,
        checkModel(after => {
          expect(after.runRecords).toEqual([])
          expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
        }),
      )
    }),
  )

  it.effect(
    'more kills than ever in one run is a NEW BEST on SPLATTED, and is kept',
    () =>
      Effect.gen(function* () {
        const s = yield* storyOf(campaignAt(9, 20))
        s.pipe(
          fall,
          checkModel(after => {
            expect(after.runRecords).toEqual(['Kills'])
            expect(tallyRowsOf(after)[1]?.isBest).toBe(true)
            expect(bestsFor(after).maybeMostKills).toEqual(Option.some(34))
            expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(9))
          }),
        )
      }),
  )

  it.effect('matching the most kills is no NEW BEST', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(campaignAt(9, 34))
      s.pipe(
        fall,
        checkModel(after => {
          expect(after.runRecords).toEqual([])
        }),
      )
    }),
  )

  it.effect('a first run sets both records without a NEW BEST', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        lastHeart(
          UiStruct.evolve(midRun, {
            phase: () => Phase.Wave({ wave: 5, elapsedMs: 4000, spawns: [] }),
          }),
        ),
      )
      s.pipe(
        fall,
        checkModel(after => {
          expect(after.runRecords).toEqual([])
          expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
          expect(Option.isSome(bestsFor(after).maybeMostKills)).toBe(true)
        }),
      )
    }),
  )

  test('two devices merge their records to the larger of each', () => {
    const record = (furthestWave: number | null, mostKills: number | null) => ({
      ...noSavedRunRecords,
      Hard: { furthestWave, mostKills, bestRun: null },
    })
    expect(mergeRunRecords(record(7, 40), record(4, 95)).Hard).toEqual({
      furthestWave: 7,
      mostKills: 95,
      bestRun: null,
    })
    expect(mergeRunRecords(record(null, 12), record(3, null)).Hard).toEqual({
      furthestWave: 3,
      mostKills: 12,
      bestRun: null,
    })
    expect(mergeRunRecords(record(4, 95), record(7, 40))).toEqual(
      mergeRunRecords(record(7, 40), record(4, 95)),
    )
  })
})

describe('sharing a run', () => {
  const base = {
    isEndless: false,
    wave: 4,
    things: [],
    difficulty: 'Normal' as const,
    kills: 87,
    crew: 1,
    maybeMvp: Option.none(),
    maybeOwnAward: Option.none(),
  }

  test('a run left early names what it ran off with, with a chicken', () => {
    expect(
      shareText({ ...base, outcome: 'Chicken', things: ['SilverSpoon'] }),
    ).toBe(
      '🐔 I chickened out of Munch Manor with the Silver Spoon on wave 4. 87 zombies splatted first. Braver than me?',
    )
    expect(
      shareText({
        ...base,
        outcome: 'Chicken',
        crew: 2,
        things: ['SilverSpoon', 'MusicBox', 'ButlersBell'],
      }),
    ).toBe(
      "🐔 Our crew of 2 chickened out of Munch Manor with the Silver Spoon, the Music Box, and the Butler's Bell on wave 4. 87 zombies splatted together. Next time, the front door.",
    )
  })

  test('a death says the wave and the kills, with a skull', () => {
    expect(shareText({ ...base, outcome: 'Munched' })).toBe(
      '💀 Got munched on wave 4 in Munch Manor. 87 zombies splatted first. Your turn!',
    )
    expect(
      shareText({ ...base, outcome: 'Munched', isEndless: true, wave: 23 }),
    ).toBe(
      '💀 Got munched on endless wave 23 in Munch Manor. 87 zombies splatted first. Your turn!',
    )
  })

  test('an escape says Uncle Chunk, the difficulty, and the wave', () => {
    expect(
      shareText({
        ...base,
        outcome: 'Won',
        difficulty: 'Nightmare',
        kills: 612,
      }),
    ).toBe(
      '🗝️ I beat Uncle Chunk and escaped Munch Manor on TRIPLE DOG DARE! Out on wave 4, 612 zombies splatted.',
    )
  })

  test('a crew says how many played', () => {
    expect(shareText({ ...base, outcome: 'Won', crew: 3, kills: 900 })).toBe(
      '🗝️ Our crew of 3 beat Uncle Chunk and escaped Munch Manor on Double Dare! Out on wave 4, 900 zombies splatted together.',
    )
    expect(shareText({ ...base, outcome: 'Munched', crew: 2 })).toBe(
      '💀 Our crew of 2 got munched on wave 4 in Munch Manor. 87 zombies splatted together. Bring snacks.',
    )
  })

  test('a crew crowns its MVP and brags about your own award', () => {
    expect(
      shareText({
        ...base,
        outcome: 'Won',
        crew: 3,
        kills: 900,
        maybeMvp: Option.some({ name: 'ANA', kills: 412 }),
        maybeOwnAward: Option.some('Medic'),
      }),
    ).toBe(
      '🗝️ Our crew of 3 beat Uncle Chunk and escaped Munch Manor on Double Dare! Out on wave 4, 900 zombies splatted together. 👑 MVP: ANA with 412. I was the Medic 🩹.',
    )
    expect(
      shareText({
        ...base,
        outcome: 'Munched',
        crew: 2,
        maybeMvp: Option.some({ name: 'BO', kills: 50 }),
        maybeOwnAward: Option.some('MostMunched'),
      }),
    ).toBe(
      '💀 Our crew of 2 got munched on wave 4 in Munch Manor. 87 zombies splatted together. 👑 MVP: BO with 50. I got Most Munched 🍖. Bring snacks.',
    )
  })

  test('the post is the words and the game, apart, and the copy joins them', () => {
    const post = sharePostOf({ ...base, outcome: 'Munched' })
    expect(post).toEqual({
      text: shareText({ ...base, outcome: 'Munched' }),
      url: GAME_URL,
    })
    expect(GAME_URL).toBe('https://munchmanor.com')
    expect(copiedLineOf(post)).toBe(
      '💀 Got munched on wave 4 in Munch Manor. 87 zombies splatted first. Your turn! https://munchmanor.com',
    )
  })

  test('no word of the post names X', () => {
    const runs = [
      { ...base, outcome: 'Munched' as const },
      { ...base, outcome: 'Won' as const },
      { ...base, outcome: 'Munched' as const, crew: 3 },
      { ...base, outcome: 'Won' as const, crew: 2 },
    ]
    for (const run of runs) {
      expect(copiedLineOf(sharePostOf(run))).not.toMatch(/\bX\b|x\.com/)
    }
  })

  const VISIT_ID = '0123456789abcdef'
  const counted = (ended: Model, shareStats: 'On' | 'Off'): Model =>
    UiStruct.evolve(ended, {
      maybeVisitId: () => Option.some(VISIT_ID),
      settings: UiStruct.evolve({ shareStats: () => shareStats }),
    })

  const withSheet = (ended: Model): Model =>
    UiStruct.evolve(ended, {
      endCard: UiStruct.evolve({ shareSheet: () => 'Available' as const }),
    })

  const deathEvent = (path: 'Sheet' | 'Copy') =>
    SendShareEvent.make({
      event: {
        version: 2,
        visitId: VISIT_ID,
        build: RUNNING_BUILD,
        screen: 'Death',
        mode: 'Campaign',
        difficulty: 'Normal',
        path,
      },
    })

  it.effect('the boot finds the share sheet', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(readyModel)
      s.pipe(
        send(Message.CompletedDetectShareSheet({ shareSheet: 'Available' })),
        checkModel(after => {
          expect(after.endCard.shareSheet).toBe('Available')
        }),
      )
    }),
  )

  it.effect.each([
    ['a phone', 'Touch'],
    ['a desktop', 'KeyboardMouse'],
  ] as const)(
    'a tap on SHARE on %s with a share sheet only counts it, on the Sheet path',
    ([_name, device]) =>
      Effect.gen(function* () {
        const s = yield* storyOf(
          UiStruct.evolve(
            withSheet(counted(onEndScreen(gameOver, doneMs('Munched')), 'On')),
            { lastDevice: () => device },
          ),
        )
        s.pipe(
          send(Message.ClickedShareButton()),
          (story: AppStory) => story.expectExact(deathEvent('Sheet')),
          (story: AppStory) => story.resolve(SendShareEvent, Component.noop),
        )
      }),
  )

  it.effect('with no share sheet the share counts on the Copy path', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        counted(onEndScreen(gameOver, doneMs('Munched')), 'On'),
      )
      s.pipe(
        send(Message.ClickedShareButton()),
        checkModel(after => {
          expect(sharePathOf(after)).toBe('Copy')
        }),
        (story: AppStory) => story.expectExact(deathEvent('Copy')),
        (story: AppStory) => story.resolve(SendShareEvent, Component.noop),
      )
    }),
  )

  it.effect('a copied post flashes COPIED! on SHARE for a moment', () => {
    const atEnd = onEndScreen(gameOver, doneMs('Munched'))
    return Effect.gen(function* () {
      const s = yield* storyOf(atEnd)
      s.pipe(
        send(Message.SettledShare({ outcome: 'Copied' })),
        (story: AppStory) => story.expectNone(),
        checkModel(after => {
          expect(after.endCard.maybeShareCopiedAtMs).toEqual(
            Option.some(atEnd.screenMs),
          )
          expect(isShareCopied(after)).toBe(true)
        }),
        ticks(Math.ceil(SHARE_COPIED_MS / 50), 50),
        checkModel(after => {
          expect(isShareCopied(after)).toBe(false)
        }),
      )
    })
  })

  it.effect.each(['Shared', 'Cancelled', 'Failed'] as const)(
    'a share that ends %s leaves SHARE as it was',
    outcome =>
      Effect.gen(function* () {
        const s = yield* storyOf(onEndScreen(gameOver, doneMs('Munched')))
        s.pipe(
          send(Message.SettledShare({ outcome })),
          (story: AppStory) => story.expectNone(),
          checkModel(after => {
            expect(isShareCopied(after)).toBe(false)
          }),
        )
      }),
  )

  it.effect('nothing is counted when play stats are off', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        counted(onEndScreen(gameOver, doneMs('Munched')), 'Off'),
      )
      s.pipe(send(Message.ClickedShareButton()), (story: AppStory) =>
        story.expectNone(),
      )
    }),
  )

  it.effect('X is no longer a share key', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        withSheet(counted(onEndScreen(gameOver, RESTART_GRACE_MS * 4), 'On')),
      )
      s.pipe(press('KeyX'), (story: AppStory) => story.expectNone())
    }),
  )

  it.effect('a solo escape is counted from the escape screen', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(
        counted(onEndScreen(Phase.Escaped({ wave: 10 }), doneMs('Won')), 'On'),
      )
      s.pipe(
        send(Message.ClickedShareButton()),
        (story: AppStory) =>
          story.expectExact(
            SendShareEvent.make({
              event: {
                version: 2,
                visitId: VISIT_ID,
                build: RUNNING_BUILD,
                screen: 'Escaped',
                mode: 'Campaign',
                difficulty: 'Normal',
                path: 'Copy',
              },
            }),
          ),
        (story: AppStory) => story.resolve(SendShareEvent, Component.noop),
      )
    }),
  )

  it.effect('a crew win is counted from the co-op escape screen', () => {
    const crewed = withWorld(
      counted(onEndScreen(Phase.Escaped({ wave: 10 }), doneMs('Won')), 'On'),
      world => seatCrew(world, 3),
    )
    return Effect.gen(function* () {
      const s = yield* storyOf(crewed)
      s.pipe(
        send(Message.ClickedShareButton()),
        (story: AppStory) =>
          story.expectExact(
            SendShareEvent.make({
              event: {
                version: 2,
                visitId: VISIT_ID,
                build: RUNNING_BUILD,
                screen: 'CoopEscaped',
                mode: 'Campaign',
                difficulty: 'Normal',
                path: 'Copy',
              },
            }),
          ),
        (story: AppStory) => story.resolve(SendShareEvent, Component.noop),
      )
    })
  })
})
