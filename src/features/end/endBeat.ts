import { Array, Function, Option, Schema, String } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'

import {
  type DifficultyBests,
  type Model,
  Phase,
  RunMode,
  type RunRecord,
} from '../../app/model'
import type { SoundEffect } from '../../audio/audio'
import type { SharePath } from '../../platform/analytics'
import { isObjectFirst, isObjectSecond } from '../../shared/dualArgs'
import { Calling, CosmeticKind, type Difficulty } from '../../shared/playerData'
import { callingsOpenedBy } from '../../world/heroes/calling'
import { isRankUp, rankOf } from '../../world/heroes/rank'
import { focusOf, isCoop, leadSeatOf } from '../../world/party/party'
import { accuracyPercent, totalKills } from '../../world/run/stats'
import { roundWave } from '../../world/waves/waves'
import { isBotCrew } from '../bots/bots'
import { isEndScreen, withBests } from '../home/home'
import { giftsOpenedBy } from '../profile/blocks/look/closet'
import { awardsOf, crewOf, hasAwards, mvpOf } from './crewAwards'
import type { SharedRun } from './share'
import type { TallyIcon } from './tallyIcons'

// The end of a run as a short beat, read from the end screen's own clock
// (`screenMs`, from 0 when the round ends), so it is a pure function of the
// Model and never touches the World. A loss: a red flash, the player
// topples, the camera punches in as the color drains, MUNCHED! stamps down,
// and the card tallies the run row by row. A win: the camera eases in,
// confetti falls, YOU SURVIVED! stamps, the trophy drops with the skulls of
// the difficulty, and the same tally. Any press skips to the finished card.

export type EndKind = 'Munched' | 'Won'

export const endKindOf = (model: Model): Option.Option<EndKind> =>
  Phase.match(model.phase, {
    Ready: () => Option.none(),
    Preparation: () => Option.none(),
    Wave: () => Option.none(),
    Paused: () => Option.none(),
    Victory: () => Option.some<EndKind>('Won'),
    GameOver: () => Option.some<EndKind>('Munched'),
  })

// TIMELINE

export const FLASH_MS = 220
export const FALL_START_MS = 100
export const FALL_MS = 420
const LENS_MS = 700
export const STAMP_MS = 140
export const TROPHY_DROP_MS = 380
const SKULL_GAP_MS = 110
const ROW_MS = 200
const ROW_GAP_MS = 60
export const BEST_POP_MS = 260

type Timeline = Readonly<{
  stampAtMs: number
  trophyAtMs: number
  cardAtMs: number
  zoom: number
  saturation: number
}>

export const TIMELINES: Readonly<Record<EndKind, Timeline>> = {
  Munched: {
    stampAtMs: 620,
    trophyAtMs: Number.POSITIVE_INFINITY,
    cardAtMs: 950,
    zoom: 1.3,
    saturation: 0.2,
  },
  Won: {
    stampAtMs: 250,
    trophyAtMs: 420,
    cardAtMs: 950,
    zoom: 1.12,
    saturation: 1,
  },
}

export const progressOf: {
  (startMs: number, spanMs: number): (ms: number) => number
  (ms: number, startMs: number, spanMs: number): number
} = Function.dual(3, (ms: number, startMs: number, spanMs: number): number =>
  Math.min(1, Math.max(0, (ms - startMs) / spanMs)),
)

export const easeOut = (t: number): number => 1 - (1 - t) ** 3

// NOTE: overshoots a little and settles, for the stamp and the trophy.
export const easeOutBack = (t: number): number => {
  const overshoot = 1.7
  return 1 + (overshoot + 1) * (t - 1) ** 3 + overshoot * (t - 1) ** 2
}

// TALLY

export type TallyRow = Readonly<{
  icon: TallyIcon
  label: string
  value: number
  // NOTE: the shown value, from the counted-up number.
  format: (shown: number) => string
  isBest: boolean
}>

const SECONDS_PER_MINUTE = 60
const MS_PER_SECOND = 1000

