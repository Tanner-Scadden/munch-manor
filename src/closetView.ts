import { Array, Option, Record } from 'effect'
import type { Html } from 'foldkit/html'

import { closetRows, playerPalette } from './appearance'
import {
  CLOSET_HATS,
  type HatStanding,
  type RealHat,
  closetCardId,
  hatSourceOf,
  hatStandingOf,
  steppedHat,
} from './closet'
import type { ApplicationViewBuilder } from './composition'
import { CHECK_ICON, PADLOCK_ICON, pixelIconUrl } from './icons'
import { iconView } from './menuParts'
import { Message } from './message'
import type { Model } from './model'
import { HAT_NAMES } from './names'
import type { Appearance } from './playerData'
import { bonesBalanceOf, rankOf, totalPointsOf } from './rank'
import { boneCountView, rankMarkView } from './rankBadgeView'
import { isPortrait } from './screen'

// The closet tab in the Profile: the Bones balance, then a card for every
// hat, each the player's own figure wearing it. A worn hat is checked, an
// owned one waits to be put on, one for sale shows its price in Bones, and a
// gift not reached yet is a dark shape with a padlock and the rank that
// opens it. Pictures and numbers only: a hat's name shows on focus and is
// read aloud.

const LANDSCAPE_COLUMNS = 8
const PORTRAIT_COLUMNS = 4

// NOTE: each look's card picture is drawn once. The cache is emptied when it
// grows past a few hundred, as the dice can try a great many looks.
const PICTURE_CACHE_LIMIT = 400

const pictures = new Map<string, string>()

const pictureOf = (look: Appearance, hat: RealHat): string => {
  const wearing: Appearance = { ...look, hat }
  const key = [
    look.body,
    look.hairStyle,
    look.hairColor,
    look.skinTone,
    look.shirtColor,
    look.outfit,
    look.print,
    look.beard,
    look.glasses,
    hat,
  ].join('.')
  return Option.getOrElse(Option.fromNullishOr(pictures.get(key)), () => {
    const url = pixelIconUrl(closetRows(wearing), playerPalette(wearing))
    if (pictures.size >= PICTURE_CACHE_LIMIT) {
      pictures.clear()
    }
    pictures.set(key, url)
    return url
  })
}

// KEYS

// NOTE: left and right walk the cards one by one, up and down a row of the
// grid, all wrapping.
const stepOfKey = (columns: number): Readonly<Record<string, number>> => ({
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -columns,
  ArrowDown: columns,
})

const keyMessage = (
  columns: number,
  hat: RealHat,
  key: string,
): Option.Option<Message> =>
  Option.flatMap(Record.get(stepOfKey(columns), key), step =>
    Option.map(steppedHat(hat, step), next =>
      Message.SteppedClosetFocus({ hat: next }),
    ),
  )

// CARDS

const STANDING_NOTES: Readonly<Record<HatStanding, string>> = {
  Worn: 'worn, tap to take off',
  Owned: 'tap to wear',
  ForSale: 'for sale',
  Locked: 'locked',
}

const ariaLabelOf = (hat: RealHat, standing: HatStanding): string => {
  const source = hatSourceOf(hat)
  const detail =
    standing === 'ForSale' && source.kind === 'Sold'
      ? `${source.price} Bones`
      : standing === 'Locked' && source.kind === 'Gift'
        ? `reach rank ${source.rank}`
        : STANDING_NOTES[standing]
  return `${HAT_NAMES[hat]}, ${detail}`
}

const tagView = (
  hat: RealHat,
  standing: HatStanding,
  h: ApplicationViewBuilder,
): Html => {
  const source = hatSourceOf(hat)
  return standing === 'Worn'
    ? iconView('closet-check', CHECK_ICON, h)
    : standing === 'ForSale' && source.kind === 'Sold'
      ? boneCountView(source.price, 'closet-price', h)
      : standing === 'Locked' && source.kind === 'Gift'
        ? h.span(
            [h.Class('closet-need'), h.AriaHidden(true)],
            [
              iconView('closet-lock-icon', PADLOCK_ICON, h),
              rankMarkView(source.rank, h),
            ],
          )
        : h.span([h.Class('closet-tag-blank'), h.AriaHidden(true)])
}

const cardView = (
  model: Model,
  hat: RealHat,
  columns: number,
  h: ApplicationViewBuilder,
): Html => {
  const standing = hatStandingOf(
    hat,
    model.appearance.hat,
    model.boughtHats,
    rankOf(totalPointsOf(model.rank)),
  )
  const { closetCue } = model.profile
  const isCued = closetCue.hat === hat && closetCue.kind !== 'Still'
  return h.button(
    [
      h.Id(closetCardId(hat)),
      h.Type('button'),
      h.Class('closet-card'),
      h.DataAttribute('hat', hat),
      h.DataAttribute('standing', standing),
      ...(isCued
        ? [
            h.DataAttribute('cue', closetCue.kind),
            h.DataAttribute('parity', `${closetCue.count % 2}`),
          ]
        : []),
      h.AriaLabel(ariaLabelOf(hat, standing)),
      h.AriaPressed(standing === 'Worn' ? 'true' : 'false'),
      h.Title(HAT_NAMES[hat]),
      h.OnKeyDownPreventDefault(key => keyMessage(columns, hat, key)),
      h.OnClick(Message.ClickedClosetCard({ hat })),
    ],
    [
      h.span(
        [h.Class('closet-figure'), h.AriaHidden(true)],
        [
          h.span([
            h.Class('closet-figure-img'),
            h.Style({ backgroundImage: pictureOf(model.appearance, hat) }),
          ]),
        ],
      ),
      h.span([h.Class('closet-tag')], [tagView(hat, standing, h)]),
      h.span([h.Class('closet-name'), h.AriaHidden(true)], [HAT_NAMES[hat]]),
    ],
  )
}

export const closetTabView = (
  model: Model,
  h: ApplicationViewBuilder,
): Html => {
  const columns = isPortrait(model) ? PORTRAIT_COLUMNS : LANDSCAPE_COLUMNS
  const bones = bonesBalanceOf(model.rank)
  return h.div(
    [h.Class('closet-tab')],
    [
      h.div(
        [h.Class('closet-head')],
        [
          h.span([h.Class('sr-only')], [`${bones} Bones`]),
          boneCountView(bones, 'closet-bones', h),
        ],
      ),
      h.div(
        [h.Class('closet-grid'), h.Role('group'), h.AriaLabel('Hats')],
        Array.map(CLOSET_HATS, hat => cardView(model, hat, columns, h)),
      ),
    ],
  )
}
