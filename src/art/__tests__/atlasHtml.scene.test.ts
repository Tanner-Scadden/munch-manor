import { Array, Effect, Predicate, Record, Result, String } from 'effect'

import { UiStruct } from '@effect/ui'
import { HtmlLocator, HtmlScene } from '@effect/ui/html/testing'
import { Locator } from '@effect/ui/testing'
import { describe, it, expect as vitestExpect } from '@effect/vitest'

import { Message } from '../../app/message'
import { type Model, Phase } from '../../app/model'
import { PressGameSurface } from '../../app/mount'
import {
  HAND_DIALOG_ID,
  PANEL_DIALOG_ID,
  PROFILE_DIALOG_ID,
} from '../../domain/clientSchema'
import { munchopediaPropsOf } from '../../features/munchopedia/__tests__/munchopedia.fixture'
import { Munchopedia } from '../../features/munchopedia/block'
import { ATLAS_SHEET } from '../../test/atlasHtml.setup'
import { fighting, home } from '../../test/model.fixture'
import {
  byClass,
  emitPressedKey,
  measureSurface,
  openHandInScene,
  pickCardInScene,
  requestDialogClose,
  showDialog,
} from '../../test/sceneTesting'
import {
  type SceneStep,
  modelAfter,
  sceneOf,
  send,
  steps,
} from '../../test/testing'

const BAGS = ['attrs', 'props'] as const

const sheetUsesIn = (node: Locator.Node): ReadonlyArray<string> =>
  Array.flatMap(Locator.elements(node), element =>
    Array.flatMap(BAGS, bag => {
      const values = element[bag]
      return Predicate.isObject(values)
        ? Array.filterMap(Record.toEntries(values), ([name, value]) =>
            Predicate.isString(value) && String.includes(ATLAS_SHEET)(value)
              ? Result.succeed(`${element.tag ?? '?'} ${name}`)
              : Result.failVoid,
          )
        : []
    }),
  )

const noSheetInHtml: SceneStep = s =>
  s.check(() => {
    vitestExpect(sheetUsesIn(s.root)).toEqual([])
  })

const withOwnSource = (locator: Locator.Locator): Locator.Locator => ({
  description: `${locator.description}[src^=data:image/png]`,
  all: root =>
    Array.filter(locator.all(root), node =>
      String.startsWith('data:image/png')(node.attrs?.['src'] ?? ''),
    ),
})

const ownImages =
  (locator: Locator.Locator, count: number): SceneStep =>
  s =>
    s
      .expect(locator)
      .toHaveCount(count)
      .expect(withOwnSource(locator))
      .toHaveCount(count)

const pausedOn = (device: Model['lastDevice']): Model =>
  UiStruct.evolve(fighting, {
    lastDevice: () => device,
    phase: () =>
      Phase.Paused({
        round: { _tag: 'Wave', wave: 3, elapsedMs: 4000, spawns: [] },
      }),
  })

const HELP_FRAMES = byClass('help-card-frame')

const FRAMES_BY_DEVICE: Readonly<Record<Model['lastDevice'], number>> = {
  KeyboardMouse: 50,
  Touch: 49,
  Gamepad: 49,
}

describe('sprites in HTML', () => {
  it.effect(
    'How to play shows each card its own frames, not the atlas sheet',
    () =>
      Effect.gen(function* () {
        const s = yield* sceneOf(home)
        s.pipe(
          measureSurface,
          noSheetInHtml,
          openHandInScene,
          showDialog(HAND_DIALOG_ID),
          noSheetInHtml,
          pickCardInScene(/^How to play:/),
          requestDialogClose(HAND_DIALOG_ID, 'close-press'),
          showDialog(PANEL_DIALOG_ID),
          ownImages(
            Locator.inside(
              HtmlLocator.role('dialog', { name: 'How to play' }),
              HELP_FRAMES,
            ),
            FRAMES_BY_DEVICE.KeyboardMouse,
          ),
          noSheetInHtml,
        )
      }),
  )

  it.effect.each(['KeyboardMouse', 'Touch'] as const)(
    'the pause screen shows the %s cards without the atlas sheet',
    device =>
      Effect.gen(function* () {
        const s = yield* sceneOf(pausedOn(device))
        s.pipe(
          measureSurface,
          noSheetInHtml,
          ownImages(HELP_FRAMES, FRAMES_BY_DEVICE[device]),
          c => c.expectMount(PressGameSurface()),
        )
      }),
  )

  it.effect('the Munchopedia list shows each zombie its own image', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        measureSurface,
        openHandInScene,
        showDialog(HAND_DIALOG_ID),
        pickCardInScene(/^Dare Journal:/),
        requestDialogClose(HAND_DIALOG_ID, 'close-press'),
        showDialog(PANEL_DIALOG_ID),
        c =>
          c
            .expect(HtmlLocator.role('dialog', { name: 'Dare Journal' }))
            .toExist(),
        noSheetInHtml,
      )
      const opened = yield* modelAfter(
        home,
        steps(
          send(Message.ClickedManorButton()),
          send(Message.ClickedMunchopediaButton()),
        ),
      )
      const journal = yield* HtmlScene.make(
        Munchopedia,
        munchopediaPropsOf(opened),
      )
      const images = Locator.tag('img')
      journal
        .expect(images)
        .toHaveCount(7)
        .expect(withOwnSource(images))
        .toHaveCount(7)
        .check(() => {
          vitestExpect(sheetUsesIn(journal.root)).toEqual([])
        })
    }),
  )

  it.effect('the character picker shows no atlas sheet', () =>
    Effect.gen(function* () {
      const s = yield* sceneOf(home)
      s.pipe(
        steps(
          measureSurface,
          openHandInScene,
          showDialog(HAND_DIALOG_ID),
          pickCardInScene(/^Character:/),
          requestDialogClose(HAND_DIALOG_ID, 'close-press'),
          showDialog(PROFILE_DIALOG_ID),
          noSheetInHtml,
          emitPressedKey('Escape'),
        ),
      )
    }),
  )
})
