import { Array, Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { describe, expect, test } from 'vitest'

import { PARLOUR } from './arena'
import {
  FIXED_STEP_MS,
  MAX_FRAME_DELTA_MS,
  RESTART_GRACE_MS,
} from './constants'
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
} from './endBeat'
import { bestsFor, withBests } from './home'
import { update } from './main'
import { Message } from './message'
import { AudioState, type Model, Phase, RunMode } from './model'
import { readyModel } from './model.fixture'
import { seatCrew } from './party'
import { noSavedRunRecords } from './playerData'
import { mergeRunRecords } from './playerScope'
import { GAME_URL, copiedLineOf, sharePostOf, shareText } from './share'
import { press, tick, zombieOf } from './testing'
import { SendShareEvent } from './update/end'
import { PlaySound } from './update/sound'
import { RUNNING_BUILD } from './version'
import { withWorld } from './world'

const midRun: Model = modifyFields(readyModel, {
  phase: () => Phase.Wave({ wave: 4, elapsedMs: 4000, spawns: [] }),
})

// NOTE: one heart left and a zombie on the player, so the next tick bites.
const lastHeart = (base: Model): Model =>
  modifyFields(base, {
    player: player => modifyFields(player, { hp: () => 1 }),
    zombies: () => [
      zombieOf('Runner', 100, PARLOUR.width / 2 + 2, PARLOUR.height / 2),
    ],
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
  test('the last bite starts the beat: the clock from 0 and the lens', () => {
    story(
      update,
      given(lastHeart(midRun)),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(after => {
        expect(after.phase).toEqual(gameOver)
        expect(after.screenMs).toBe(0)
        expect(lensOf(after)).toEqual(Option.some({ zoom: 1, saturation: 1 }))
      }),
      ...Array.makeBy(1, () => tick(400)),
      model(after => {
        expect(after.screenMs).toBe(MAX_FRAME_DELTA_MS)
        const lens = Option.getOrThrow(lensOf(after))
        expect(lens.zoom).toBeGreaterThan(1)
        expect(lens.saturation).toBeLessThan(1)
      }),
    )
  })

  test('the stamp lands with a stomp and a shake', () => {
    const stampAtMs = TIMELINES.Munched.stampAtMs
    story(
      update,
      given(audible(onEndScreen(gameOver, stampAtMs - 10))),
      tick(20),
      model(after => {
        expect(after.shake.trauma).toBeGreaterThan(0)
      }),
      Command.expectHas(PlaySound({ sound: 'BossStomp', variation: 0 })),
      Command.resolve(
        PlaySound,
        Message.CompletedPlaySound({ sound: 'Pop', outcome: 'Played' }),
      ),
    )
  })

  test('the world stands still while the beat plays', () => {
    const zombiesAt = (current: Model) =>
      Array.map(current.zombies, zombie => [zombie.x, zombie.y])
    const fallen = update(
      lastHeart(midRun),
      Message.TickedFrame({ deltaTime: FIXED_STEP_MS }),
    ).model
    story(
      update,
      given(fallen),
      ...Array.makeBy(20, () => tick(50)),
      model(after => {
        expect(zombiesAt(after)).toEqual(zombiesAt(fallen))
        expect(after.player).toEqual(fallen.player)
        expect(after.phase).toEqual(gameOver)
      }),
    )
  })
})

