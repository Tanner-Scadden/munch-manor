import { Array, Effect, Option } from 'effect'
import { Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'

import { Message } from '../../../app/message'
import { AudioState, type Model, Phase, RunMode } from '../../../app/model'
import { SendShareEvent } from '../../../app/update/end'
import { PlaySound } from '../../../app/update/sound'
import { withBests } from '../../../domain/run'
import { mergeRunRecords } from '../../../platform/playerScope'
import { RUNNING_BUILD } from '../../../platform/version'
import { bestsFor } from '../../../screens/home/home'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  RESTART_GRACE_MS,
} from '../../../shared/constants'
import { noSavedRunRecords } from '../../../shared/playerData'
import { lastHeart, readyModel } from '../../../test/model.fixture'
import { APPLICATION, press, throughIntro, tick } from '../../../test/testing'
import { focusOf, modifyFocus, seatCrew } from '../../../world/party/party'
import { withWorld } from '../../../world/schema/world'
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
} from '../endBeat'
import { GAME_URL, copiedLineOf, sharePostOf, shareText } from '../share'

const midRun: Model = modifyFields(readyModel, {
  phase: () => Phase.Wave({ wave: 4, elapsedMs: 4000, spawns: [] }),
})

const onEndScreen = (phase: Phase, screenMs: number): Model =>
  modifyFields(readyModel, {
    phase: () => phase,
    screenMs: () => screenMs,
    mode: () => RunMode.Campaign(),
  })

const audible = (base: Model): Model =>
  modifyFields(base, {
    audio: () => AudioState.Ready(),
    soundSetting: () => 'On' as const,
  })

const gameOver = Phase.GameOver({ wave: 4 })

describe('the death beat', () => {
  it.effect(
    'the last bite starts the beat: the clock from 0 and the lens',
    () =>
      Story.story(
        APPLICATION,
        Story.given(lastHeart(midRun)),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(after => {
          expect(after.phase).toEqual(gameOver)
          expect(after.screenMs).toBe(0)
          expect(lensOf(after)).toEqual(Option.some({ zoom: 1, saturation: 1 }))
        }),
        ...Array.makeBy(1, () => tick(400)),
        Story.model(after => {
          expect(after.screenMs).toBe(MAX_FRAME_DELTA_MS)
          const lens = Option.getOrThrow(lensOf(after))
          expect(lens.zoom).toBeGreaterThan(1)
          expect(lens.saturation).toBeLessThan(1)
        }),
      ),
  )

  it.effect('the stamp lands with a stomp and a shake', () => {
    const stampAtMs = TIMELINES.Munched.stampAtMs
    return Story.story(
      APPLICATION,
      Story.given(audible(onEndScreen(gameOver, stampAtMs - 10))),
      tick(20),
      Story.model(after => {
        expect(after.shake.trauma).toBeGreaterThan(0)
      }),
      Story.Command.expectHas(PlaySound({ sound: 'BossStomp', variation: 0 })),
      Story.Command.resolve(
        PlaySound,
        Message.CompletedPlaySound({ sound: 'Pop', outcome: 'Played' }),
      ),
    )
  })

  it.effect('the world stands still while the beat plays', () =>
    Effect.gen(function* () {
      const zombiesAt = (current: Model) =>
        Array.map(current.zombies, zombie => [zombie.x, zombie.y])
      const fallen = yield* Story.story(
        APPLICATION,
        Story.given(lastHeart(midRun)),
        tick(FIXED_STEP_MS),
      )
      return yield* Story.story(
        APPLICATION,
        Story.given(fallen),
        ...Array.makeBy(20, () => tick(50)),
        Story.model(after => {
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
      Story.story(
        APPLICATION,
        Story.given(onEndScreen(gameOver, 100)),
        press('KeyW'),
        Story.model(after => {
          expect(after.screenMs).toBe(doneMs('Munched'))
          expect(after.phase).toEqual(gameOver)
        }),
      ),
  )

  it.effect(
    'Enter before the restart grace only skips, so a held key never retries',
    () =>
      Story.story(
        APPLICATION,
        Story.given(onEndScreen(gameOver, 100)),
        press('Enter'),
        Story.model(after => {
          expect(after.phase).toEqual(gameOver)
          expect(after.screenMs).toBe(doneMs('Munched'))
        }),
        press('Enter'),
        throughIntro,
        Story.model(after => {
          expect(after.phase._tag).toBe('Preparation')
        }),
      ),
  )

  it.effect(
    'Enter after the grace retries at once, mid beat, in the run own mode',
    () =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(
            onEndScreen(Phase.GameOver({ wave: 13 }), RESTART_GRACE_MS),
            {
              mode: () => RunMode.Endless(),
            },
          ),
        ),
        press('Enter'),
        throughIntro,
        Story.model(after => {
          expect(after.phase._tag).toBe('Preparation')
          expect(after.mode).toEqual(RunMode.Endless())
        }),
      ),
  )

  it.effect('a tap on the game skips the beat but never starts a run', () =>
    Story.story(
      APPLICATION,
      Story.given(onEndScreen(Phase.Victory(), 200)),
      Story.message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Touch',
          clientX: 100,
          clientY: 100,
        }),
      ),
      Story.model(after => {
        expect(after.screenMs).toBe(doneMs('Won'))
        expect(after.phase).toEqual(Phase.Victory())
      }),
    ),
  )

  it.effect('RETRY starts the run again', () =>
    Story.story(
      APPLICATION,
      Story.given(onEndScreen(gameOver, doneMs('Munched'))),
      Story.message(Message.ClickedRetryButton()),
      throughIntro,
      Story.model(after => {
        expect(after.phase._tag).toBe('Preparation')
      }),
    ),
  )
})

