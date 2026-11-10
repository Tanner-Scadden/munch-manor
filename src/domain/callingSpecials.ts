import { Array } from 'effect'

import { QUIRK_ICONS } from '../art/callingArt'
import type { Calling } from '../shared/playerData'
import {
  isPistolBarred,
  keyScaleOf,
  magazineFor,
  maxHpOf,
  mendSpeedScaleOf,
  speedScaleOf,
  startsWithCooker,
  stoveKillsFor,
  trapHealthScaleOf,
  woundGraceScaleOf,
} from '../world/heroes/calling'
import { SPECIAL_LINES } from '../world/names'

// What each hero does, as short lines for the picker's cards and the
// words a screen reader gets. Every number is read off the rules in
// src/world/heroes/calling.ts, never copied, so a balance change moves the text too.

export type Special = Readonly<{
  isPerk: boolean
  art: string
  line: string
}>

const perk = (art: string, line: string): Special => ({
  isPerk: true,
  art,
  line,
})

const drawback = (art: string, line: string): Special => ({
  isPerk: false,
  art,
  line,
})

// NOTE: a share of 100 the rules took off or added, as a whole percent.
const percentLess = (of100: number): number => 100 - of100
const percentMore = (of100: number): number => of100 - 100

const wearer = (calling: Calling) => ({ calling })

const SPECIALS: Readonly<Record<Calling, ReadonlyArray<Special>>> = {
  You: [],
  Handyman: [
    perk(
      QUIRK_ICONS.Plank,
      SPECIAL_LINES.sturdierTraps(
        percentMore(Math.round(trapHealthScaleOf(wearer('Handyman')) * 100)),
      ),
    ),
    perk(
      QUIRK_ICONS.Plank,
      SPECIAL_LINES.fasterMends(mendSpeedScaleOf(wearer('Handyman'))),
    ),
    perk(
      QUIRK_ICONS.Shield,
      SPECIAL_LINES.longerBlink(
        percentMore(Math.round(woundGraceScaleOf(wearer('Handyman')) * 100)),
      ),
    ),
    drawback(
      QUIRK_ICONS.Heart,
      SPECIAL_LINES.maxHearts(maxHpOf(wearer('Handyman'))),
    ),
  ],
  TrackStar: [
    perk(
      QUIRK_ICONS.Shoe,
      SPECIAL_LINES.fasterRuns(
        percentMore(Math.round(speedScaleOf(wearer('TrackStar')) * 100)),
      ),
    ),
    drawback(
      QUIRK_ICONS.Magazine,
      SPECIAL_LINES.smallerMagazines(
        percentLess(magazineFor('TrackStar', 100)),
      ),
    ),
  ],
  PennyPincher: [
    perk(
      QUIRK_ICONS.Key,
      SPECIAL_LINES.moreKeys(
        percentMore(Math.round(keyScaleOf(wearer('PennyPincher')) * 100)),
      ),
    ),
    drawback(
      QUIRK_ICONS.Heart,
      SPECIAL_LINES.maxHearts(maxHpOf(wearer('PennyPincher'))),
    ),
  ],
  LineCook: [
    ...(startsWithCooker('LineCook')
      ? [perk(QUIRK_ICONS.Pot, SPECIAL_LINES.startsWithCooker)]
      : []),
    perk(
      QUIRK_ICONS.Tag,
      SPECIAL_LINES.stoveFewerKills(
        percentLess(stoveKillsFor('LineCook', 100)),
      ),
    ),
    ...(isPistolBarred('LineCook')
      ? [drawback(QUIRK_ICONS.NoPistol, SPECIAL_LINES.noPistol)]
      : []),
  ],
}

export const specialsOf = (calling: Calling): ReadonlyArray<Special> =>
  SPECIALS[calling]

// NOTE: the specials as one sentence for a screen reader: each line says
// whether it helps or costs.
export const specialsNoteOf = (calling: Calling): string =>
  Array.isReadonlyArrayEmpty(SPECIALS[calling])
    ? SPECIAL_LINES.noSpecials
    : Array.join(
        Array.map(
          SPECIALS[calling],
          ({ isPerk, line }) => `${isPerk ? 'Plus' : 'Minus'}: ${line}`,
        ),
        '. ',
      )
