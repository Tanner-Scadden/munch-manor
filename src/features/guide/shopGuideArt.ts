import {
  HEART_FULL,
  RATTLES_ART,
  type ShopArt,
  artOf,
  gunArt,
  itemArt,
} from '../../art/shopArt'
import type { HouseSpot, ShopGuideSection } from '../../shared/nameKeys'
import type { FridgePrize } from '../../world/schema/worldSchema'
import { GuideArt } from './shopGuide'

// NOTE: the shop guide's pictures. Guns, goods, and traps are the shop's own
// art (src/art/shopArt.ts); the fridge's gags and the places around the house are
// drawn here, as pixel maps turned into SVG once at module scope.

const INK = '#140c10'

const FRIDGE_ART = artOf(
  [
    '..KKKKKKKKKK..',
    '.KWWWWWWWWWWK.',
    '.KWwWWWWWWWWK.',
    '.KWWWWWWWWWWK.',
    '.KKKKKKKKKKKK.',
    '.KWWWWWWWWWWK.',
    '.KWgWWWWWWWWK.',
    '.KWgWWWWWWWWK.',
    '.KWWWWWWWWWWK.',
    '.KWWWWWWWWWWK.',
    '.KWWWWWWWWWWK.',
    '.KWWWWWWWWWWK.',
    '.KKKKKKKKKKKK.',
    '..KK......KK..',
  ],
  { K: INK, W: '#cfd8d0', w: '#eef3ee', g: '#6fae4a' },
)

const SANDWICH_ART = artOf(
  [
    '..KKKKKKKKKK..',
    '.KBBBBBBBBBBK.',
    'KBBbBBBBBbBBBK',
    '.KGGGGGGGGGGK.',
    'KGgGGMGGGGgGGK',
    '.KRRRRRRMRRRK.',
    '.KBBBBBBBBBBK.',
    '..KKKKKKKKKK..',
  ],
  {
    K: INK,
    B: '#c9a26a',
    b: '#8a6a3c',
    G: '#6fae4a',
    g: '#4f7a3a',
    M: '#7fb0a0',
    R: '#d8423a',
  },
)

const DUD_ART = artOf(
  [
    '..KKK.........',
    '.KWWWK..KK..KK',
    'KWKWWKKKWWKKWK',
    'KWWWWWWWWWWWWK',
    'KWKWWKKKWWKKWK',
    '.KWWWK..KK..KK',
    '..KKK.........',
  ],
  { K: INK, W: '#e8e4d0' },
)

const BOARDS_ART = artOf(
  [
    'KKKKKKKKKKKKKK',
    'KDDDDDDDDDDDDK',
    'KdDDDDDDDDDDdK',
    'KKKKKKKKKKKKKK',
    'KDDDDYYYYDDDDK',
    'KDDDYKKKKYDDDK',
    'KDDDYYYYYYDDDK',
    'KdDDYYKKYYDdDK',
    'KDDDYYYYYYDDDK',
    'KKKKKKKKKKKKKK',
    'KDDDDDDDDDDDDK',
    'KdDDDDDDDDDDdK',
    'KKKKKKKKKKKKKK',
  ],
  { K: INK, D: '#b8813f', d: '#8a5a2b', Y: '#ffd23f' },
)

const PRIZE_ART: Readonly<Record<FridgePrize, ShopArt>> = {
  Cooker: gunArt('Cooker', 0),
  Pan: gunArt('Pan', 0),
  Freeze: gunArt('Freeze', 0),
  Sandwich: SANDWICH_ART,
  Dud: DUD_ART,
}

// NOTE: the stove bench, a cast iron stove with a chili over its pot, and
// the gas valve's red wheel on its pipe.
const STOVE_ART = artOf(
  [
    '.....RR.......',
    '....RRr.......',
    '...KKKKKKKK...',
    '..KggggggggK..',
    '.KKKKKKKKKKKK.',
    '.KIIIIIIIIIIK.',
    '.KIKKKKKKKKIK.',
    '.KIKOOOOOOKIK.',
    '.KIKOYYYYOKIK.',
    '.KIKKKKKKKKIK.',
    '.KIIIIIIIIIIK.',
    '.KKKKKKKKKKKK.',
    '..KK......KK..',
  ],
  {
    K: INK,
    I: '#44444c',
    g: '#7c9c3a',
    O: '#ff9a2a',
    Y: '#ffe066',
    R: '#e0482a',
    r: '#ff9a7a',
  },
)

const VALVE_ART = artOf(
  [
    '......PP......',
    '....KKKKKK....',
    '...KRRRRRRK...',
    '..KRKRRRRKRK..',
    '..KRRKRRKRRK..',
    '..KRRRKKRRRK..',
    '..KRRRKKRRRK..',
    '..KRRKRRKRRK..',
    '..KRKRRRRKRK..',
    '...KRRRRRRK...',
    '....KKKKKK....',
    '......PP......',
    '......PP......',
  ],
  { K: INK, R: '#d8302a', P: '#6a6a74' },
)

const HOUSE_ART: Readonly<Record<HouseSpot, ShopArt>> = {
  Stall: RATTLES_ART.Grinning,
  Boards: BOARDS_ART,
  Fridge: FRIDGE_ART,
  Stove: STOVE_ART,
  Valve: VALVE_ART,
}

export const guideArtOf = (art: GuideArt): ShopArt =>
  GuideArt.match(art, {
    Gun: ({ weapon, tier }) => gunArt(weapon, tier),
    Item: ({ id }) => itemArt(id),
    Prize: ({ prize }) => PRIZE_ART[prize],
    House: ({ spot }) => HOUSE_ART[spot],
    Heart: () => HEART_FULL,
  })

const SECTION_ART: Readonly<Record<ShopGuideSection, ShopArt>> = {
  Guns: gunArt('Pistol', 0),
  Health: HEART_FULL,
  Traps: itemArt('Turret'),
  Fridge: FRIDGE_ART,
  House: BOARDS_ART,
}

export const sectionArtOf = (section: ShopGuideSection): ShopArt =>
  SECTION_ART[section]
