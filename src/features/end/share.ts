import { Array, Option, Schema } from 'effect'

import type { Difficulty } from '#shared/playerData.ts'
import type { DareKind } from '#world/dare/dareSchema.ts'
import { CREW_AWARD_NAMES, type CrewAward, DARE_NAMES } from '#world/names.ts'

export const ShareSheet = Schema.Literals(['Available', 'Unavailable'])
export type ShareSheet = typeof ShareSheet.Type

export const ShareOutcome = Schema.Literals([
  'Shared',
  'Cancelled',
  'Copied',
  'Failed',
])
export type ShareOutcome = typeof ShareOutcome.Type

export const GAME_URL = 'https://munchmanor.com'

export type SharedRun = Readonly<{
  outcome: 'Munched' | 'Chicken' | 'Won'
  things: ReadonlyArray<DareKind>
  isEndless: boolean
  wave: number
  difficulty: Difficulty
  kills: number
  crew: number
  maybeMvp: Option.Option<Readonly<{ name: string; kills: number }>>
  maybeOwnAward: Option.Option<CrewAward>
}>

const SHOUTED: Readonly<Record<Difficulty, string>> = {
  Easy: 'Dare',
  Normal: 'Double Dare',
  Hard: 'TRIPLE DARE',
  Nightmare: 'TRIPLE DOG DARE',
}

const splatted = (kills: number): string =>
  kills === 1 ? '1 zombie splatted' : `${kills} zombies splatted`

const where = ({ isEndless, wave }: SharedRun): string =>
  isEndless ? `endless wave ${wave}` : `wave ${wave}`

const haul = (things: ReadonlyArray<DareKind>): string => {
  const named = Array.map(things, thing => `the ${DARE_NAMES[thing]}`)
  return named.length <= 2
    ? Option.getOrElse(
        Option.liftPredicate(Array.join(named, ' and '), line => line !== ''),
        () => 'nothing',
      )
    : `${Array.join(Array.dropRight(named, 1), ', ')}, and ${Array.join(Array.takeRight(named, 1), '')}`
}

const SOLO_TEXT: Readonly<
  Record<SharedRun['outcome'], (run: SharedRun) => string>
> = {
  Won: run =>
    `🗝️ I beat Uncle Chunk and escaped Munch Manor on ${SHOUTED[run.difficulty]}! Out on wave ${run.wave}, ${splatted(run.kills)}.`,
  Chicken: run =>
    `🐔 I chickened out of Munch Manor with ${haul(run.things)} on wave ${run.wave}. ${splatted(run.kills)} first. Braver than me?`,
  Munched: run =>
    `💀 Got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} first. Your turn!`,
}

const soloText = (run: SharedRun): string => SOLO_TEXT[run.outcome](run)

const AWARD_BRAGS: Readonly<Record<CrewAward, string>> = {
  Mvp: `I was the ${CREW_AWARD_NAMES.Mvp} 👑`,
  Medic: `I was the ${CREW_AWARD_NAMES.Medic} 🩹`,
  Sharpshooter: `I was the ${CREW_AWARD_NAMES.Sharpshooter} 🎯`,
  KeyKeeper: `I was the ${CREW_AWARD_NAMES.KeyKeeper} 💰`,
  MostMunched: `I got ${CREW_AWARD_NAMES.MostMunched} 🍖`,
}

const crewBrags = (run: SharedRun): string =>
  Array.join(
    Array.map(
      [
        ...Option.match(run.maybeMvp, {
          onNone: () => [],
          onSome: ({ name, kills }) => [
            `👑 ${CREW_AWARD_NAMES.Mvp}: ${name} with ${kills}.`,
          ],
        }),
        ...Option.match(run.maybeOwnAward, {
          onNone: () => [],
          onSome: award => [`${AWARD_BRAGS[award]}.`],
        }),
      ],
      brag => ` ${brag}`,
    ),
    '',
  )

const CREW_TEXT: Readonly<
  Record<SharedRun['outcome'], (run: SharedRun) => string>
> = {
  Won: run =>
    `🗝️ Our crew of ${run.crew} beat Uncle Chunk and escaped Munch Manor on ${SHOUTED[run.difficulty]}! Out on wave ${run.wave}, ${splatted(run.kills)} together.${crewBrags(run)}`,
  Chicken: run =>
    `🐔 Our crew of ${run.crew} chickened out of Munch Manor with ${haul(run.things)} on wave ${run.wave}. ${splatted(run.kills)} together.${crewBrags(run)} Next time, the front door.`,
  Munched: run =>
    `💀 Our crew of ${run.crew} got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} together.${crewBrags(run)} Bring snacks.`,
}

const crewText = (run: SharedRun): string => CREW_TEXT[run.outcome](run)

export const shareText = (run: SharedRun): string =>
  run.crew > 1 ? crewText(run) : soloText(run)

export type SharePost = Readonly<{ text: string; url: string }>

export const sharePostOf = (run: SharedRun): SharePost => ({
  text: shareText(run),
  url: GAME_URL,
})

export const copiedLineOf = ({ text, url }: SharePost): string =>
  `${text} ${url}`

export const SHARE_TEXT_DATA = 'share-text'
export const SHARE_URL_DATA = 'share-url'
