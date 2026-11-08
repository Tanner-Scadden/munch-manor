import { Array, Effect, Match, Option, Record, Schema, pipe } from 'effect'
import { type Canvas, Story } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, expect, it, test } from '@effect/vitest'
import { RadioGroup } from '@foldkit/ui'

import { ProfileBinding } from '../../../../../app/bindings'
import { Message } from '../../../../../app/message'
import {
  Appearance,
  type Model,
  Phase,
  defaultAppearance,
} from '../../../../../app/model'
import { initialModel } from '../../../../../app/pureApp'
import {
  BODIES,
  HAIR_COLORS,
  HAIR_STYLES,
  ON_OFF,
  OUTFITS,
  PLAYER_WIDTH,
  PRINTS,
  SHIRT_COLORS,
  SHIRT_SHADES,
  SKIN_SHADES,
  SKIN_TONES,
  appearanceKey,
  playerPalette,
  playerPixels,
  playerSprites,
  randomAppearance,
} from '../../../../../art/appearance'
import type { LookPart } from '../../../../../domain/looks'
import { playerShapes } from '../../../../../render/playerView'
import { RESTART_GRACE_MS } from '../../../../../shared/constants'
import { FreePrint, FreeShirtColor } from '../../../../../shared/playerData'
import { home } from '../../../../../test/model.fixture'
import { imageColors } from '../../../../../test/testPng'
import {
  APPLICATION,
  jsonOf,
  resolveFocusOption,
  showDialog,
} from '../../../../../test/testing'
import { CharacterBinding } from '../../../composition'
import * as Character from '../block'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from '../lookRadios'
import type { LookToggle } from '../lookSchema'

// NOTE: a part's radio group Message, delivered down its path: the
// Profile, the Look tab, and that part's own Binding. Only a Block-aware
// Story builds a grandchild's envelopes.
const choose = (part: LookPart, index: number, value: string) => {
  const selected = PartRadioGroupBlock.Message.SelectedOption({ index, value })
  switch (part) {
    case 'Body':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.BodyBinding],
        selected,
      )
    case 'HairStyle':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.HairStyleBinding],
        selected,
      )
    case 'HairColor':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.HairColorBinding],
        selected,
      )
    case 'SkinTone':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.SkinToneBinding],
        selected,
      )
    case 'ShirtColor':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.ShirtColorBinding],
        selected,
      )
    case 'Outfit':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.OutfitBinding],
        selected,
      )
    case 'Print':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.PrintBinding],
        selected,
      )
    case 'Hat':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.HatBinding],
        selected,
      )
    case 'GunSkin':
      return Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.GunSkinBinding],
        selected,
      )
  }
}

const rollDice = () =>
  Story.messageIn(
    [ProfileBinding, CharacterBinding],
    Character.Message.ClickedDiceButton(),
  )

const PICKED: Appearance = {
  body: 'Slim',
  hairStyle: 'Mohawk',
  hairColor: 'Pink',
  skinTone: 'Deep',
  shirtColor: 'Teal',
  outfit: 'Dress',
  print: 'Rainbow',
  beard: true,
  glasses: true,
  hat: 'None',
  gunSkin: 'Stock',
}

const flip = (toggle: 'Beard' | 'Glasses') =>
  Story.messageIn(
    [ProfileBinding, CharacterBinding],
    Character.Message.ClickedToggle({ toggle }),
  )

const flipIn = (toggle: 'Beard' | 'Glasses') =>
  Story.messageIn(
    [ProfileBinding, CharacterBinding],
    Character.Message.ClickedToggle({ toggle }),
  )

const withLook = (base: Model, appearance: Appearance): Model =>
  modifyFields(base, { appearance: () => appearance })

