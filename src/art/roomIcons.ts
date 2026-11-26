import { type Option, Record } from 'effect'

import { DINING_ROOM_ID, KITCHEN_ROOM_ID } from '../world/level/plan'
import type { SlotRoomId } from '../world/schema/entitySchema'
import { type Sprite, spriteShapes } from './sprite'

const OUTLINE = '#140c10'

export const ROOM_ICONS: Readonly<Record<SlotRoomId, Sprite>> = {
  Parlour: spriteShapes(
    [
      'kkkkkkkkk',
      'kBBBBBBBk',
      'kBkkkkkBk',
      'kBkdydkBk',
      'kBkyOykBk',
      'kBkOROkBk',
      'kBkRRRkBk',
      'kkkkkkkkk',
    ],
    {
      k: OUTLINE,
      B: '#a0483c',
      d: '#2a1a1a',
      y: '#ffe066',
      O: '#ff9a3c',
      R: '#e8483c',
    },
  ),
  Library: spriteShapes(
    [
      '.kkkkkkk.',
      'kRRRRRRwk',
      'kRyyyyRwk',
      'kRRRRRRwk',
      'kRRRRRRwk',
      'kRyyyyRwk',
      'kRRRRRRwk',
      '.kkkkkkk.',
    ],
    { k: OUTLINE, R: '#a02a34', y: '#e0c070', w: '#f4f1de' },
  ),
  Cellar: spriteShapes(
    [
      '...kkk...',
      '...kGk...',
      '...kGk...',
      '..kGGGk..',
      '.kGgGGGk.',
      '.kGgwwGk.',
      '.kGgwwGk.',
      '.kGGGGGk.',
      '..kkkkk..',
    ],
    { k: OUTLINE, G: '#2e5a32', g: '#5e9a5a', w: '#e8e2cc' },
  ),
}

const KITCHEN_ICON: Sprite = spriteShapes(
  [
    '...kkk...',
    '.kkkGkkk.',
    'kGGGGGGGk',
    'kkkkkkkkk',
    '.kSSSSSk.',
    'kkSsSSSkk',
    '.kSsSSSk.',
    '.kSSSSSk.',
    '..kkkkk..',
  ],
  { k: OUTLINE, G: '#7a8a96', S: '#5e9a5a', s: '#9be36a' },
)

const DINING_ICON: Sprite = spriteShapes(
  [
    'k.k...kk.',
    'kkk..kwwk',
    '.k..kwwwk',
    '.k.kwWWwk',
    '.k.kwWWwk',
    '.k.kwwwk.',
    '.k..kwwk.',
    '.k...kk..',
  ],
  { k: OUTLINE, w: '#f4f1de', W: '#c8ccd4' },
)

const ICONS_BY_ROOM: Readonly<Record<string, Sprite>> = {
  ...ROOM_ICONS,
  [KITCHEN_ROOM_ID]: KITCHEN_ICON,
  [DINING_ROOM_ID]: DINING_ICON,
}

export const maybeRoomIcon = (roomId: string): Option.Option<Sprite> =>
  Record.get(ICONS_BY_ROOM, roomId)