const clockLabel = (ms: number): string => {
  const total = Math.floor(ms / MS_PER_SECOND)
  return `${Math.floor(total / SECONDS_PER_MINUTE)}:${String.padStart(2, '0')(globalThis.String(total % SECONDS_PER_MINUTE))}`
}

export const plain = (shown: number): string => `${shown}`

const isRecord = (model: Model, record: RunRecord): boolean =>
  Array.contains(model.runRecords, record)

const firstRow = (model: Model, kind: EndKind): TallyRow =>
  kind === 'Won'
    ? {
        icon: 'Time',
        label: 'TIME',
        value: Math.round(model.stats.runMs),
        format: clockLabel,
        isBest: isRecord(model, 'Time'),
      }
    : {
        icon: 'Wave',
        label: 'WAVE',
        value: roundWave(model.phase),
        format: RunMode.match(model.mode, {
          Campaign: () => (shown: number) => `${shown}/10`,
          Endless: () => plain,
        }),
        isBest: isRecord(model, 'Wave'),
      }

export const tallyRowsOf = (model: Model): ReadonlyArray<TallyRow> =>
  Option.match(endKindOf(model), {
    onNone: () => [],
    onSome: kind => [
      firstRow(model, kind),
      {
        icon: 'Kills',
        label: 'SPLATTED',
        value: totalKills(model.stats),
        format: plain,
        isBest: isRecord(model, 'Kills'),
      },
      {
        icon: 'Streak',
        label: 'STREAK',
        value: model.bestStreak,
        format: plain,
        isBest: false,
      },
      {
        icon: 'Aim',
        label: 'AIM',
        value: accuracyPercent(model.stats),
        format: shown => `${shown}%`,
        isBest: false,
      },
      {
        icon: 'Cash',
        label: 'CASH',
        value: focusOf(model).wallet.earned,
        format: shown => `$${shown}`,
        isBest: false,
      },
    ],
  })

export const rowStartMs: {
  (index: number): (kind: EndKind) => number
  (kind: EndKind, index: number): number
} = Function.dual(
  2,
  (kind: EndKind, index: number): number =>
    TIMELINES[kind].cardAtMs + ROW_GAP_MS + index * (ROW_MS + ROW_GAP_MS),
)

export const rowLandMs: {
  (index: number): (kind: EndKind) => number
  (kind: EndKind, index: number): number
} = Function.dual(
  2,
  (kind: EndKind, index: number): number => rowStartMs(kind, index) + ROW_MS,
)

// NOTE: a row counts up from 0 to its value over ROW_MS once its turn
// comes, eased so the last digits tick slower.
export const countedUp: {
  (kind: EndKind, index: number, screenMs: number): (value: number) => number
  (value: number, kind: EndKind, index: number, screenMs: number): number
} = Function.dual(
  4,
  (value: number, kind: EndKind, index: number, screenMs: number): number =>
    Math.round(
      value * easeOut(progressOf(screenMs, rowStartMs(kind, index), ROW_MS)),
    ),
)

export const shownValue: {
  (kind: EndKind, index: number, screenMs: number): (row: TallyRow) => number
  (row: TallyRow, kind: EndKind, index: number, screenMs: number): number
} = Function.dual(
  4,
  (row: TallyRow, kind: EndKind, index: number, screenMs: number): number =>
    countedUp(row.value, kind, index, screenMs),
)

const ROWS = 5

// NOTE: the beat is done once the last row has landed and a NEW BEST has
// burst. A press before then skips to here.
export const doneMs = (kind: EndKind): number =>
  rowLandMs(kind, ROWS - 1) + BEST_POP_MS

// NOTE: a crew's card (src/features/end/crewBoardView.ts) counts up the run's line and
// then each of the crew board's stat rows, every player's column at once,
// and then stamps the awards.
const CREW_ROWS = 6
const AWARD_GAP_MS = 120
export const AWARD_STAMP_MS = 260

