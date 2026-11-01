import { Array, Match, Option, Schema, pipe } from 'effect'
import type { Canvas } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { modifyFields } from 'foldkit/struct'
import { toParentMessage } from 'foldkit/test'
import { describe, expect, test } from 'vitest'

import { Dialog, DialogBlock, RadioGroup } from '@foldkit/ui'

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
} from './appearance'
import { CharacterBinding } from './bindings'
import * as Character from './character'
import { RESTART_GRACE_MS } from './constants'
import { PartRadioGroupBlock, SectionRadioGroupBlock } from './lookRadios'
import { update } from './main'
import { Message } from './message'
import {
  Appearance,
  type LookPart,
  type LookToggle,
  type Model,
  Phase,
  defaultAppearance,
  initialModel,
} from './model'
import { home } from './model.fixture'
import { FreePrint, FreeShirtColor } from './playerData'
import { playerShapes } from './playerView'
import { imageColors } from './testPng'
import { resolveFocusOption } from './testing'

type PartMessage = typeof PartRadioGroupBlock.Message.Type

// NOTE: a part's radio group Message as the Look tab hears it, through
// that part's own Binding.
const partMessage = (part: LookPart, partGroupMessage: PartMessage) => {
  switch (part) {
    case 'Body':
      return toParentMessage(Character.BodyBinding, partGroupMessage)
    case 'HairStyle':
      return toParentMessage(Character.HairStyleBinding, partGroupMessage)
    case 'HairColor':
      return toParentMessage(Character.HairColorBinding, partGroupMessage)
    case 'SkinTone':
      return toParentMessage(Character.SkinToneBinding, partGroupMessage)
    case 'ShirtColor':
      return toParentMessage(Character.ShirtColorBinding, partGroupMessage)
    case 'Outfit':
      return toParentMessage(Character.OutfitBinding, partGroupMessage)
    case 'Print':
      return toParentMessage(Character.PrintBinding, partGroupMessage)
    case 'Hat':
      return toParentMessage(Character.HatBinding, partGroupMessage)
    case 'GunSkin':
      return toParentMessage(Character.GunSkinBinding, partGroupMessage)
  }
}

const choose = (part: LookPart, index: number, value: string) =>
  message(
    toParentMessage(
      CharacterBinding,
      partMessage(
        part,
        PartRadioGroupBlock.Message.SelectedOption({ index, value }),
      ),
    ),
  )

