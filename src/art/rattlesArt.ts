// Rattles' pixel map, shared by the stall's sprite and the shop's portrait.

// MOOD

export type Mood = 'Grinning' | 'Delighted' | 'Sad' | 'Shrugging'

// LOOK

// NOTE: Rattles is one pixel map: the stall draws it at the room's scale,
// and the shop's portrait is the same map scaled up, cropped at his bow tie,
// so the two never drift apart. A mood swaps only his eyes and mouth.
export const RATTLES_PALETTE: Readonly<Record<string, string>> = {
  P: '#5b3f8c',
  Q: '#7a5ab0',
  W: '#f4f1de',
  S: '#c9c3b0',
  E: '#2a1418',
  G: '#9be36a',
  Y: '#ffd23f',
  R: '#e8333a',
  T: '#6fc3ff',
  C: '#2f4a6b',
  D: '#223650',
}

export type RattlesFace = Readonly<{
  eyes: string
  nose: string
  teeth: string
  jaw: string
}>

const RATTLES_HAT: ReadonlyArray<string> = [
  '...PPP...',
  '..PQPPP..',
  '.PPPPPPP.',
  '..WWWWW..',
]

const RATTLES_SUIT: ReadonlyArray<string> = [
  '.CCRWRCC.',
  'CCDWDWDCC',
  'CCWDWDWCC',
  'CDDWDWDDC',
  'CCCCCCCCC',
  'CDCCCCCDC',
]

const NOSE = '.WSWEWSW.'

export const AWAKE_FACE: RattlesFace = {
  eyes: '.WGEWGEW.',
  nose: NOSE,
  teeth: '..WEWEW..',
  jaw: '...WWW...',
}

export const BLINK_FACE: RattlesFace = { ...AWAKE_FACE, eyes: '.WEEWEEW.' }

export const MOOD_FACES: Readonly<Record<Mood, RattlesFace>> = {
  Grinning: AWAKE_FACE,
  Delighted: {
    eyes: '.WYEWYEW.',
    nose: NOSE,
    teeth: '..EEEEE..',
    jaw: '...WRW...',
  },
  Sad: {
    eyes: '.WEGWEGW.',
    nose: '.TSWEWSW.',
    teeth: '..WWEWW..',
    jaw: '...EWE...',
  },
  Shrugging: {
    eyes: '.WGEWEEW.',
    nose: NOSE,
    teeth: '..WEEEW..',
    jaw: '...WWW...',
  },
}

export const rattlesPixels = (face: RattlesFace): ReadonlyArray<string> => [
  ...RATTLES_HAT,
  face.eyes,
  face.nose,
  face.teeth,
  face.jaw,
  ...RATTLES_SUIT,
]

// NOTE: the portrait's rows: his hat down to the top of his suit.
export const RATTLES_BUST_ROWS = RATTLES_HAT.length + 6