const fills = (shapes: ReadonlyArray<Canvas.Shape>): ReadonlyArray<string> =>
  Array.flatMap(shapes, shape =>
    Match.value(shape).pipe(
      Match.tag('Group', group => fills(group.shapes)),
      Match.tag('Rect', rect =>
        Option.toArray(Option.fromNullishOr(rect.fill)),
      ),
      Match.tag('Image', image => imageColors(image.src)),
      Match.orElse(() => []),
    ),
  )

// NOTE: every option of every part as a list of looks: the classic look
// with that one option in it.
type PartOptions = Readonly<{
  part: LookPart | LookToggle
  looks: ReadonlyArray<Appearance>
}>

const optionsOfEveryPart = (base: Appearance): ReadonlyArray<PartOptions> => [
  { part: 'Body', looks: Array.map(BODIES, body => ({ ...base, body })) },
  {
    part: 'HairStyle',
    looks: Array.map(HAIR_STYLES, hairStyle => ({ ...base, hairStyle })),
  },
  {
    part: 'HairColor',
    looks: Array.map(HAIR_COLORS, hairColor => ({ ...base, hairColor })),
  },
  {
    part: 'SkinTone',
    looks: Array.map(SKIN_TONES, skinTone => ({ ...base, skinTone })),
  },
  {
    part: 'ShirtColor',
    looks: Array.map(SHIRT_COLORS, shirtColor => ({ ...base, shirtColor })),
  },
  {
    part: 'Outfit',
    looks: Array.map(OUTFITS, outfit => ({ ...base, outfit })),
  },
  { part: 'Print', looks: Array.map(PRINTS, print => ({ ...base, print })) },
  { part: 'Beard', looks: Array.map(ON_OFF, beard => ({ ...base, beard })) },
  {
    part: 'Glasses',
    looks: Array.map(ON_OFF, glasses => ({ ...base, glasses })),
  },
]

// NOTE: a frame as the colors it paints, so two looks compare by what the
// player sees, not by the symbols that draw it.
const painted = (appearance: Appearance): string => {
  const palette = playerPalette(appearance)
  const { walk, idle } = playerPixels(appearance)
  return jsonOf(
    Array.map([...walk, ...idle], rows =>
      Array.map(rows, row =>
        Array.join(
          Array.map(Array.fromIterable(row), symbol =>
            symbol === '.' ? '.' : (palette[symbol] ?? `missing ${symbol}`),
          ),
          ' ',
        ),
      ),
    ),
  )
}

const isAppearance = Schema.is(Appearance)