describe('skipping and retrying', () => {
  test('any key in the beat skips to the finished card, and does nothing else', () => {
    story(
      update,
      given(onEndScreen(gameOver, 100)),
      press('KeyW'),
      model(after => {
        expect(after.screenMs).toBe(doneMs('Munched'))
        expect(after.phase).toEqual(gameOver)
      }),
    )
  })

  test('Enter before the restart grace only skips, so a held key never retries', () => {
    story(
      update,
      given(onEndScreen(gameOver, 100)),
      press('Enter'),
      model(after => {
        expect(after.phase).toEqual(gameOver)
        expect(after.screenMs).toBe(doneMs('Munched'))
      }),
      press('Enter'),
      model(after => {
        expect(after.phase._tag).toBe('Preparation')
      }),
    )
  })

  test('Enter after the grace retries at once, mid beat, in the run own mode', () => {
    story(
      update,
      given(
        modifyFields(
          onEndScreen(Phase.GameOver({ wave: 13 }), RESTART_GRACE_MS),
          {
            mode: () => RunMode.Endless(),
          },
        ),
      ),
      press('Enter'),
      model(after => {
        expect(after.phase._tag).toBe('Preparation')
        expect(after.mode).toEqual(RunMode.Endless())
      }),
    )
  })

  test('a tap on the game skips the beat but never starts a run', () => {
    story(
      update,
      given(onEndScreen(Phase.Victory(), 200)),
      message(
        Message.PressedPointer({
          pointerId: 1,
          device: 'Touch',
          clientX: 100,
          clientY: 100,
        }),
      ),
      model(after => {
        expect(after.screenMs).toBe(doneMs('Won'))
        expect(after.phase).toEqual(Phase.Victory())
      }),
    )
  })

  test('RETRY starts the run again', () => {
    story(
      update,
      given(onEndScreen(gameOver, doneMs('Munched'))),
      message(Message.ClickedRetryButton()),
      model(after => {
        expect(after.phase._tag).toBe('Preparation')
      }),
    )
  })
})

