import { Array, Predicate, Record, Result, String } from 'effect'
import {
  Subscription,
  all,
  expectAll,
  given,
  inside,
  role,
  scene,
  tap,
} from 'foldkit/scene'
import { modifyFields } from 'foldkit/struct'
import { describe, test, expect as vitestExpect } from 'vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { ATLAS_SHEET } from '../../test/atlasHtml.setup'
import { fighting, home } from '../../test/model.fixture'
import {
  ROOT,
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
  tap(({ html }) => {
    vitestExpect(sheetUsesIn(html)).toEqual([])
  }),
]

// NOTE: an image of its own, encoded from the sprite's pixels.
const ownImages = (selected: string, count: number) => [
  expectAll(all.selector(selected)).toHaveCount(count),
  expectAll(all.selector(`${selected}[src^="data:image/png"]`)).toHaveCount(
    count,
  ),
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
  KeyboardMouse: 35,
  Touch: 34,
}

describe('sprites in HTML', () => {
  test('How to play shows each card its own frames, not the atlas sheet', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...noSheetInHtml(),
      ...openHandInScene(),
      ...noSheetInHtml(),
      ...pickCardInScene(/^How to play:/),
      inside(
        role('dialog', { name: 'How to play' }),
        ...ownImages(HELP_FRAMES, FRAMES_BY_DEVICE.KeyboardMouse),
      ),
      ...noSheetInHtml(),
    )
  })

  test.each(['KeyboardMouse', 'Touch'] as const)(
    'the pause screen shows the %s cards without the atlas sheet',
    device => {
      scene(
        ROOT,
        given(pausedOn(device)),
        measureSurface,
        ...noSheetInHtml(),
        ...ownImages(HELP_FRAMES, FRAMES_BY_DEVICE[device]),
      )
    },
  )

  test('the Munchopedia list shows each zombie its own image', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(/^Munchopedia:/),
      inside(role('dialog', { name: 'Munchopedia' }), ...ownImages('img', 7)),
      ...noSheetInHtml(),
    )
  })

  test('the character picker shows no atlas sheet', () => {
    scene(
      ROOT,
      given(home),
      measureSurface,
      ...openHandInScene(),
      ...pickCardInScene(/^Character:/),
      ...noSheetInHtml(),
      Subscription.emit(
        SCENE_SUBSCRIPTIONS.keyboard,
        Message.PressedKey({ code: 'Escape' }),
      ),
    )
  })
})
