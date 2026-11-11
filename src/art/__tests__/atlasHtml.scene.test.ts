import { Array, Predicate, Record, Result, String } from 'effect'
import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { ATLAS_SHEET } from '../../test/atlasHtml.setup'
import { fighting, home } from '../../test/model.fixture'
import {
  APPLICATION,
  SCENE_SUBSCRIPTIONS,
  measureSurface,
  openHandInScene,
  pickCardInScene,
} from '../../test/testing'

// NOTE: a production build draws every sprite as a cropped region of the
// atlas sheet (src/test/atlasHtml.setup.ts stands one in). A canvas crops it, but
// an <img> or a CSS background cannot, so HTML that shows a sprite by its
// own source shows the whole sheet squashed into the box. HTML must take
// `standaloneSource(image)` instead.
type Node = Readonly<{
  sel?: string | undefined
  data?: Readonly<Record<string, unknown>> | undefined
  children?: ReadonlyArray<Node | string> | undefined
}>

const BAGS = ['attrs', 'props', 'style'] as const

// NOTE: every attribute, property, and style of the page (an <img> src, a
// CSS background) that names the atlas sheet.
const sheetUsesIn = (node: Node): ReadonlyArray<string> => [
  ...Array.flatMap(BAGS, bag => {
    const values = node.data?.[bag]
    return Predicate.isObject(values)
      ? Array.filterMap(Record.toEntries(values), ([name, value]) =>
          Predicate.isString(value) && String.includes(ATLAS_SHEET)(value)
            ? Result.succeed(`${node.sel ?? '?'} ${name}`)
            : Result.failVoid,
        )
      : []
  }),
  ...Array.flatMap(node.children ?? [], child =>
    Predicate.isString(child) ? [] : sheetUsesIn(child),
  ),
]

const noSheetInHtml = () => [
  Scene.tap(({ html }) => {
    vitestExpect(sheetUsesIn(html)).toEqual([])
  }),
]

// NOTE: an image of its own, encoded from the sprite's pixels.
const ownImages = (selected: string, count: number) => [
  Scene.expectAll(Scene.all.selector(selected)).toHaveCount(count),
  Scene.expectAll(
    Scene.all.selector(`${selected}[src^="data:image/png"]`),
  ).toHaveCount(count),
]

const pausedOn = (device: Model['lastDevice']): Model =>
  modifyFields(fighting, {
    lastDevice: () => device,
    phase: () =>
      Phase.Paused({
        round: { _tag: 'Wave', wave: 3, elapsedMs: 4000, spawns: [] },
      }),
  })

const HELP_FRAMES = '.help-card-frame'

// NOTE: every frame of the ten control cards' moving pictures.
const FRAMES_BY_DEVICE: Readonly<Record<Model['lastDevice'], number>> = {
  KeyboardMouse: 41,
  Touch: 40,
}

describe('sprites in HTML', () => {
  it.effect(
    'How to play shows each card its own frames, not the atlas sheet',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(home),
        measureSurface,
        ...noSheetInHtml(),
        ...openHandInScene(),
        ...noSheetInHtml(),
        ...pickCardInScene(/^How to play:/),
        Scene.inside(
          Scene.role('dialog', { name: 'How to play' }),
          ...ownImages(HELP_FRAMES, FRAMES_BY_DEVICE.KeyboardMouse),
        ),
        ...noSheetInHtml(),
      ),
  )

  it.effect.each(['KeyboardMouse', 'Touch'] as const)(
    'the pause screen shows the %s cards without the atlas sheet',
    device =>
      Scene.scene(
        APPLICATION,
        Scene.given(pausedOn(device)),
        measureSurface,
        ...noSheetInHtml(),
        ...ownImages(HELP_FRAMES, FRAMES_BY_DEVICE[device]),
      ),
  )

  it.effect('the Munchopedia list shows each zombie its own image', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(/^Munchopedia:/),
      Scene.inside(
        Scene.role('dialog', { name: 'Munchopedia' }),
        ...ownImages('img', 7),
      ),
      ...noSheetInHtml(),
    ),
  )

  it.effect('the character picker shows no atlas sheet', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(/^Character:/),
      ...noSheetInHtml(),
      Scene.Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
    ),
  )
})
