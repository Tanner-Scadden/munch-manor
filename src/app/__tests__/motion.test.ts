import { Array, Record, String } from 'effect'
import { describe, expect, test } from 'vitest'

import coopCss from '../../features/coop/coop.css?raw'
import callingCss from '../../features/heroes/calling.css?raw'
import menuCss from '../../features/home/menu.css?raw'
import lobbyCss from '../../features/lobby/lobby.css?raw'
import closetCss from '../../features/profile/blocks/look/closet.css?raw'
import profileCss from '../../features/profile/profile.css?raw'
import stylesCss from '../styles.css?raw'

// NOTE: a press lands where a button is when the finger goes down and
// comes up. A button that slides, grows, or spins into place while a player
// taps it is somewhere else by then, so the press missed or hit what was
// behind it. So an animation that moves an element (transform, translate,
// scale, rotate, or its insets) may only run on art: an icon or a face inside a
// button, a badge, a particle, a sprite. A button, and anything holding
// one, comes in by fading, glowing, or flashing, with its box in place
// from the first frame.
//
// Every keyframe that moves is listed here with what it moves, and each of
// those was checked to be art. A new one fails this test until it is added
// with what it moves.

const CSS_FILES: ReadonlyArray<readonly [string, string]> = [
  ['src/app/styles.css', stylesCss],
  ['src/features/home/menu.css', menuCss],
  ['src/features/profile/profile.css', profileCss],
  ['src/features/heroes/calling.css', callingCss],
  ['src/features/profile/blocks/look/closet.css', closetCss],
  ['src/features/coop/coop.css', coopCss],
  ['src/features/lobby/lobby.css', lobbyCss],
]

const MOVING_ART: Readonly<Record<string, string>> = {
  // styles.css
  'hold-buy-shake':
    'the hold-to-buy button, which acts on pointerdown and its release, never on a click',
  'ghost-drag': 'the ghost stick thumb, a picture',
  'key-grab-toast': 'the key grab toast, text and icons',
  'quest-now': 'a quest step, a list item with no control',
  'quest-confetti': 'confetti',
  'start-wave-point-bob':
    'the arrow over START WAVE, aria-hidden art beside the button, never inside or holding it',
  // menu.css
  'play-shine': "the PLAY face's shine, a pseudo-element",
  'home-coop-bob': 'the CO-OP icon inside its button',
  'manor-pip-bob': 'the MORE badge',
  'hand-deal': "a MORE card's face, inside its button",
  'new-entry-pop': "NEW ENTRY's text, inside its button",
  'coffee-steam': 'steam art',
  'gift-rattle': "the gift's art, inside its button",
  'gift-twinkle': 'sparkles',
  'gift-lid-fly': "the gift's lid art",
  'gift-zombie-pop': 'the zombie art rising out of the gift, inside its button',
  'gift-burst': 'sparkles',
  'gift-tag-swing': "the gift's tag art",
  'gift-tag-wave': "the gift's tag art",
  'install-ring': "the install tile's ring, a pseudo-element",
  'install-bob': 'the install icon inside its button',
  'install-step-in': 'an install step and a greeting line, pictures and text',
  'install-step-turn': "an install step's picture",
  'greeting-confetti': 'confetti',
  'greeting-zombie': "the greeting's zombie art",
  'greeting-title': "the greeting's title text",
  'manor-peek': 'the MORE icon inside its button',
  'gear-tick': 'the gear icon inside its button',
  'pip-bounce': 'the MORE badge',
  'gift-bob': 'the gift badge on MENU, aria-hidden art',
  'turn-phone': 'the turn-the-phone icon',
  'end-button-pop': "an end button's icon and words, inside the button",
  'end-retry-spin': "RETRY's icon",
  // profile.css
  'tab-icon-pop': "a tab's icon, inside the tab",
  'dice-wiggle': "the dice's icon, inside its button",
  'look-bounce': 'the character preview sprite',
  'look-poof': 'the poof cloud',
  'look-slot': 'the character preview sprite',
  'look-section-hop': "a Look section's icon, inside its radio",
  'stone-rise': 'the name tombstone, carved text with no control',
  'name-slot': "the tombstone's letters",
  'device-in': 'a device in the Account list, an icon with no control',
  'dot-pulse': 'a sync dot',
  'portal-turn': "the link portal's rings and icon",
  'code-drop': "a link code's letters, aria-hidden art inside the code button",
  'code-copied':
    "the link code's COPIED! flash, aria-hidden text over the code button",
  'zap-left': 'the link animation',
  'zap-right': 'the link animation',
  'zap-strike': 'the link animation',
  'confirm-wobble': "the reset question's text, beside its buttons",
  // closet.css
  'closet-hop-a': "a bought look's face, inside its option",
  'closet-hop-b': "a bought look's face, inside its option",
  'closet-shake-a': "an option's price or padlock, inside its option",
  'closet-shake-b': "an option's price or padlock, inside its option",
  // coop/coop.css
  'coop-wobble': 'the co-op problem line, text and an icon',
  'coop-bob': "players' heads and icons",
  'coop-hop': "players' heads",
  'coop-stamp': 'the READY stamp and picked icons, aria-hidden',
  'coop-count': 'the countdown word',
  'coop-code-copied':
    "the room code's COPIED! flash, aria-hidden text over the code button",
  'coop-door-open': "the asking screen's door leaf, aria-hidden art",
  'coop-door-sway': "the asking screen's door leaf, aria-hidden art",
  'coop-walk':
    'heads walking to the door while a room is made, aria-hidden art',
  'coop-drop': "a QUICK PLAY seat's head as a player arrives",
  'coop-roll': "an empty QUICK PLAY seat's strip of heads, aria-hidden art",
  'coop-flip':
    "the room code's symbols, aria-hidden art inside the code button",
  'coop-poof': 'a dust puff in a lobby seat, aria-hidden art',
  'coop-poof-out': 'a dust puff in a lobby seat, aria-hidden art',
  // lobby/lobby.css
  'dare-unfold':
    "the dare card's fold, aria-hidden paper over the card: the card and its buttons stay put and fade in once it is open",
  'dare-fold-back':
    "the dare card's fold back into PLAY, aria-hidden paper, the card already gone and inert",
  'dare-flap-open': "the fold's bottom half, aria-hidden paper",
  'dare-flap-close': "the fold's bottom half, aria-hidden paper",
}

const MOVES =
  /(^|[\s;{])(transform|translate|scale|rotate|top|right|bottom|left|inset)\s*:/

const movingKeyframes = (css: string): ReadonlyArray<string> =>
  Array.map(
    Array.filter(
      Array.fromIterable(
        String.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)(css),
      ),
      ([, , body]) => MOVES.test(body ?? ''),
    ),
    ([, name]) => name ?? '',
  )

describe('animations that move', () => {
  const found = Array.flatMap(CSS_FILES, ([file, css]) =>
    Array.map(movingKeyframes(css), name => ({ file, name })),
  )

  test('reads every stylesheet', () => {
    expect(Array.filter(CSS_FILES, ([, css]) => css.length === 0)).toEqual([])
  })

  test('only move art, never a button or what holds one', () => {
    const unlisted = Array.map(
      Array.filter(found, ({ name }) => !(name in MOVING_ART)),
      ({ file, name }) => `${file}: @keyframes ${name}`,
    )
    expect(unlisted).toEqual([])
  })

  test('the list names only keyframes that still move', () => {
    const names = new Set(Array.map(found, ({ name }) => name))
    expect(
      Array.filter(Record.keys(MOVING_ART), name => !names.has(name)),
    ).toEqual([])
  })
})
