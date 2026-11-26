import { Tunable } from './tunable'

export type RoomLook = Readonly<{
  shadow: number
  mid: number
  light: number
  accent: number
  accentShare: number
  fill?: number
}>

export type LookSpecs = Readonly<{
  steps: number
  dither: number
  blackBelow: number
  brightest: number
  hueKeep: number
  roomFill: number
  ambient: number
  rooms: Readonly<Record<string, RoomLook>>
}>

export const NEUTRAL: RoomLook = {
  shadow: 0x8a7a90,
  mid: 0xf0e0d0,
  light: 0xfff8f0,
  accent: 0x8a7a90,
  accentShare: 0,
}

export const LOOK: LookSpecs = {
  steps: 5,
  dither: 0.5,
  blackBelow: 0.08,
  brightest: 1.3,
  hueKeep: 0.35,
  roomFill: 0.6,
  ambient: 0.55,
  rooms: {
    Dining: {
      shadow: 0xb0603a,
      mid: 0xffb45a,
      light: 0xffe6b0,
      accent: 0xd02838,
      accentShare: 0.6,
    },
    Cellar: {
      shadow: 0x4f8a5a,
      mid: 0xa8e07a,
      light: 0xeaffc0,
      accent: 0xff6eb4,
      accentShare: 0.65,
    },
    Library: {
      shadow: 0x9a8cc0,
      mid: 0xe6defa,
      light: 0xfff8f0,
      accent: 0xffd27a,
      accentShare: 0.5,
      fill: 1,
    },
    Kitchen: {
      shadow: 0xa04a28,
      mid: 0xff9a48,
      light: 0xffdcae,
      accent: 0x3ad6c8,
      accentShare: 0.5,
    },
  },
}

export const LOOK_TUNING = new Tunable<LookSpecs>(LOOK)
