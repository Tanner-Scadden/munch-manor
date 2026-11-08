// @vitest-environment happy-dom
import { Option } from 'effect'
import { given, message, model, story } from 'foldkit/story'
import { describe, expect, test } from 'vitest'

import { Message } from '../../app/message'
import { update } from '../../app/pureApp'
import {
  type KeyDown,
  isKeptFromBrowser,
  maybeKeyDownMessage,
} from '../../app/subscriptions'
import { fighting } from '../../test/model.fixture'
import {
  KEY_WATCH_QUIET_MS,
  type KeyUp,
  isGrabbedKeyUp,
  isKeyGrabToastShown,
} from '../keyGrab'

const surface = (): HTMLDivElement => {
  const element = document.createElement('div')
  element.className = 'game-surface'
  return element
}

const keyDown = (code: string, more: Partial<KeyDown> = {}): KeyDown => ({
  code,
  repeat: false,
  target: surface(),
  ...more,
})

describe('game keys and the browser', () => {
  test('Ctrl, Command, or Alt with a key is the browser shortcut, never a move', () => {
    expect(maybeKeyDownMessage(keyDown('KeyD'))).toEqual(
      Option.some(Message.PressedKey({ code: 'KeyD' })),
    )
    expect(maybeKeyDownMessage(keyDown('KeyD', { ctrlKey: true }))).toEqual(
      Option.none(),
    )
    expect(
      maybeKeyDownMessage(keyDown('ArrowRight', { metaKey: true })),
    ).toEqual(Option.none())
    expect(maybeKeyDownMessage(keyDown('KeyR', { altKey: true }))).toEqual(
      Option.none(),
    )
  })

  test('a game key never also does what the browser does with it', () => {
    for (const code of [
      'KeyD',
      'KeyT',
      'KeyR',
      'KeyF',
      'ArrowDown',
      'Space',
      'Slash',
    ]) {
      expect(isKeptFromBrowser(keyDown(code))).toBe(true)
      expect(isKeptFromBrowser(keyDown(code, { repeat: true }))).toBe(true)
    }
  })

  test('shortcuts, Escape, function keys, and typing stay the browser’s', () => {
    expect(isKeptFromBrowser(keyDown('KeyR', { metaKey: true }))).toBe(false)
    expect(isKeptFromBrowser(keyDown('KeyT', { ctrlKey: true }))).toBe(false)
    expect(isKeptFromBrowser(keyDown('Escape'))).toBe(false)
    expect(isKeptFromBrowser(keyDown('F5'))).toBe(false)
    expect(isKeptFromBrowser(keyDown('Tab'))).toBe(false)
    const field = document.createElement('input')
    expect(isKeptFromBrowser(keyDown('KeyD', { target: field }))).toBe(false)
    expect(maybeKeyDownMessage(keyDown('KeyD', { target: field }))).toEqual(
      Option.none(),
    )
    const button = document.createElement('button')
    expect(isKeptFromBrowser(keyDown('Enter', { target: button }))).toBe(false)
  })

  test('Command lets go of held keys, since macOS drops their keyups', () => {
    const command = maybeKeyDownMessage(keyDown('MetaLeft', { metaKey: true }))
    expect(command).toEqual(Option.some(Message.PressedMetaKey()))
    story(
      update,
      given(fighting),
      message(Message.PressedKey({ code: 'KeyD' })),
      message(Message.PressedMetaKey()),
      model(({ input }) => {
        expect(input.pressedKeys).toEqual([])
      }),
    )
  })
})

const AFTER_QUIET = KEY_WATCH_QUIET_MS + 1

const keyUp = (more: Partial<KeyUp> = {}): KeyUp => ({
  code: 'KeyD',
  wasSeen: false,
  isModified: false,
  hasFocus: true,
  nowMs: AFTER_QUIET,
  quietUntilMs: KEY_WATCH_QUIET_MS,
  ...more,
})

describe('a browser extension grabbing keys', () => {
  test('a letter let go with no keydown seen was grabbed', () => {
    expect(isGrabbedKeyUp(keyUp())).toBe(true)
  })

  test('a keydown seen, a moment after load or focus, or a shortcut is not', () => {
    expect(isGrabbedKeyUp(keyUp({ wasSeen: true }))).toBe(false)
    expect(isGrabbedKeyUp(keyUp({ nowMs: KEY_WATCH_QUIET_MS - 1 }))).toBe(false)
    expect(isGrabbedKeyUp(keyUp({ hasFocus: false }))).toBe(false)
    expect(isGrabbedKeyUp(keyUp({ isModified: true }))).toBe(false)
    expect(isGrabbedKeyUp(keyUp({ code: 'ArrowRight' }))).toBe(false)
  })

  test('the toast shows on the second grabbed key, never the first', () => {
    story(
      update,
      given(fighting),
      message(Message.MissedKeyDown({ code: 'KeyD' })),
      model(current => {
        expect(isKeyGrabToastShown(current)).toBe(false)
      }),
      message(Message.MissedKeyDown({ code: 'KeyD' })),
      model(current => {
        expect(isKeyGrabToastShown(current)).toBe(true)
      }),
      message(Message.MissedKeyDown({ code: 'KeyT' })),
      model(current => {
        expect(current.missedKeyDowns).toBe(2)
      }),
    )
  })

  test('the toast never pauses or stops the wave', () => {
    story(
      update,
      given(fighting),
      message(Message.MissedKeyDown({ code: 'KeyD' })),
      message(Message.MissedKeyDown({ code: 'KeyD' })),
      model(({ phase }) => {
        expect(phase).toEqual(fighting.phase)
      }),
    )
  })
})