const rollDice = () =>
  message(
    toParentMessage(CharacterBinding, Character.Message.ClickedDiceButton()),
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
  message(
    toParentMessage(
      CharacterBinding,
      Character.Message.ClickedToggle({ toggle }),
    ),
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
  return JSON.stringify(
    Array.map([...walk, ...idle], rows =>
      Array.map(rows, row =>
        Array.map(Array.fromIterable(row), symbol =>
          symbol === '.' ? '.' : (palette[symbol] ?? `missing ${symbol}`),
        ).join(' '),
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

  test('picking each part stores it in the appearance', () => {
    story(
      update,
      given(home),
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
      flip('Beard'),
      flip('Glasses'),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
    )
  })

  test('the beard and the glasses each come off with a second tap', () => {
    story(
      update,
      given(home),
      flip('Beard'),
      model(({ appearance, profile }) => {
        expect(appearance.beard).toBe(true)
        expect(profile.fx).toBe('Poof')
      }),
      flip('Glasses'),
      flip('Beard'),
      model(({ appearance }) => {
        expect(appearance).toEqual({ ...defaultAppearance, glasses: true })
      }),
    )
  })

  test('a word that is not one of the options leaves the look alone', () => {
    story(
      update,
      given(home),
      choose('Body', 0, 'Female'),
      resolveFocusOption(),
      choose('Print', 0, 'Plaid'),
      resolveFocusOption(),
      model(({ appearance }) => {
        expect(appearance).toEqual(defaultAppearance)
      }),
    )
  })

  test('the little tabs switch which parts show, and keep the look', () => {
    story(
      update,
      given(home),
      model(({ character }) => {
        expect(character.section).toBe('Body')
      }),
      message(
        toParentMessage(
          CharacterBinding,
          toParentMessage(
            Character.SectionsBinding,
            SectionRadioGroupBlock.Message.SelectedOption({
              index: 2,
              value: 'Outfit',
            }),
          ),
        ),
      ),
      Command.resolve(
        RadioGroup.test.FocusOption,
        SectionRadioGroupBlock.Message.CompletedFocusOption(),
      ),
      model(({ character, appearance }) => {
        expect(character.section).toBe('Outfit')
        expect(appearance).toEqual(home.appearance)
      }),
    )
    expect(Character.SECTION_PARTS.Outfit).toEqual([
      'Outfit',
      'ShirtColor',
      'Print',
    ])
    const listed = Array.flatten(Object.values(Character.SECTION_PARTS))
    expect(Array.dedupe(listed).length).toBe(9)
    expect(Character.SECTION_TOGGLES.Body).toEqual(['Beard', 'Glasses'])
  })

  test('C opens the Profile on Look on the title and the end screens, never mid-run', () => {
    const pressC = (given_: Model) =>
      story(
        update,
        given(given_),
        message(Message.PressedKey({ code: 'KeyC' })),
        Command.resolve(
          Dialog.test.ShowDialog,
          DialogBlock.Message.SucceededShowDialog(),
        ),
        model(({ profile, profileDialog }) => {
          expect(profileDialog.isOpen).toBe(true)
          expect(profile.tab).toBe('Look')
        }),
      )
    pressC(home)
    pressC(
      modifyFields(home, {
        phase: () => Phase.GameOver({ wave: 3 }),
        screenMs: () => RESTART_GRACE_MS,
      }),
    )

    story(
      update,
      given(
        modifyFields(home, {
          phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
        }),
      ),
      message(Message.PressedKey({ code: 'KeyC' })),
      model(({ profileDialog }) => {
        expect(profileDialog.isOpen).toBe(false)
      }),
    )
    story(
      update,
      given(
        modifyFields(home, {
          phase: () => Phase.GameOver({ wave: 3 }),
          screenMs: () => 0,
        }),
      ),
      message(Message.ClickedCharacterButton()),
      model(({ profileDialog }) => {
        expect(profileDialog.isOpen).toBe(false)
      }),
    )
  })

  test('the dice rolls the same look from the same seed and moves the seed on', () => {
    const rollFrom = (seed: number): Model => {
      const holder: { current: Model } = { current: home }
      story(
        update,
        given(modifyFields(home, { cosmeticRngState: () => seed })),
        rollDice(),
        model(rolled => {
          holder.current = rolled
        }),
      )
      return holder.current
    }
    const first = rollFrom(1234)
    const again = rollFrom(1234)
    expect(again.appearance).toEqual(first.appearance)
    expect(again.cosmeticRngState).toBe(first.cosmeticRngState)
    expect(first.cosmeticRngState).not.toBe(1234)
    expect(first.appearance).not.toEqual(defaultAppearance)

    const looks = pipe(
      Array.range(1, 40),
      Array.map(seed => appearanceKey(rollFrom(seed).appearance)),
      Array.dedupe,
    )
    expect(looks.length).toBeGreaterThan(20)
  })

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

  test('the look lasts through new runs, endless, keep going, and restarts', () => {
    story(
      update,
      given(withLook(home, PICKED)),
      message(Message.ClickedCampaignButton()),
      model(({ phase, appearance }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(appearance).toEqual(PICKED)
      }),
    )
    story(
      update,
      given(
        modifyFields(withLook(home, PICKED), {
          phase: () => Phase.GameOver({ wave: 4 }),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.ClickedEndlessButton()),
      model(({ phase, appearance }) => {
        expect(Phase.isAnyOf(['Preparation'])(phase)).toBe(true)
        expect(appearance).toEqual(PICKED)
      }),
    )
    story(
      update,
      given(
        modifyFields(withLook(home, PICKED), {
          phase: () => Phase.Victory(),
          screenMs: () => RESTART_GRACE_MS,
        }),
      ),
      message(Message.ClickedKeepGoingButton()),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
      message(Message.PressedKey({ code: 'Escape' })),
      message(Message.PressedKey({ code: 'Escape' })),
      model(({ appearance }) => {
        expect(appearance).toEqual(PICKED)
      }),
    )
  })

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
