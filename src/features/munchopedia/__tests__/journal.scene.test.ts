import { Scene } from 'foldkit'
import { modifyFields } from 'foldkit/struct'

import { describe, it } from '@effect/vitest'

import type { Model } from '../../../app/model'
import { milestoneUnlockId } from '../../../domain/journal'
import { noJournal } from '../../../shared/journalData'
import { home } from '../../../test/model.fixture'
import {
  APPLICATION,
  measureSurface,
  munchopediaDialog,
  openHandInScene,
  pickCardInScene,
} from '../../../test/testing'
import { DARE_LINES, DARE_NAMES, STORY_TITLES } from '../../../world/names'
import { JOURNAL_ROOMS, STORY_PAGES } from '../journalPages'

// The Dare Journal's pages past the zombies, from the MANOR hand: the
// things (found, open, or locked behind a milestone's few words), the
// rooms opened, the story's pages, and the heroes played.

const JOURNAL = /^Dare Journal:/

const tab = (name: string) =>
  Scene.role('button', { name: new RegExp(`^${name}`) })

const openJournal = () => [
  measureSurface,
  ...openHandInScene(),
  ...pickCardInScene(JOURNAL),
]

// NOTE: a player who found the spoon on Normal, escaped once (so the napkin
// ring is open but not found), opened the kitchen, and played as YOU.
const veteran: Model = modifyFields(home, {
  journal: () => ({
    ...noJournal,
    milestones: ['FirstFind', 'FirstEscape'],
    roomsOpened: ['Kitchen'],
    heroesPlayed: ['You'],
    thingsFound: 1,
  }),
  proof: () => [
    {
      thing: 'SilverSpoon',
      difficulty: 'Normal',
      stamp: { wave: 6, hero: 'You', crew: [], day: null, ending: 'Munched' },
    },
  ],
  seenUnlocks: seen => [...seen, milestoneUnlockId('FirstFind')],
})

describe('the Dare Journal', () => {
  it.effect(
    'Things shows a find by name, an open thing as ???, and a locked one with its milestone',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(veteran),
        ...openJournal(),
        Scene.inside(
          munchopediaDialog,
          Scene.click(tab('Things')),
          Scene.inside(
            Scene.role('list', { name: 'Things' }),
            Scene.expect(Scene.text(DARE_NAMES.SilverSpoon)).toExist(),
            Scene.expect(Scene.text(DARE_LINES.SilverSpoon)).toExist(),
            Scene.expect(Scene.text(DARE_NAMES.NapkinRing)).not.toExist(),
            Scene.expect(Scene.text('Find 10 things')).toExist(),
            Scene.expect(Scene.text('Escape on Triple Dog Dare')).not.toExist(),
            Scene.expectAll(Scene.all.role('listitem')).toHaveCount(10),
          ),
        ),
      ),
  )

  it.effect(
    'Rooms names the dining room and the rooms opened, ??? the rest',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(veteran),
        ...openJournal(),
        Scene.inside(
          munchopediaDialog,
          Scene.click(tab('Rooms')),
          Scene.inside(
            Scene.role('list', { name: 'Rooms' }),
            Scene.expect(Scene.text('Dining Room')).toExist(),
            Scene.expect(Scene.text('Kitchen')).toExist(),
            Scene.expect(Scene.text('Cellar')).not.toExist(),
            Scene.expectAll(Scene.all.role('listitem')).toHaveCount(
              JOURNAL_ROOMS.length,
            ),
          ),
        ),
      ),
  )

  it.effect(
    'Story opens on the new page, reads it, and a locked page shows its milestone',
    () =>
      Scene.scene(
        APPLICATION,
        Scene.given(veteran),
        ...openJournal(),
        Scene.inside(
          munchopediaDialog,
          Scene.expect(tab('Story')).toHaveText(/NEW/),
          Scene.click(tab('Story')),
          Scene.expect(
            Scene.role('heading', { name: STORY_TITLES.FirstEscape }),
          ).toExist(),
          Scene.expect(Scene.text(STORY_PAGES.FirstEscape.lines[0])).toExist(),
          Scene.click(Scene.role('button', { name: 'Page 1, The Party' })),
          Scene.expect(
            Scene.role('heading', { name: STORY_TITLES.FirstFind }),
          ).toExist(),
          Scene.click(Scene.role('button', { name: 'Page 8, locked' })),
          Scene.expect(Scene.role('heading', { name: 'Page 8' })).toExist(),
          Scene.expect(Scene.text('Escape on Triple Dog Dare')).toExist(),
        ),
      ),
  )

  it.effect('Heroes gives the reason of a hero played, ??? for the rest', () =>
    Scene.scene(
      APPLICATION,
      Scene.given(veteran),
      ...openJournal(),
      Scene.inside(
        munchopediaDialog,
        Scene.click(tab('Heroes')),
        Scene.inside(
          Scene.role('list', { name: 'Heroes' }),
          Scene.expect(
            Scene.text('Your friends dared you. That is the whole reason.'),
          ).toExist(),
          Scene.expectAll(Scene.all.text('???')).toHaveCount(4),
        ),
      ),
    ),
  )
})
