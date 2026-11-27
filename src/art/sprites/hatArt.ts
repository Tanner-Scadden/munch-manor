import type { Appearance, Hat } from '#shared/records/playerData.ts'

export type HatArt = Readonly<{
  above: number
  rows: ReadonlyArray<string>
}>

export const NO_HAT: HatArt = { above: 0, rows: [] }

export const MAX_HAT_ABOVE = 5

export const hatRiseOf = (look: Appearance): number => {
  const hat = look.hat
  return hat === 'None' ? 0 : HAT_ART[hat].above + 1
}

export const HAT_COLORS: Readonly<Record<string, string>> = {
  w: '#f4f1de',
  r: '#d6403a',
  q: '#8e2a2a',
  o: '#f08a24',
  m: '#b85a14',
  y: '#f2c230',
  z: '#b8861c',
  g: '#3fae5a',
  f: '#1f7a3c',
  b: '#3d7bd9',
  c: '#2a5aa8',
  p: '#8c5cd6',
  u: '#5a3a9a',
  k: '#26232e',
  j: '#4a4656',
  n: '#8a5a2e',
  d: '#5c3a1a',
  t: '#c99a5b',
  s: '#d3d8e2',
  e: '#8d93a3',
  i: '#ec6cb0',
  h: '#e6dcb8',
  l: '#ffe9a8',
  x: '#e0b86a',
}

export const HAT_ART: Readonly<Record<Exclude<Hat, 'None'>, HatArt>> = {
  PartyHat: {
    above: 4,
    rows: [
      '...yy...',
      '...rr...',
      '..rrww..',
      '..wwrr..',
      '.rrwwrr.',
      '.yyyyyy.',
    ],
  },
  BucketHat: {
    above: 1,
    rows: ['..tttt..', '.tttttt.', '.nnnnnn.', 'tttttttt'],
  },
  PomBeanie: {
    above: 3,
    rows: [
      '...ww...',
      '..wwww..',
      '..bbbb..',
      '.bbwbbb.',
      '.wwwwww.',
      '.wcwcwc.',
    ],
  },
  PropellerCap: {
    above: 2,
    rows: ['.bbyyrr.', '...yy...', '.rrbbrr.', '.rrbbrr.', '.jjjjjj.'],
  },
  CowboyHat: {
    above: 2,
    rows: ['..ndnn..', '.nnnnnn.', '.nnnnnn.', 'n.dddd.n', 'nnnnnnnn'],
  },
  HornedHelmet: {
    above: 2,
    rows: ['h......h', 'h.eeee.h', 'hssssssh', '.eeeeee.'],
  },
  TopHat: {
    above: 3,
    rows: ['..kkkk..', '..kjkk..', '..kjkk..', '..rrrr..', 'kkkkkkkk'],
  },
  PirateHat: {
    above: 1,
    rows: ['..kkkk..', 'kkkkkkkk', 'kkkwwkkk', 'kyyyyyyk'],
  },
  WitchHat: {
    above: 5,
    rows: [
      '...uu...',
      '...pp...',
      '..pppp..',
      '..pppp..',
      '.pppppp.',
      '.uuyyuu.',
      'pppppppp',
    ],
  },
  TrafficCone: {
    above: 4,
    rows: [
      '...oo...',
      '...oo...',
      '..owwo..',
      '..oooo..',
      '.owwwwo.',
      'mmmmmmmm',
    ],
  },
  Colander: {
    above: 2,
    rows: ['..ssss..', '.sjsjss.', 'ssjssjss', '.eeeeee.'],
  },
  Fez: {
    above: 2,
    rows: ['.rrrrrry', '.rrrrrry', '.rrrrrrk', '.qqqqqq.'],
  },
  BunnyEars: {
    above: 4,
    rows: [
      '.ww..ww.',
      '.wi..iw.',
      '.wi..iw.',
      '.wi..iw.',
      '.wwiiww.',
      '.iiiiii.',
    ],
  },
  Plunger: {
    above: 4,
    rows: [
      '...nd...',
      '...nd...',
      '...nd...',
      '...nd...',
      '..rrrr..',
      '.rrrrrr.',
      '.qqqqqq.',
    ],
  },
  Lampshade: {
    above: 3,
    rows: [
      '...xx...',
      '..llll..',
      '.lxllxl.',
      '.lxllxl.',
      'llxllxll',
      'xxxxxxxx',
    ],
  },
  PumpkinHead: {
    above: 2,
    rows: ['...gg...', '..oooo..', 'oomoomoo', 'oomoomoo', '.mmmmmm.'],
  },
}
