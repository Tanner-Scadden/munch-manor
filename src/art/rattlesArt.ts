import { glowingEyes } from './sprite.ts'

export type Mood = 'Grinning' | 'Delighted' | 'Sad' | 'Shrugging'

export const RATTLES_PALETTE: Readonly<Record<string, string>> = glowingEyes(
  {
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
  },
  'G',
)

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

export const RATTLES_BUST_ROWS = RATTLES_HAT.length + 6
