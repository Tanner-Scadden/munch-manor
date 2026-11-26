import { Array, Effect, Match, Option, Record, Schema, pipe } from 'effect'

import { UiStruct } from '@effect/ui'
import { Story } from '@effect/ui/testing'
import { describe, expect, it, test } from '@effect/vitest'

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
import type * as Draw from '../../../../../render/draw'
import { playerShapes } from '../../../../../render/playerView'
import { RESTART_GRACE_MS } from '../../../../../shared/constants'
import { FreePrint, FreeShirtColor } from '../../../../../shared/playerData'
import { home } from '../../../../../test/model.fixture'
import { imageColors } from '../../../../../test/testPng'
import {
  type StoryStep,
  jsonOf,
  modelAfter,
  send,
  settleRunCommands,
  steps,
  storyOf,
  throughIntro,
} from '../../../../../test/testing'
import {
  characterPropsOf,
  pickLook,
  rollLookDice,
} from '../../../__tests__/profile.fixture'
import { Character } from '../block'
import type { LookToggle } from '../lookSchema'
import { Events, Message as LookMessage } from '../message'
import { SECTION_PARTS, SECTION_TOGGLES } from '../model'

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
  propStyle: 'Stock',
}

const flip = (toggle: 'Beard' | 'Glasses'): StoryStep =>
  send(Message.FlippedProfileLook({ toggle }))

const withLook = (base: Model, appearance: Appearance): Model =>
  UiStruct.evolve(base, { appearance: () => appearance })

