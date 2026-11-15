// The look pass's every tunable, as plain data: how the 3D light is cut into
// dithered bands, how dark the dark is, and each room's color script. Only
// the renderer reads it (src/render/iso/look.ts).
//
// Kept plain on purpose: Munch Studio's light and color lab is to slide these
// numbers and colors and propose new ones as a note, so nothing here is code,
// and a value means the same wherever it is read. Colors are 0xRRGGBB as
// authored (sRGB).
//
// How a lit pixel is drawn under the look: the 3D light falling on it (the
// lighting term, never the sprite's own color) is read as one level, cut
// into `steps` bands with a 4x4 Bayer dither on whole game pixels, and the
// band's color is taken from the room's ramp: black, then the accent at the
// pools' dithered fringe, then shadow, mid, and light up the bands. A share of
// the light's own hue (`hueKeep`) is kept over the ramp, so the wave's mood
// (moonlight, the boss's red, src/render/iso/mood.ts) still turns the house.

export type RoomLook = Readonly<{
  // NOTE: the ramp's hues, low to high. Each is taken at full brightness:
  // how bright a band is comes from the light, not from these.
  shadow: number
  mid: number
  light: number
  // NOTE: the room's one other hue, on the lowest lit band: the pools'
  // dithered fringe.
  accent: number
  // NOTE: how much of that band is the accent, 0 to 1.
  accentShare: number
  // NOTE: the room's own fill in place of `roomFill`, for a room with few
  // flames of its own to carry it (the library).
  fill?: number
}>

export type LookSpecs = Readonly<{
  // NOTE: lit bands between black and the brightest, 2 to 15.
  steps: number
  // NOTE: how hard the Bayer dither mixes neighboring bands, 0 (hard
  // edges) to 1 (a full ordered dither).
  dither: number
  // NOTE: light under this level (1 shows the art's own color) is black:
  // the hard darkness between the pools.
  blackBelow: number
  // NOTE: the level the top band stands for; light past it is clamped.
  brightest: number
  // NOTE: the share of the light's own hue kept over the room's ramp.
  hueKeep: number
  // NOTE: the rooms' own fill and the ambient, scaled down, so the flames,
  // the chandelier, the bulb, and the player's lamp carry the picture.
  roomFill: number
  ambient: number
  // NOTE: each room's color script by room id. A room missing here wears
  // NEUTRAL.
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
    // NOTE: candlelit amber, with blood red at the pools' edge.
    Dining: {
      shadow: 0xb0603a,
      mid: 0xffb45a,
      light: 0xffe6b0,
      accent: 0xd02838,
      accentShare: 0.6,
    },
    // NOTE: a sickly green under the bulb, with a pink fringe.
    Cellar: {
      shadow: 0x4f8a5a,
      mid: 0xa8e07a,
      light: 0xeaffc0,
      accent: 0xff6eb4,
      accentShare: 0.65,
    },
    // NOTE: moonlit lavender, pale: the ramp tints the art it lights, so a
    // deep violet over the brown wood would draw it black.
    Library: {
      shadow: 0x9a8cc0,
      mid: 0xe6defa,
      light: 0xfff8f0,
      accent: 0xffd27a,
      accentShare: 0.5,
      fill: 1,
    },
    // NOTE: oven orange, with teal steam.
    Kitchen: {
      shadow: 0xa04a28,
      mid: 0xff9a48,
      light: 0xffdcae,
      accent: 0x3ad6c8,
      accentShare: 0.5,
    },
  },
}