export const awardsAtMs = (kind: EndKind): number =>
  rowLandMs(kind, CREW_ROWS - 1) + AWARD_GAP_MS

export const crewDoneMs = (kind: EndKind): number =>
  awardsAtMs(kind) + AWARD_STAMP_MS

// RANK STRIP

// NOTE: after the tally (or, for a crew, the awards) the rank strip fills
// its bar from the points before the run to the points after, counts the
// Bones, and, on a rank up, pops the badge with a fanfare. A run that paid
// no rank (the practice gate) has no strip.
const RANK_GAP_MS = 140
export const RANK_FILL_MS = 800
export const RANK_POP_MS = 360

export const hasRankStrip = (model: Model): boolean =>
  Option.isSome(model.maybeRankGain)

export const rankStripAtMs: {
  (kind: EndKind): (model: Model) => number
  (model: Model, kind: EndKind): number
} = Function.dual(
  2,
  (model: Model, kind: EndKind): number =>
    (isCoop(model) ? crewDoneMs(kind) : doneMs(kind)) + RANK_GAP_MS,
)

export const isRankedUp = (model: Model): boolean =>
  Option.exists(model.maybeRankGain, ({ pointsBefore, gained }) =>
    isRankUp(pointsBefore, gained),
  )

// NOTE: a rank up that opens a calling or a gift look flips a card for each
// after the badge pops: the callings first, then the gifts by rank, one card at a
// time, each held a moment before the next flips over it. The last stays.
export const CALLING_FLIP_MS = 420
export const UNLOCK_HOLD_MS = 500

export const EndUnlock = defineTaggedUnion({
  Calling: { calling: Calling },
  Gift: { kind: CosmeticKind, name: Schema.String },
})
export type EndUnlock = typeof EndUnlock.Type

export const unlocksOf = (model: Model): ReadonlyArray<EndUnlock> =>
  Option.match(model.maybeRankGain, {
    onNone: () => [],
    onSome: ({ pointsBefore, gained }) => {
      const before = rankOf(pointsBefore)
      const after = rankOf(pointsBefore + gained)
      return [
        ...Array.map(callingsOpenedBy(before, after), calling =>
          EndUnlock.Calling({ calling }),
        ),
        ...Array.map(giftsOpenedBy(before, after), ({ kind, name }) =>
          EndUnlock.Gift({ kind, name }),
        ),
      ]
    },
  })

// NOTE: how long after the badge pops card number `index` starts to flip.
export const unlockStartMs = (index: number): number =>
  index * (CALLING_FLIP_MS + UNLOCK_HOLD_MS)

// NOTE: when the first unlock card starts to flip: once the bar is full and
// the badge has popped.
export const unlockFlipAtMs: {
  (kind: EndKind): (model: Model) => number
  (model: Model, kind: EndKind): number
} = Function.dual(
  2,
  (model: Model, kind: EndKind): number =>
    rankStripAtMs(model, kind) +
    RANK_FILL_MS +
    (isRankedUp(model) ? RANK_POP_MS : 0),
)

const unlockDurationMs = (count: number): number =>
  count === 0 ? 0 : unlockStartMs(count - 1) + CALLING_FLIP_MS

export const rankDoneMs: {
  (kind: EndKind): (model: Model) => number
  (model: Model, kind: EndKind): number
} = Function.dual(
  2,
  (model: Model, kind: EndKind): number =>
    unlockFlipAtMs(model, kind) + unlockDurationMs(unlocksOf(model).length),
)

// NOTE: the last unlock card stays a few seconds after it flips, its timer
// draining along its foot, then fades away; a tap puts it away sooner.
export const UNLOCK_LINGER_MS = 4000
export const UNLOCK_FADE_MS = 300

export const unlockGoneMs: {
  (kind: EndKind): (model: Model) => number
  (model: Model, kind: EndKind): number
} = Function.dual(
  2,
  (model: Model, kind: EndKind): number =>
    rankDoneMs(model, kind) + UNLOCK_LINGER_MS,
)