const fills = (shapes: ReadonlyArray<Draw.Shape>): ReadonlyArray<string> =>
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
      propStyle: 'Stock',
    })
  })

  it.effect('picking each part stores it in the appearance', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(home)
      steps(
        pickLook('Body', 'Slim'),
        pickLook('HairStyle', 'Mohawk'),
        pickLook('HairColor', 'Pink'),
        pickLook('SkinTone', 'Deep'),
        pickLook('ShirtColor', 'Teal'),
        pickLook('Outfit', 'Dress'),
        pickLook('Print', 'Rainbow'),
        flip('Beard'),
        flip('Glasses'),
      )(s)
      expect(s.model.appearance).toEqual(PICKED)
      settleRunCommands(s)
    }),
  )

  it.effect('the Look tab says each pick, flip, and roll for the root', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Character, characterPropsOf(home))
      s.send(LookMessage.PickedPart({ part: 'HairStyle', value: 'Mohawk' }))
        .emitted(Events.ChoseLook({ part: 'HairStyle', value: 'Mohawk' }))
        .send(LookMessage.ClickedToggle({ toggle: 'Beard' }))
        .emitted(Events.FlippedLook({ toggle: 'Beard' }))
        .send(LookMessage.ClickedDiceButton())
        .emitted(Events.RolledDice())
      expect(s.model).toEqual({ section: 'Body' })
    }),
  )

  it.effect('the beard and the glasses each come off with a second tap', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(home)
      flip('Beard')(s)
      expect(s.model.appearance.beard).toBe(true)
      expect(s.model.profile.fx).toBe('Poof')
      steps(flip('Glasses'), flip('Beard'))(s)
      expect(s.model.appearance).toEqual({
        ...defaultAppearance,
        glasses: true,
      })
      settleRunCommands(s)
    }),
  )

  it.effect('a word that is not one of the options leaves the look alone', () =>
    Effect.gen(function* () {
      const s = yield* storyOf(home)
      steps(pickLook('Body', 'Female'), pickLook('Print', 'Plaid'))(s)
      expect(s.model.appearance).toEqual(defaultAppearance)
      settleRunCommands(s)
    }),
  )

  it.effect('the little tabs switch which parts show, and keep the look', () =>
    Effect.gen(function* () {
      const s = yield* Story.make(Character, characterPropsOf(home))
      expect(s.model.section).toBe('Body')
      s.send(LookMessage.PickedSection({ value: 'Outfit' })).expectNone()
      expect(s.model.section).toBe('Outfit')
      expect(s.current.emitted).toEqual([])
      s.send(LookMessage.PickedSection({ value: 'Nope' }))
      expect(s.model.section).toBe('Outfit')
    }),
  )

  test('the little tabs are data: their parts and toggles', () => {
    expect(SECTION_PARTS.Outfit).toEqual(['Outfit', 'ShirtColor', 'Print'])
    const listed = Array.flatten(Record.values(SECTION_PARTS))
    expect(Array.dedupe(listed).length).toBe(9)
    expect(SECTION_TOGGLES.Body).toEqual(['Beard', 'Glasses'])
  })

  it.effect(
    'C opens the Profile on Look on the title and the end screens, never mid-run',
    () =>
      Effect.gen(function* () {
        const pressC = (given_: Model) =>
          Effect.gen(function* () {
            const s = yield* storyOf(given_)
            s.send(Message.PressedKey({ code: 'KeyC' }))
            expect(s.model.profileDialog.isOpen).toBe(true)
            expect(s.model.profile.tab).toBe('Look')
            settleRunCommands(s)
          })
        yield* pressC(home)
        yield* pressC(
          UiStruct.evolve(home, {
            phase: () => Phase.GameOver({ wave: 3 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
        )

        const midRun = yield* modelAfter(
          UiStruct.evolve(home, {
            phase: () => Phase.Wave({ wave: 2, elapsedMs: 0, spawns: [] }),
          }),
          steps(send(Message.PressedKey({ code: 'KeyC' })), settleRunCommands),
        )
        expect(midRun.profileDialog.isOpen).toBe(false)
        const inGrace = yield* modelAfter(
          UiStruct.evolve(home, {
            phase: () => Phase.GameOver({ wave: 3 }),
            screenMs: () => 0,
          }),
          steps(send(Message.ClickedCharacterButton()), settleRunCommands),
        )
        expect(inGrace.profileDialog.isOpen).toBe(false)
      }),
  )

  it.effect(
    'the dice rolls the same look from the same seed and moves the seed on',
    () =>
      Effect.gen(function* () {
        const rollFrom = (seed: number) =>
          modelAfter(
            UiStruct.evolve(home, {
              cosmetics: UiStruct.evolve({ cosmeticRngState: () => seed }),
            }),
            steps(rollLookDice, settleRunCommands),
          )
        const first = yield* rollFrom(1234)
        const again = yield* rollFrom(1234)
        expect(again.appearance).toEqual(first.appearance)
        expect(again.cosmetics.cosmeticRngState).toBe(
          first.cosmetics.cosmeticRngState,
        )
        expect(first.cosmetics.cosmeticRngState).not.toBe(1234)
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
        const started = yield* modelAfter(
          withLook(home, PICKED),
          steps(
            send(Message.ClickedCampaignButton()),
            throughIntro,
            settleRunCommands,
          ),
        )
        expect(Phase.isAnyOf(['Preparation'])(started.phase)).toBe(true)
        expect(started.appearance).toEqual(PICKED)
        const endless = yield* modelAfter(
          UiStruct.evolve(withLook(home, PICKED), {
            phase: () => Phase.GameOver({ wave: 4 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
          steps(
            send(Message.ClickedEndlessButton()),
            throughIntro,
            settleRunCommands,
          ),
        )
        expect(Phase.isAnyOf(['Preparation'])(endless.phase)).toBe(true)
        expect(endless.appearance).toEqual(PICKED)
        const s = yield* storyOf(
          UiStruct.evolve(withLook(home, PICKED), {
            phase: () => Phase.Escaped({ wave: 10 }),
            screenMs: () => RESTART_GRACE_MS,
          }),
        )
        steps(send(Message.ClickedRetryButton()), settleRunCommands)(s)
        expect(s.model.appearance).toEqual(PICKED)
        steps(
          send(Message.PressedKey({ code: 'Escape' })),
          send(Message.PressedKey({ code: 'Escape' })),
          settleRunCommands,
        )(s)
        expect(s.model.appearance).toEqual(PICKED)
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
        propStyle: 'Stock',
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
