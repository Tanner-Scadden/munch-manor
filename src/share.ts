import { Option } from 'effect'

import { CREW_AWARD_NAMES, type CrewAward } from './names'
import type { Difficulty } from './playerData'

// Sharing a run from its end screen: the post's words and the game's link.
// Every word a shared post says lives here, so the owner can tweak the voice
// in one place. The link is the game's address and nothing else: no
// tracking parameters and no tokens.

export const GAME_URL = 'https://munchmanor.com'

// NOTE: what a post is built from: how the run ended, its wave, difficulty,
// and kills, and how many players were in it (1 alone). A crew's post
// crowns its MVP and brags about the sharer's own award, if they won one.
export type SharedRun = Readonly<{
  outcome: 'Munched' | 'Won'
  isEndless: boolean
  wave: number
  difficulty: Difficulty
  kills: number
  crew: number
  maybeMvp: Option.Option<Readonly<{ name: string; kills: number }>>
  maybeOwnAward: Option.Option<CrewAward>
}>

const SHOUTED: Readonly<Record<Difficulty, string>> = {
  Easy: 'Easy',
  Normal: 'Normal',
  Hard: 'HARD',
  Nightmare: 'NIGHTMARE',
}

const splatted = (kills: number): string =>
  kills === 1 ? '1 zombie splatted' : `${kills} zombies splatted`

const where = ({ isEndless, wave }: SharedRun): string =>
  isEndless ? `endless wave ${wave}` : `wave ${wave}`

const soloText = (run: SharedRun): string =>
  run.outcome === 'Won'
    ? `🧟 I beat Munch Manor on ${SHOUTED[run.difficulty]}! ${splatted(run.kills)}. The house is mine.`
    : `💀 Got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} first. Your turn!`

const AWARD_BRAGS: Readonly<Record<CrewAward, string>> = {
  Mvp: `I was the ${CREW_AWARD_NAMES.Mvp} 👑`,
  Medic: `I was the ${CREW_AWARD_NAMES.Medic} 🩹`,
  Sharpshooter: `I was the ${CREW_AWARD_NAMES.Sharpshooter} 🎯`,
  BigSpender: `I was the ${CREW_AWARD_NAMES.BigSpender} 💰`,
  MostMunched: `I got ${CREW_AWARD_NAMES.MostMunched} 🍖`,
}

const crewBrags = (run: SharedRun): string =>
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
  ]
    .map(brag => ` ${brag}`)
    .join('')

const crewText = (run: SharedRun): string =>
  run.outcome === 'Won'
    ? `🧟 Our crew of ${run.crew} beat Munch Manor on ${SHOUTED[run.difficulty]}! ${splatted(run.kills)} together.${crewBrags(run)}`
    : `💀 Our crew of ${run.crew} got munched on ${where(run)} in Munch Manor. ${splatted(run.kills)} together.${crewBrags(run)} Bring snacks.`

export const shareText = (run: SharedRun): string =>
  run.crew > 1 ? crewText(run) : soloText(run)

// NOTE: what the share sheet gets: the post's words and the game, apart, so
// the app the player picks lays them out itself.
export type SharePost = Readonly<{ text: string; url: string }>

export const sharePostOf = (run: SharedRun): SharePost => ({
  text: shareText(run),
  url: GAME_URL,
})

// NOTE: what the clipboard gets where there is no share sheet: the words,
// then the link.
export const copiedLineOf = ({ text, url }: SharePost): string =>
  `${text} ${url}`