const isUnlockCardUp = (model: Model, kind: EndKind): boolean =>
  Array.isReadonlyArrayNonEmpty(unlocksOf(model)) &&
  model.screenMs < unlockGoneMs(model, kind)

// NOTE: a tap once the beat is over puts away an unlock card still up, by
// moving the end clock past its time, so nothing new needs to be stored.
export const dismissUnlock = (model: Model): Model =>
  Option.match(endKindOf(model), {
    onNone: () => model,
    onSome: kind =>
      model.screenMs >= rankDoneMs(model, kind) && isUnlockCardUp(model, kind)
        ? modifyFields(model, { screenMs: () => unlockGoneMs(model, kind) })
        : model,
  })

const beatDoneMs = (model: Model, kind: EndKind): number =>
  hasRankStrip(model)
    ? rankDoneMs(model, kind)
    : isCoop(model)
      ? crewDoneMs(kind)
      : doneMs(kind)

export const isBeatOver = (model: Model): boolean =>
  Option.match(endKindOf(model), {
    onNone: () => true,
    onSome: kind => model.screenMs >= beatDoneMs(model, kind),
  })

export const skipBeat = (model: Model): Model =>
  Option.match(endKindOf(model), {
    onNone: () => model,
    onSome: kind => {
      const atMs = beatDoneMs(model, kind)
      return model.screenMs >= atMs
        ? model
        : modifyFields(model, { screenMs: () => atMs })
    },
  })

// SOUNDS

const crossed = (fromMs: number, toMs: number, atMs: number): boolean =>
  fromMs < atMs && toMs >= atMs

// NOTE: the beat's sounds, for the frame that moves the clock from `fromMs`
// to `toMs`: the stamp, the trophy, each skull, each row as it lands, and a
// NEW BEST once its row lands.
export const beatSounds: {
  (fromMs: number, toMs: number): (model: Model) => ReadonlyArray<SoundEffect>
  (model: Model, fromMs: number, toMs: number): ReadonlyArray<SoundEffect>
} = Function.dual(
  3,
  (model: Model, fromMs: number, toMs: number): ReadonlyArray<SoundEffect> =>
    Option.match(endKindOf(model), {
      onNone: () => [],
      onSome: kind => {
        const timeline = TIMELINES[kind]
        const isCrew = isCoop(model)
        const rows = tallyRowsOf(model)
        const landings = isCrew
          ? Array.range(0, CREW_ROWS - 1)
          : Array.map(rows, (_, index) => index)
        const isPast = (atMs: number): boolean => crossed(fromMs, toMs, atMs)
        const skulls = Array.range(0, skullCountOf(model.difficulty.chosen) - 1)
        return [
          ...soundWhen(
            isPast(timeline.stampAtMs),
            kind === 'Munched' ? 'BossStomp' : 'Thud',
          ),
          ...soundWhen(isPast(timeline.trophyAtMs + TROPHY_DROP_MS), 'Clang'),
          ...soundWhen(
            kind === 'Won' &&
              Array.some(skulls, index => isPast(skullAtMs(index))),
            'Pop',
          ),
          ...soundWhen(
            Array.some(landings, index => isPast(rowLandMs(kind, index))),
            'Pop',
          ),
          ...soundWhen(
            !isCrew &&
              Array.some(
                rows,
                (row, index) => row.isBest && isPast(rowLandMs(kind, index)),
              ),
            'PowerUp',
          ),
          ...soundWhen(
            isCrew && isPast(awardsAtMs(kind)) && hasAwards(crewOf(model)),
            'PowerUp',
          ),
          ...soundWhen(
            hasRankStrip(model) && isPast(rankStripAtMs(model, kind)),
            'Pop',
          ),
          ...soundWhen(
            isRankedUp(model) &&
              isPast(rankStripAtMs(model, kind) + RANK_FILL_MS),
            'RankUp',
          ),
          ...soundWhen(
            Array.some(unlocksOf(model), (_, index) =>
              isPast(unlockFlipAtMs(model, kind) + unlockStartMs(index)),
            ),
            'LootPop',
          ),
        ]
      },
    }),
)

