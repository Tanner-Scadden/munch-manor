import { describe, expect, test } from 'vitest'

import coopCss from './coop/coop.css?raw'
import menuCss from './menu.css?raw'
import profileCss from './profile.css?raw'
import shopCss from './shop.css?raw'
import stylesCss from './styles.css?raw'

// NOTE: a press lands where a button is when the finger goes down and
// comes up. A button that slides, grows, or spins into place while a player
// taps it is somewhere else by then, so the press missed or hit what was
// behind it. So an animation that moves an element (transform, translate,
// scale, or rotate) may only run on art: an icon or a face inside a
// button, a badge, a particle, a sprite. A button, and anything holding
// one, comes in by fading, glowing, or flashing, with its box in place
// from the first frame.
//
// Every keyframe that moves is listed here with what it moves, and each of
// those was checked to be art. A new one fails this test until it is added
// with what it moves.

const CSS_FILES: ReadonlyArray<readonly [string, string]> = [
  ['src/styles.css', stylesCss],
  ['src/menu.css', menuCss],
  ['src/profile.css', profileCss],
  ['src/shop.css', shopCss],
  ['src/coop/coop.css', coopCss],
]

const MOVING_ART: Readonly<Record<string, string>> = {
  // styles.css
  'hold-buy-shake':
    'the hold-to-buy button, which acts on pointerdown and its release, never on a click',
  'ghost-drag': 'the ghost stick thumb, a picture',
  'key-grab-toast': 'the key grab toast, text and icons',
  'quest-now': 'a quest step, a list item with no control',
  'quest-confetti': 'confetti',
  // menu.css
  'play-shine': "the PLAY face's shine, a pseudo-element",
  'home-coop-bob': 'the CO-OP icon inside its button',
  'home-coop-nope': 'the CO-OP padlock inside its button',
  'manor-pip-bob': 'the MORE badge',
  'hand-deal': "a MORE card's face, inside its button",
  'new-entry-pop': "NEW ENTRY's text, inside its button",
  'coffee-steam': 'steam art',
  'gift-rattle': "the gift's art, inside its button",
  'gift-twinkle': 'sparkles',
  'gift-lid-fly': "the gift's lid art",
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
  'code-drop': "a link code's letters",
  'zap-left': 'the link animation',
  'zap-right': 'the link animation',
  'zap-strike': 'the link animation',
  'confirm-wobble': "the reset question's text, beside its buttons",
  // shop.css
  'shop-new-bob': "a tab's NEW badge",
  'shop-rise': 'the upgrade arrow art',
  'shop-stamp': 'the SOLD stamp',
  'shop-coin': 'coins',
  'shop-nope': 'the refusal mark, aria-hidden',
  'shop-bump': 'the wallet text',
  'shop-bob': "Rattles' face",
  'shop-hop': "Rattles' face",
  'shop-droop': "Rattles' face",
  'shop-tilt': "Rattles' face",
  // coop/coop.css
  'coop-wobble': 'the co-op problem line, text and an icon',
  'coop-bob': "players' heads and icons",
  'coop-hop': "players' heads",
  'coop-stamp': 'the READY stamp and picked icons, aria-hidden',
  'coop-count': 'the countdown word',
  'coop-code-copied':
    "the room code's COPIED! flash, aria-hidden text over the code button",
}

const MOVES = /(^|[\s;{])(transform|translate|scale|rotate)\s*:/

const movingKeyframes = (css: string): ReadonlyArray<string> =>
  [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?)\n\}/g)]
    .filter(([, , body]) => MOVES.test(body ?? ''))
    .map(([, name]) => name ?? '')

describe('animations that move', () => {
  const found = CSS_FILES.flatMap(([file, css]) =>
    movingKeyframes(css).map(name => ({ file, name })),
  )

  test('reads every stylesheet', () => {
    expect(CSS_FILES.filter(([, css]) => css.length === 0)).toEqual([])
  })

  test('only move art, never a button or what holds one', () => {
    const unlisted = found
      .filter(({ name }) => !(name in MOVING_ART))
      .map(({ file, name }) => `${file}: @keyframes ${name}`)
    expect(unlisted).toEqual([])
  })

  test('the list names only keyframes that still move', () => {
    const names = new Set(found.map(({ name }) => name))
    expect(Object.keys(MOVING_ART).filter(name => !names.has(name))).toEqual([])
  })
})