describe('the tally', () => {
  const tallied = modifyFields(onEndScreen(gameOver, 0), {
    bestStreak: () => 12,
    wallet: wallet => modifyFields(wallet, { earned: () => 240 }),
    stats: stats =>
      modifyFields(stats, {
        kills: kills => modifyFields(kills, { Shambler: () => 40 }),
        shotsFired: () => 100,
        shotsHit: () => 55,
      }),
  })

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

  test('falling deeper than the endless best is a NEW BEST on the wave', () => {
    story(
      update,
      given(endlessAt(12, 14)),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(after => {
        expect(after.runRecords).toEqual(['Wave'])
        expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
      }),
    )
  })

  test('falling short of it, or matching it, is no NEW BEST', () => {
    story(
      update,
      given(endlessAt(14, 14)),
      message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS })),
      model(after => {
        expect(after.runRecords).toEqual([])
      }),
    )
  })

  test('a NEW BEST bursts with its own sound as its row lands', () => {
    const best = modifyFields(
      audible(onEndScreen(Phase.GameOver({ wave: 14 }), 0)),
      {
        mode: () => RunMode.Endless(),
        runRecords: () => ['Wave' as const],
      },
    )
    const landMs = rowLandMs('Munched', 0)
    story(
      update,
      given(modifyFields(best, { screenMs: () => landMs - 5 })),
      tick(10),
      Command.expectHas(PlaySound({ sound: 'PowerUp', variation: 0 })),
      Command.resolveAll(
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

  const fall = message(Message.TickedFrame({ deltaTime: FIXED_STEP_MS }))

  test('a campaign death past the furthest wave is a NEW BEST, and is kept', () => {
    story(
      update,
      given(campaignAt(3, 100)),
      fall,
      model(after => {
        expect(after.runRecords).toEqual(['Wave'])
        expect(tallyRowsOf(after)[0]?.isBest).toBe(true)
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
        expect(bestsFor(after).maybeMostKills).toEqual(Option.some(100))
      }),
    )
  })

  test('dying on the furthest wave again is no NEW BEST', () => {
    story(
      update,
      given(campaignAt(5, 100)),
      fall,
      model(after => {
        expect(after.runRecords).toEqual([])
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
      }),
    )
  })

  test('more kills than ever in one run is a NEW BEST on SPLATTED, and is kept', () => {
    story(
      update,
      given(campaignAt(9, 20)),
      fall,
      model(after => {
        expect(after.runRecords).toEqual(['Kills'])
        expect(tallyRowsOf(after)[1]?.isBest).toBe(true)
        expect(bestsFor(after).maybeMostKills).toEqual(Option.some(34))
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(9))
      }),
    )
  })

  test('matching the most kills is no NEW BEST', () => {
    story(
      update,
      given(campaignAt(9, 34)),
      fall,
      model(after => {
        expect(after.runRecords).toEqual([])
      }),
    )
  })

  test('a first run sets both records without a NEW BEST', () => {
    story(
      update,
      given(
        lastHeart(
          modifyFields(midRun, {
            phase: () => Phase.Wave({ wave: 5, elapsedMs: 4000, spawns: [] }),
          }),
        ),
      ),
      fall,
      model(after => {
        expect(after.runRecords).toEqual([])
        expect(bestsFor(after).maybeFurthestWave).toEqual(Option.some(5))
        expect(Option.isSome(bestsFor(after).maybeMostKills)).toBe(true)
      }),
    )
  })

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

  test('the boot finds the share sheet', () => {
    story(
      update,
      given(readyModel),
      message(Message.CompletedDetectShareSheet({ shareSheet: 'Available' })),
      model(after => {
        expect(after.shareSheet).toBe('Available')
      }),
    )
  })

  // NOTE: the sheet itself opens in the click (ShareFromClick), so the tap's
  // Message only counts it.
  test.each([
    ['a phone', 'Touch'],
    ['a desktop', 'KeyboardMouse'],
  ] as const)(
    'a tap on SHARE on %s with a share sheet only counts it, on the Sheet path',
    (_name, device) => {
      story(
        update,
        given(
          modifyFields(
            withSheet(counted(onEndScreen(gameOver, doneMs('Munched')), 'On')),
            { lastDevice: () => device },
          ),
        ),
        message(Message.ClickedShareButton()),
        Command.expectExact(deathEvent('Sheet')),
        Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
      )
    },
  )

  test('with no share sheet the share counts on the Copy path', () => {
    story(
      update,
      given(counted(onEndScreen(gameOver, doneMs('Munched')), 'On')),
      message(Message.ClickedShareButton()),
      model(after => {
        expect(sharePathOf(after)).toBe('Copy')
      }),
      Command.expectExact(deathEvent('Copy')),
      Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
    )
  })

  test('a copied post flashes COPIED! on SHARE for a moment', () => {
    const atEnd = onEndScreen(gameOver, doneMs('Munched'))
    story(
      update,
      given(atEnd),
      message(Message.SettledShare({ outcome: 'Copied' })),
      Command.expectNone(),
      model(after => {
        expect(after.maybeShareCopiedAtMs).toEqual(Option.some(atEnd.screenMs))
        expect(isShareCopied(after)).toBe(true)
      }),
      ...Array.makeBy(Math.ceil(SHARE_COPIED_MS / 50), () => tick(50)),
      model(after => {
        expect(isShareCopied(after)).toBe(false)
      }),
    )
  })

  test.each(['Shared', 'Cancelled', 'Failed'] as const)(
    'a share that ends %s leaves SHARE as it was',
    outcome => {
      story(
        update,
        given(onEndScreen(gameOver, doneMs('Munched'))),
        message(Message.SettledShare({ outcome })),
        Command.expectNone(),
        model(after => {
          expect(isShareCopied(after)).toBe(false)
        }),
      )
    },
  )

  test('nothing is counted when play stats are off', () => {
    story(
      update,
      given(counted(onEndScreen(gameOver, doneMs('Munched')), 'Off')),
      message(Message.ClickedShareButton()),
      Command.expectNone(),
    )
  })

  test('X is no longer a share key', () => {
    story(
      update,
      given(
        withSheet(counted(onEndScreen(gameOver, RESTART_GRACE_MS * 4), 'On')),
      ),
      press('KeyX'),
      Command.expectNone(),
    )
  })

  test('a crew win is counted from the co-op victory screen', () => {
    const crewed = withWorld(
      counted(onEndScreen(Phase.Victory(), doneMs('Won')), 'On'),
      world => seatCrew(world, 3),
    )
    story(
      update,
      given(crewed),
      message(Message.ClickedShareButton()),
      Command.expectExact(
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
      Command.resolve(SendShareEvent, Message.CompletedSendShareEvent()),
    )
  })
})