const soundWhen = (
  isOn: boolean,
  sound: SoundEffect,
): ReadonlyArray<SoundEffect> => (isOn ? [sound] : [])

// SKULLS

const SKULLS: Readonly<Record<Difficulty, number>> = {
  Easy: 1,
  Normal: 2,
  Hard: 3,
  Nightmare: 4,
}

export const skullCountOf = (difficulty: Difficulty): number =>
  SKULLS[difficulty]

export const skullAtMs = (index: number): number =>
  TIMELINES.Won.trophyAtMs + TROPHY_DROP_MS + index * SKULL_GAP_MS

// RECORDS

// NOTE: the records a run just broke, read on the frame it ends: the bests
// before it (`before`) against the run. Only a record that stood falls; a
// first win or a first endless run sets one without a NEW BEST.
const recordsBroken = (
  before: Model,
  after: Model,
  played: Difficulty = after.difficulty.chosen,
): ReadonlyArray<RunRecord> => {
  const bests = before.bests.byDifficulty[played]
  return Phase.match(after.phase, {
    Ready: (): ReadonlyArray<RunRecord> => [],
    Preparation: (): ReadonlyArray<RunRecord> => [],
    Wave: (): ReadonlyArray<RunRecord> => [],
    Paused: (): ReadonlyArray<RunRecord> => [],
    Victory: (): ReadonlyArray<RunRecord> => [
      ...recordWhen(
        Option.exists(
          bests.maybeFastestWinMs,
          fastest => after.stats.runMs < fastest,
        ),
        'Time',
      ),
      ...killsRecord(bests, after),
    ],
    GameOver: ({ wave }): ReadonlyArray<RunRecord> => [
      ...recordWhen(
        Option.exists(
          RunMode.isAnyOf(['Endless'])(after.mode)
            ? bests.maybeBestEndlessWave
            : bests.maybeFurthestWave,
          best => wave > best,
        ),
        'Wave',
      ),
      ...killsRecord(bests, after),
    ],
  })
}

const recordWhen = (
  isBroken: boolean,
  record: RunRecord,
): ReadonlyArray<RunRecord> => (isBroken ? [record] : [])

const killsRecord = (
  bests: DifficultyBests,
  after: Model,
): ReadonlyArray<RunRecord> =>
  recordWhen(
    Option.exists(bests.maybeMostKills, most => totalKills(after.stats) > most),
    'Kills',
  )

const higher = (maybeBest: Option.Option<number>, reached: number) =>
  Option.some(
    Option.match(maybeBest, {
      onNone: () => reached,
      onSome: best => Math.max(best, reached),
    }),
  )

// NOTE: the run records a finished run sets, on the frame it ends: the
// most kills in a run, and in the campaign the furthest wave reached (a win
// reaches the last wave). Endless keeps its own deepest wave in the bests.
export const reachRecords: {
  (after: Model, played?: Difficulty): (before: Model) => Model
  (before: Model, after: Model, played?: Difficulty): Model
} = Function.dual(
  isObjectSecond,
  (
    before: Model,
    after: Model,
    played: Difficulty = after.difficulty.chosen,
  ): Model =>
    !isEndScreen(before.phase) && isEndScreen(after.phase)
      ? withBests(
          after,
          bests =>
            modifyFields(bests, {
              maybeMostKills: maybeMost =>
                higher(maybeMost, totalKills(after.stats)),
              maybeFurthestWave: maybeFurthest =>
                RunMode.isAnyOf(['Campaign'])(after.mode)
                  ? higher(maybeFurthest, roundWave(after.phase))
                  : maybeFurthest,
            }),
          played,
        )
      : after,
)

export const noteRecords: {
  (after: Model, played?: Difficulty): (before: Model) => Model
  (before: Model, after: Model, played?: Difficulty): Model
} = Function.dual(
  isObjectSecond,
  (
    before: Model,
    after: Model,
    played: Difficulty = after.difficulty.chosen,
  ): Model =>
    !isEndScreen(before.phase) && isEndScreen(after.phase)
      ? modifyFields(after, {
          runRecords: () => recordsBroken(before, after, played),
        })
      : after,
)