describe('the tally', () => {
  const tallied = modifyFocus(
    modifyFields(onEndScreen(gameOver, 0), {
      bestStreak: () => 12,
      stats: stats =>
        modifyFields(stats, {
          kills: kills => modifyFields(kills, { Shambler: () => 40 }),
          shotsFired: () => 100,
          shotsHit: () => 55,
        }),
    }),
    { wallet: wallet => modifyFields(wallet, { earned: () => 240 }) },
  )

  test('a loss counts the wave, the kills, the streak, the aim, and the cash', () => {
    const rows = tallyRowsOf(tallied)
    expect(Array.map(rows, row => row.label)).toEqual([
      'WAVE',
      'SPLATTED',
      'STREAK',
      'AIM',
      'CASH',
    ])
    expect(Array.map(rows, row => row.value)).toEqual([4, 40, 12, 55, 240])
    expect(Array.map(rows, row => row.format(row.value))).toEqual([
      '4/10',
      '40',
      '12',
      '55%',
      '$240',
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
    const won = modifyFields(tallied, {
      phase: () => Phase.Victory(),
      stats: stats => modifyFields(stats, { runMs: () => 371_000 }),
    })
    const [first] = tallyRowsOf(won)
    expect(first?.format(first.value)).toBe('6:11')
  })
})

describe('NEW BEST', () => {
  const endlessAt = (best: number, wave: number): Model =>
    lastHeart(
      withBests(
        modifyFields(midRun, {
          mode: () => RunMode.Endless(),
          phase: () => Phase.Wave({ wave, elapsedMs: 4000, spawns: [] }),
        }),
        bests =>
          modifyFields(bests, {
            maybeBestEndlessWave: () => Option.some(best),
          }),
      ),
    )

  it.effect(
    'falling deeper than the endless best is a NEW BEST on the wave',
    () =>
      Story.story(
        APPLICATION,
        Story.given(endlessAt(12, 14)),
        Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
        Story.model(after => {
          expect(after.runRecords).toEqual(['Wave'])
          expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
        }),
      ),
  )

  it.effect('falling short of it, or matching it, is no NEW BEST', () =>
    Story.story(
      APPLICATION,
      Story.given(endlessAt(14, 14)),
      Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      Story.model(after => {
        expect(after.runRecords).toEqual([])
      }),
    ),
  )

  it.effect('a NEW BEST bursts with its own sound as its row lands', () => {
    const best = modifyFields(
      audible(onEndScreen(Phase.GameOver({ wave: 14 }), 0)),
      {
        mode: () => RunMode.Endless(),
        runRecords: () => ['Wave' as const],
      },
    )
    const landMs = rowLandMs('Munched', 0)
    return Story.story(
      APPLICATION,
      Story.given(modifyFields(best, { screenMs: () => landMs - 5 })),
      tick(10),
      Story.Command.expectHas(PlaySound({ sound: 'PowerUp', variation: 0 })),
      Story.Command.resolveAll(
        [
          PlaySound,
          Message.CompletedPlaySound({ sound: 'Pop', outcome: 'Played' }),
        ],
        [
          PlaySound,
          Message.CompletedPlaySound({ sound: 'PowerUp', outcome: 'Played' }),
        ],
      ),
    )
  })
})

describe('the run records', () => {
  // NOTE: a campaign death on wave 5 with 34 kills, against records that
  // stood before it.
  const campaignAt = (furthestWave: number, mostKills: number): Model =>
    lastHeart(
      withBests(
        modifyFields(midRun, {
          phase: () => Phase.Wave({ wave: 5, elapsedMs: 4000, spawns: [] }),
          stats: stats =>
            modifyFields(stats, {
              kills: kills => modifyFields(kills, { Shambler: () => 34 }),
            }),
        }),
        bests =>
          modifyFields(bests, {
            maybeFurthestWave: () => Option.some(furthestWave),
            maybeMostKills: () => Option.some(mostKills),
          }),
      ),
    )

  const fall = Story.message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS }))

  it.effect(
    'a campaign death past the furthest wave is a NEW BEST, and is kept',
    () =>
      Story.story(
        APPLICATION,
        Story.given(campaignAt(3, 100)),
        fall,
        Story.model(after => {
          expect(after.runRecords).toEqual(['Wave'])
          expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
          expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
          expect(bestsFor(after).maybeMostKills).toEqual(Option.some(100))
        }),
      ),
  )

  it.effect('dying on the furthest wave again is no NEW BEST', () =>
    Story.story(
      APPLICATION,
      Story.given(campaignAt(5, 100)),
      fall,
      Story.model(after => {
        expect(after.runRecords).toEqual([])
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
      }),
    ),
  )

  it.effect(
    'more kills than ever in one run is a NEW BEST on SPLATTED, and is kept',
    () =>
      Story.story(
        APPLICATION,
        Story.given(campaignAt(9, 20)),
        fall,
        Story.model(after => {
          expect(after.runRecords).toEqual(['Kills'])
          expect(tallyRowsOf(after)[1]?.isBest).toBe(true)
          expect(bestsFor(after).maybeMostKills).toEqual(Option.some(34))
          expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(9))
        }),
      ),
  )

  it.effect('matching the most kills is no NEW BEST', () =>
    Story.story(
      APPLICATION,
      Story.given(campaignAt(9, 34)),
      fall,
      Story.model(after => {
        expect(after.runRecords).toEqual([])
      }),
    ),
  )

  it.effect('a first run sets both records without a NEW BEST', () =>
    Story.story(
      APPLICATION,
      Story.given(
        lastHeart(
          modifyFields(midRun, {
            phase: () => Phase.Wave({ wave: 5, elapsedMs: 4000, spawns: [] }),
          }),
        ),
      ),
      fall,
      Story.model(after => {
        expect(after.runRecords).toEqual([])
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
        expect(Option.isSome(bestsFor(after).maybeMostKills)).toBe(true)
      }),
    ),
  )

  test('two devices merge their records to the larger of each', () => {
    const record = (furthestWave: number | null, mostKills: number | null) => ({
      ...noSavedRunRecords,
      Hard: { furthestWave, mostKills },
    })
    expect(mergeRunRecords(record(7, 40), record(4, 95)).Hard).toEqual({
      furthestWave: 7,
      mostKills: 95,
    })
    expect(mergeRunRecords(record(null, 12), record(3, null)).Hard).toEqual({
      furthestWave: 3,
      mostKills: 12,
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
    difficulty: 'Normal' as const,
    kills: 87,
    crew: 1,
    maybeMvp: Option.none(),
    maybeOwnAward: Option.none(),
  }

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

  test('a win says the difficulty, with a zombie', () => {
    expect(
      shareText({
        ...base,
        outcome: 'Won',
        difficulty: 'Nightmare',
        kills: 612,
      }),
    ).toBe(
      '🧟 I beat Munch Manor on NIGHTMARE! 612 zombies splatted. The house is mine.',
    )
  })

  test('a crew says how many played', () => {
    expect(shareText({ ...base, outcome: 'Won', crew: 3, kills: 900 })).toBe(
      '🧟 Our crew of 3 beat Munch Manor on Normal! 900 zombies splatted together.',
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
      '🧟 Our crew of 3 beat Munch Manor on Normal! 900 zombies splatted together. 👑 MVP: ANA with 412. I was the Medic 🩹.',
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
    modifyFields(ended, {
      shareStats: () => shareStats,
      maybeVisitId: () => Option.some(VISIT_ID),
    })

  const withSheet = (ended: Model): Model =>
    modifyFields(ended, { shareSheet: () => 'Available' as const })

  const deathEvent = (path: 'Sheet' | 'Copy') =>
    SendShareEvent({
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
    Story.story(
      APPLICATION,
      Story.given(readyModel),
      Story.message(
        Message.CompletedDetectShareSheet({ shareSheet: 'Available' }),
      ),
      Story.model(after => {
        expect(after.shareSheet).toBe('Available')
      }),
    ),
  )

  // NOTE: the sheet itself opens in the click (ShareFromClick), so the tap's
  // Message only counts it.
  it.effect.each([
    ['a phone', 'Touch'],
    ['a desktop', 'KeyboardMouse'],
  ] as const)(
    'a tap on SHARE on %s with a share sheet only counts it, on the Sheet path',
    ([_name, device]) =>
      Story.story(
        APPLICATION,
        Story.given(
          modifyFields(
            withSheet(counted(onEndScreen(gameOver, doneMs('Munched')), 'On')),
            { lastDevice: () => device },
          ),
        ),
        Story.message(Message.ClickedShareButton()),
        Story.Command.expectExact(deathEvent('Sheet')),
        Story.Command.resolve(
          SendShareEvent,
          Message.CompletedSendShareEvent(),
        ),
      ),
  )

  it.effect('with no share sheet the share counts on the Copy path', () =>
    Story.story(
      APPLICATION,
      Story.given(counted(onEndScreen(gameOver, doneMs('Munched')), 'On')),
      Story.message(Message.ClickedShareButton()),
      Story.model(after => {
        expect(sharePathOf(after)).toBe('Copy')
      }),
      Story.Command.expectExact(deathEvent('Copy')),
      Story.Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
    ),
  )

  it.effect('a copied post flashes COPIED! on SHARE for a moment', () => {
    const atEnd = onEndScreen(gameOver, doneMs('Munched'))
    return Story.story(
      APPLICATION,
      Story.given(atEnd),
      Story.message(Message.SettledShare({ outcome: 'Copied' })),
      Story.Command.expectNone(),
      Story.model(after => {
        expect(after.maybeShareCopiedAtMs).toEqual(Option.some(atEnd.screenMs))
        expect(isShareCopied(after)).toBe(true)
      }),
      ...Array.makeBy(Math.ceil(SHARE_COPIED_MS / 50), () => tick(50)),
      Story.model(after => {
        expect(isShareCopied(after)).toBe(false)
      }),
    )
  })

  it.effect.each(['Shared', 'Cancelled', 'Failed'] as const)(
    'a share that ends %s leaves SHARE as it was',
    outcome =>
      Story.story(
        APPLICATION,
        Story.given(onEndScreen(gameOver, doneMs('Munched'))),
        Story.message(Message.SettledShare({ outcome })),
        Story.Command.expectNone(),
        Story.model(after => {
          expect(isShareCopied(after)).toBe(false)
        }),
      ),
  )

  it.effect('nothing is counted when play stats are off', () =>
    Story.story(
      APPLICATION,
      Story.given(counted(onEndScreen(gameOver, doneMs('Munched')), 'Off')),
      Story.message(Message.ClickedShareButton()),
      Story.Command.expectNone(),
    ),
  )

  it.effect('X is no longer a share key', () =>
    Story.story(
      APPLICATION,
      Story.given(
        withSheet(counted(onEndScreen(gameOver, RESTART_GRACE_MS * 4), 'On')),
      ),
      press('KeyX'),
      Story.Command.expectNone(),
    ),
  )

  it.effect('a crew win is counted from the co-op victory screen', () => {
    const crewed = withWorld(
      counted(onEndScreen(Phase.Victory(), doneMs('Won')), 'On'),
      world => seatCrew(world, 3),
    )
    return Story.story(
      APPLICATION,
      Story.given(crewed),
      Story.message(Message.ClickedShareButton()),
      Story.Command.expectExact(
        SendShareEvent({
          event: {
            version: 2,
            visitId: VISIT_ID,
            build: RUNNING_BUILD,
            screen: 'CoopVictory',
            mode: 'Campaign',
            difficulty: 'Normal',
            path: 'Copy',
          },
        }),
      ),
      Story.Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
    )
  })
})