describe('Character', () => {
  test('starts as the classic look', () => {
    expect(initialModel.appearance).toEqual({
      body: 'Broad',
      hairStyle: 'Short',
      hairColor: 'Brown',
      skinTone: 'Light',
      shirtColor: 'Blue',
      outfit: 'Tee',
      print: 'Plain',
      beard: false,
      glasses: false,
      hat: 'None',
      gunSkin: 'Stock',
    })
  })

  it.effect('picking each part stores it in the appearance', () =>
    Story.story(
      APPLICATION,
      Story.given(home),
      choose('Body', 0, 'Slim'),
      resolveFocusOption(),
      choose('HairStyle', 4, 'Mohawk'),
      resolveFocusOption(),
      choose('HairColor', 5, 'Pink'),
      resolveFocusOption(),
      choose('SkinTone', 5, 'Deep'),
      resolveFocusOption(),
      choose('ShirtColor', 3, 'Teal'),
      resolveFocusOption(),
      choose('Outfit', 2, 'Dress'),
      resolveFocusOption(),
      choose('Print', 2, 'Rainbow'),
      resolveFocusOption(),
      flipIn('Beard'),
      flipIn('Glasses'),
      Story.model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
    ),
  )

  it.effect('the beard and the glasses each come off with a second tap', () =>
    Story.story(
      APPLICATION,
      Story.given(home),
      flip('Beard'),
      Story.model(({ appearance, profile }) => {
        expect(appearance.beard).toBe(true)
        expect(profile.fx).toBe('Poof')
      }),
      flip('Glasses'),
      flip('Beard'),
      Story.model(({ appearance }) => {
        expect(appearance).toEqual({ ...defaultAppearance, glasses: true })
      }),
    ),
  )

  it.effect('a word that is not one of the options leaves the look alone', () =>
    Story.story(
      APPLICATION,
      Story.given(home),
      choose('Body', 0, 'Female'),
      resolveFocusOption(),
      choose('Print', 0, 'Plaid'),
      resolveFocusOption(),
      Story.model(({ appearance }) => {
        expect(appearance).toEqual(defaultAppearance)
      }),
    ),
  )

  it.effect('the little tabs switch which parts show, and keep the look', () =>
    Story.story(
      APPLICATION,
      Story.given(home),
      Story.model(({ profile }) => {
        expect(profile.character.section).toBe('Body')
      }),
      Story.messageIn(
        [ProfileBinding, CharacterBinding, Character.SectionsBinding],
        SectionRadioGroupBlock.Message.SelectedOption({
          index: 2,
          value: 'Outfit',
        }),
      ),
      Story.Command.resolve(
        RadioGroup.test.FocusOption,
        SectionRadioGroupBlock.Message.CompletedFocusOption(),
      ),
      Story.model(({ profile, appearance }) => {
        expect(profile.character.section).toBe('Outfit')
        expect(appearance).toEqual(home.appearance)
      }),
    ),
  )

  test('the little tabs are data: their parts and toggles', () => {
    expect(Character.SECTION_PARTS.Outfit).toEqual([
      'Outfit',
      'ShirtColor',
      'Print',
    ])
    const listed = Array.flatten(Record.values(Character.SECTION_PARTS))
    expect(Array.dedupe(listed).length).toBe(9)
    expect(Character.SECTION_TOGGLES.Body).toEqual(['Beard', 'Glasses'])
  })

  it.effect(
    'C opens the Profile on Look on the title and the end screens, never mid-run',
    () =>
      Effect.gen(function* () {
        const pressC = (given_: Model) =>
          Story.story(
            APPLICATION,
            Story.given(given_),
            Story.message(Message.PressedKey({ code: 'KeyC' })),
            showDialog(),
            Story.model(({ profile, profileDialog }) => {
              expect(profileDialog.isOpen).toBe(true)
              expect(profile.tab).toBe('Look')
            }),
          )
        yield* pressC(home)
        yield* pressC(
          modifyFields(home, {
            phase: () => Phase.GameOver({ wave: 3 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
        )

        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(home, {
              phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
            }),
          ),
          Story.message(Message.PressedKey({ code: 'KeyC' })),
          Story.model(({ profileDialog }) => {
            expect(profileDialog.isOpen).toBe(false)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(home, {
              phase: () => Phase.GameOver({ wave: 3 }),
              screenMs: () => 0,
            }),
          ),
          Story.message(Message.ClickedCharacterButton()),
          Story.model(({ profileDialog }) => {
            expect(profileDialog.isOpen).toBe(false)
          }),
        )
      }),
  )

  it.effect(
    'the dice rolls the same look from the same seed and moves the seed on',
    () =>
      Effect.gen(function* () {
        const rollFrom = (seed: number) =>
          Story.story(
            APPLICATION,
            Story.given(modifyFields(home, { cosmeticRngState: () => seed })),
            rollDice(),
          )
        const first = yield* rollFrom(1234)
        const again = yield* rollFrom(1234)
        expect(again.appearance).toEqual(first.appearance)
        expect(again.cosmeticRngState).toBe(first.cosmeticRngState)
        expect(first.cosmeticRngState).not.toBe(1234)
        expect(first.appearance).not.toEqual(defaultAppearance)

        const rolled = yield* Effect.forEach(Array.range(1, 40), rollFrom)
        const looks = Array.dedupe(
          Array.map(rolled, ({ appearance }) => appearanceKey(appearance)),
        )
        expect(looks.length).toBeGreaterThan(20)
      }),
  )

  test('the dice never hands back the look you already have', () => {
    Array.forEach(Array.range(0, 300), seed => {
      const [, firstRoll] = randomAppearance(seed, defaultAppearance, [], 1)
      const [, reroll] = randomAppearance(seed, firstRoll, [], 1)
      expect(appearanceKey(reroll)).not.toBe(appearanceKey(firstRoll))
    })
  })

  test('the dice draws only real looks, each part from its full list', () => {
    const rolls = pipe(
      Array.range(0, 1999),
      Array.map(
        seed => randomAppearance(seed * 7919 + 1, defaultAppearance, [], 1)[1],
      ),
    )
    Array.forEach(rolls, rolled => {
      expect(isAppearance(rolled)).toBe(true)
    })
    const seen = (read: (look: Appearance) => string) =>
      Array.dedupe(Array.map(rolls, read)).length
    expect(seen(look => look.body)).toBe(BODIES.length)
    expect(seen(look => look.hairStyle)).toBe(HAIR_STYLES.length)
    expect(seen(look => look.hairColor)).toBe(HAIR_COLORS.length)
    expect(seen(look => look.skinTone)).toBe(SKIN_TONES.length)
    expect(seen(look => look.shirtColor)).toBe(FreeShirtColor.literals.length)
    expect(seen(look => look.outfit)).toBe(OUTFITS.length)
    expect(seen(look => look.print)).toBe(FreePrint.literals.length)
    expect(seen(look => `${look.beard}`)).toBe(ON_OFF.length)
    expect(seen(look => `${look.glasses}`)).toBe(ON_OFF.length)
  })

  it.effect(
    'the look lasts through new runs, endless, keep going, and restarts',
    () =>
      Effect.gen(function* () {
        yield* Story.story(
          APPLICATION,
          Story.given(withLook(home, PICKED)),
          Story.message(Message.ClickedCampaignButton()),
          Story.model(({ phase, appearance }) => {
            expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
            expect(appearance).toEqual(PICKED)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(withLook(home, PICKED), {
              phase: () => Phase.GameOver({ wave: 4 }),
              screenMs: () => RESTART_GRACE_MS,
            }),
          ),
          Story.message(Message.ClickedEndlessButton()),
          Story.model(({ phase, appearance }) => {
            expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
            expect(appearance).toEqual(PICKED)
          }),
        )
        yield* Story.story(
          APPLICATION,
          Story.given(
            modifyFields(withLook(home, PICKED), {
              phase: () => Phase.Victory(),
              screenMs: () => RESTART_GRACE_MS,
            }),
          ),
          Story.message(Message.ClickedKeepGoingButton()),
          Story.model(({ appearance }) => {
            expect(appearance).toEqual(PICKED)
          }),
          Story.message(Message.PressedKey({ code: 'Escape' })),
          Story.message(Message.PressedKey({ code: 'Escape' })),
          Story.model(({ appearance }) => {
            expect(appearance).toEqual(PICKED)
          }),
        )
      }),
  )

  test('the player sprite wears the chosen skin and shirt', () => {
    const plainPicked: Appearance = { ...PICKED, print: 'Plain' }
    const classic = fills(playerShapes(home))
    const picked = fills(playerShapes(withLook(home, plainPicked)))
    expect(classic).toContain(SKIN_SHADES.Light.skin)
    expect(classic).toContain(SHIRT_SHADES.Blue.base)
    expect(picked).toContain(SKIN_SHADES.Deep.skin)
    expect(picked).toContain(SHIRT_SHADES.Teal.base)
    expect(picked).not.toContain(SKIN_SHADES.Light.skin)
    expect(picked).not.toContain(SHIRT_SHADES.Blue.base)
  })

  test('the Rainbow print wears the six real colors of the pride flag', () => {
    const colors = fills(
      playerShapes(withLook(home, { ...defaultAppearance, print: 'Rainbow' })),
    )
    expect(colors).toEqual(
      expect.arrayContaining([
        '#e40303',
        '#ff8c00',
        '#ffed00',
        '#008026',
        '#004cff',
        '#732982',
      ]),
    )
  })

  // NOTE: decided with the owner on 2026-10-30: nothing is tied to a body.
  // Every option of every part, on every body, in a tee and in the outfit
  // with the most going on, draws whole: the same frame sizes as the
  // classic look, every pixel a color, and each option of a part looking
  // different from the others.
  describe.each(BODIES)('on a %s body', body => {
    const bases: ReadonlyArray<Appearance> = [
      { ...defaultAppearance, body },
      { ...defaultAppearance, body, outfit: 'Dress', hairStyle: 'Long' },
      {
        ...defaultAppearance,
        body,
        outfit: 'Overalls',
        print: 'Rainbow',
        beard: true,
        glasses: true,
        hat: 'None',
        gunSkin: 'Stock',
      },
    ]
    const frameSizes = (appearance: Appearance) =>
      pipe(playerPixels(appearance), ({ walk, idle }) =>
        Array.map([...walk, ...idle], rows => ({
          height: rows.length,
          widths: Array.dedupe(Array.map(rows, row => row.length)),
        })),
      )
    const classicSizes = frameSizes(defaultAppearance)

    test.each(optionsOfEveryPart({ ...defaultAppearance, body }))(
      'every $part option draws whole and its own way',
      ({ part, looks }) => {
        const looksOn = (base: Appearance) =>
          Array.map(looks, look => ({ ...base, ...pickPart(part, look) }))
        Array.forEach(bases, base => {
          Array.forEach(looksOn(base), look => {
            expect(frameSizes(look)).toEqual(classicSizes)
            expect(painted(look)).not.toContain('missing')
          })
        })
        Array.forEach(
          Array.filter(bases, base => base.outfit === 'Tee'),
          base => {
            const partLooks = looksOn(base)
            expect(Array.dedupe(Array.map(partLooks, painted)).length).toBe(
              partLooks.length,
            )
          },
        )
      },
    )
  })

  test('every body draws its own shape', () => {
    expect(
      Array.dedupe(
        Array.map(BODIES, body => painted({ ...defaultAppearance, body })),
      ).length,
    ).toBe(BODIES.length)
    Array.forEach(classicFrameWidths(), widths => {
      expect(widths).toEqual([PLAYER_WIDTH])
    })
  })

  test('sprites are built once per look and reused', () => {
    const first = playerSprites(PICKED)
    expect(playerSprites({ ...PICKED })).toBe(first)
    expect(playerSprites(defaultAppearance)).not.toBe(first)
    expect(
      Option.isSome(
        Array.findFirst(
          fills(first.idle[0].Flash.Right),
          fill => fill !== '#ffffff',
        ),
      ),
    ).toBe(false)
  })
})

const classicFrameWidths = () =>
  pipe(playerPixels(defaultAppearance), ({ walk, idle }) =>
    Array.map([...walk, ...idle], rows =>
      Array.dedupe(Array.map(rows, row => row.length)),
    ),
  )

// NOTE: the one field a part names, taken from a look.
const pickPart = (
  part: LookPart | LookToggle,
  look: Appearance,
): Partial<Appearance> =>
  part === 'Body'
    ? { body: look.body }
    : part === 'HairStyle'
      ? { hairStyle: look.hairStyle }
      : part === 'HairColor'
        ? { hairColor: look.hairColor }
        : part === 'SkinTone'
          ? { skinTone: look.skinTone }
          : part === 'ShirtColor'
            ? { shirtColor: look.shirtColor }
            : part === 'Outfit'
              ? { outfit: look.outfit }
              : part === 'Print'
                ? { print: look.print }
                : part === 'Beard'
                  ? { beard: look.beard }
                  : { glasses: look.glasses }