// SHARING

// NOTE: a browser with a share sheet shares through it, on any device; one
// without copies the post (ShareFromClick in src/app/mount.ts decides the same
// way at the tap).
export const sharePathOf = (model: Model): SharePath =>
  model.shareSheet === 'Available' ? 'Sheet' : 'Copy'

// NOTE: how long SHARE says COPIED! after the post goes to the clipboard.
export const SHARE_COPIED_MS = 1500

export const isShareCopied = (model: Model): boolean =>
  Option.match(model.maybeShareCopiedAtMs, {
    onNone: () => false,
    onSome: atMs =>
      model.screenMs >= atMs && model.screenMs - atMs < SHARE_COPIED_MS,
  })

// NOTE: `played` is the run's difficulty: the player's own, or in an online
// co-op run the room's.
export const sharedRunOf: {
  (played?: Difficulty): (model: Model) => SharedRun
  (model: Model, played?: Difficulty): SharedRun
} = Function.dual(
  isObjectFirst,
  (model: Model, played: Difficulty = model.difficulty.chosen): SharedRun => ({
    outcome: Option.getOrElse(endKindOf(model), (): EndKind => 'Munched'),
    isEndless: RunMode.isAnyOf(['Endless'])(model.mode),
    wave: roundWave(model.phase),
    difficulty: played,
    kills: totalKills(model.stats),
    // NOTE: bots are not a crew to boast of: a run with them posts as one
    // player's run.
    crew: isBotCrew(model) ? 1 : Math.max(1, crewOf(model).length),
    ...(isBotCrew(model)
      ? { maybeMvp: Option.none(), maybeOwnAward: Option.none() }
      : crewBragsOf(model)),
  }),
)

// NOTE: the MVP, and the sharer's own first award but MVP, which the MVP's
// line already names.
const crewBragsOf = (
  model: Model,
): Pick<SharedRun, 'maybeMvp' | 'maybeOwnAward'> => {
  const crew = crewOf(model)
  return {
    maybeMvp: Option.flatMap(mvpOf(crew), slot =>
      Option.map(
        Array.findFirst(crew, member => member.slot === slot),
        ({ name, kills }) => ({ name, kills }),
      ),
    ),
    maybeOwnAward: Array.findFirst(
      awardsOf(crew, leadSeatOf(model).slot),
      award => award !== 'Mvp',
    ),
  }
}

// THE LENS

export type Lens = Readonly<{ zoom: number; saturation: number }>

const SATURATION_MS = 800

// NOTE: the camera punches in toward the player as the round ends, and on
// a loss the color drains from the world. The card and HUD stay sharp.
export const lensOf = (model: Model): Option.Option<Lens> =>
  Option.map(endKindOf(model), kind => {
    const timeline = TIMELINES[kind]
    return {
      zoom:
        1 +
        (timeline.zoom - 1) * easeOut(progressOf(model.screenMs, 0, LENS_MS)),
      saturation:
        1 -
        (1 - timeline.saturation) *
          easeOut(progressOf(model.screenMs, 0, SATURATION_MS)),
    }
  })

// AN ONLINE ROOM

// NOTE: in an online co-op run the room is back in its lobby as soon as the
// run ends, so the lobby waits behind the end card until the player picks:
// RUN IT BACK readies them from the card, LOBBY lets the lobby in, and
// LEAVE leaves the room. The card holds until then, so its buttons never
// vanish under a finger; a next run started from it ends it too.
export const isRunCardHeld = (model: Model): boolean =>
  Option.isSome(endKindOf(model)) && !model.isRunCardDropped

// NOTE: LOBBY lets the lobby in, beat or no beat.
export const dropRunCard = (model: Model): Model =>
  modifyFields(model, { isRunCardDropped: () => true })
