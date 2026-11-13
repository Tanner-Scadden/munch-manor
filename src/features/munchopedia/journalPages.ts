import { Array, Function, Option, Schema, String } from 'effect'
import { defineTaggedUnion } from 'foldkit/schema'

import { milestoneUnlockId } from '../../domain/journal'
import type { SavedJournal } from '../../shared/journalData'
import type { Calling } from '../../shared/playerData'
import type { SavedProof } from '../../shared/proofData'
import { DareKind } from '../../world/dare/dareSchema'
import {
  MILESTONES,
  MilestoneId,
  maybeOpenerOf,
} from '../../world/dare/milestones'
import {
  CELLAR_ROOM_ID,
  DINING_ROOM_ID,
  KITCHEN_ROOM_ID,
  LIBRARY_ROOM_ID,
  PARLOUR_ROOM_ID,
} from '../../world/level/plan'

// The Dare Journal's pages past the zombies (docs/PROGRESSION_PLAN.md,
// pillar B): the things, the rooms, the story, and the heroes, each filled
// in by doing, read off the saved journal (src/shared/journalData.ts) and
// the Proof Shelf. The story is guest book pages and Rattles' notes from
// 1924, a page per milestone (src/world/dare/milestones.ts) in its
// table's order, telling why the party never ended (LORE.md).

// THE TABS

export const JournalTab = Schema.Literals([
  'Zombies',
  'Things',
  'Rooms',
  'Story',
  'Heroes',
])
export type JournalTab = typeof JournalTab.Type

export const JOURNAL_TAB_NAMES: Readonly<Record<JournalTab, string>> = {
  Zombies: 'Zombies',
  Things: 'Things',
  Rooms: 'Rooms',
  Story: 'Story',
  Heroes: 'Heroes',
}

export const journalTabId = (tab: JournalTab): string =>
  `journal-tab-${String.toLowerCase(tab)}`

// THINGS

// NOTE: where a thing stands for the player: brought out (on the shelf at
// any difficulty), on the list but not found yet, or still locked behind
// the milestone that opens it.
export const ThingStanding = defineTaggedUnion({
  Found: {},
  Open: {},
  Locked: { milestone: MilestoneId },
})
export type ThingStanding = typeof ThingStanding.Type

export const JOURNAL_THINGS: Array.NonEmptyReadonlyArray<DareKind> =
  DareKind.literals

export const thingStanding: {
  (
    kind: DareKind,
  ): (
    facts: Readonly<{ journal: SavedJournal; proof: SavedProof }>,
  ) => ThingStanding
  (
    facts: Readonly<{ journal: SavedJournal; proof: SavedProof }>,
    kind: DareKind,
  ): ThingStanding
} = Function.dual(
  2,
  (
    facts: Readonly<{ journal: SavedJournal; proof: SavedProof }>,
    kind: DareKind,
  ): ThingStanding =>
    Array.some(facts.proof, entry => entry.thing === kind)
      ? ThingStanding.Found()
      : Option.match(maybeOpenerOf(kind), {
          onNone: () => ThingStanding.Open(),
          onSome: milestone =>
            Array.contains(facts.journal.milestones, milestone)
              ? ThingStanding.Open()
              : ThingStanding.Locked({ milestone }),
        }),
)

// ROOMS

type JournalRoom = Readonly<{ id: string; name: string; line: string }>

// NOTE: the house's rooms in the order a run meets them. The dining room
// is where every run starts, so its page is always filled.
export const JOURNAL_ROOMS: Array.NonEmptyReadonlyArray<JournalRoom> = [
  {
    id: DINING_ROOM_ID,
    name: 'Dining Room',
    line: 'Set for 200. Still waiting on dessert.',
  },
  {
    id: KITCHEN_ROOM_ID,
    name: 'Kitchen',
    line: 'Soup on the stove since 1924. Do not stir.',
  },
  {
    id: PARLOUR_ROOM_ID,
    name: 'Parlour',
    line: 'The gramophone still takes requests.',
  },
  {
    id: LIBRARY_ROOM_ID,
    name: 'Library',
    line: 'One red book is not a book.',
  },
  {
    id: CELLAR_ROOM_ID,
    name: 'Cellar',
    line: 'Dark. Damp. Something down here is breathing.',
  },
]

export const isRoomKnown: {
  (id: string): (journal: SavedJournal) => boolean
  (journal: SavedJournal, id: string): boolean
} = Function.dual(
  2,
  (journal: SavedJournal, id: string): boolean =>
    id === DINING_ROOM_ID || Array.contains(journal.roomsOpened, id),
)

// STORY

type StoryPage = Readonly<{
  source: string
  lines: Array.NonEmptyReadonlyArray<string>
}>

const GUEST_BOOK = 'Guest book'
const RATTLES_NOTE = "Rattles' note, 1924"

// NOTE: goofy-gory and short, plain sentences: what a guest or Rattles
// would scrawl. The last page waits behind an escape on Triple Dog Dare.
export const STORY_PAGES: Readonly<Record<MilestoneId, StoryPage>> = {
  FirstFind: {
    source: GUEST_BOOK,
    lines: [
      'The Munches throw a party. October 31, 1924.',
      'Dinner at eight. Dress up. Bring an appetite.',
      '212 guests signed in. Uncle Chunk signed twice.',
    ],
  },
  FirstEscape: {
    source: RATTLES_NOTE,
    lines: [
      'Dear whoever finds this. Name is Rattles.',
      'The kids in town dared me. Bring back proof, they said.',
      'Easy, I said. Then the door shut behind me.',
    ],
  },
  EveryRoomOpened: {
    source: GUEST_BOOK,
    lines: [
      "Grandma Munch's soup. Seconds for 200. Thirds for 199.",
      'Somebody locked the doors so nobody missed dessert.',
      'Dessert never came. Grandma said the house was hungry.',
    ],
  },
  ThingInEveryRoom: {
    source: RATTLES_NOTE,
    lines: [
      'Found the family deal, nailed under the cellar stairs.',
      'The house gets fed. The Munches live forever.',
      'Mostly forever. Uncle Chunk lost a finger. He did not notice.',
    ],
  },
  TenThings: {
    source: GUEST_BOOK,
    lines: [
      'Midnight. Nobody can find their coats.',
      'The music box plays the conga by itself.',
      'Mrs. Pell bit Mr. Pell. Everyone clapped. We thought it was a game.',
    ],
  },
  EscapeDoubleDare: {
    source: RATTLES_NOTE,
    lines: [
      'Day 40. Hungry. Not for food. That is new.',
      'The guests stopped blinking. They still say please.',
      'I hide in a trunk by the front door. Good view. Bad smell.',
    ],
  },
  ChunkTripleDare: {
    source: GUEST_BOOK,
    lines: [
      'Uncle Chunk swallowed the big key at the toast.',
      'A good host sees his guests out. He just will not.',
      'Desserts eaten since: 4,012. All of them daredevils.',
    ],
  },
  EscapeTripleDogDare: {
    source: RATTLES_NOTE,
    lines: [
      'If you are reading this, you got out. Show-off.',
      'The party ends when the last guest leaves. Nobody leaves.',
      'So go home. Tell the kids in town: I dare you.',
    ],
  },
}

export const STORY_ORDER: Array.NonEmptyReadonlyArray<MilestoneId> = Array.map(
  MILESTONES,
  ({ id }) => id,
)

export const storyPageNumber = (id: MilestoneId): number =>
  Option.getOrElse(
    Array.findFirstIndex(STORY_ORDER, page => page === id),
    () => 0,
  ) + 1

export const isPageOpen: {
  (id: MilestoneId): (journal: SavedJournal) => boolean
  (journal: SavedJournal, id: MilestoneId): boolean
} = Function.dual(2, (journal: SavedJournal, id: MilestoneId): boolean =>
  Array.contains(journal.milestones, id),
)

// NOTE: the page the Story tab opens on: the first one new since the
// journal last opened, or else the first.
export const firstStoryPage = (fresh: ReadonlyArray<string>): MilestoneId =>
  Option.getOrElse(
    Array.findFirst(STORY_ORDER, id =>
      Array.contains(fresh, milestoneUnlockId(id)),
    ),
    () => Array.headNonEmpty(STORY_ORDER),
  )

export const isFreshPage: {
  (id: MilestoneId): (fresh: ReadonlyArray<string>) => boolean
  (fresh: ReadonlyArray<string>, id: MilestoneId): boolean
} = Function.dual(2, (fresh: ReadonlyArray<string>, id: MilestoneId): boolean =>
  Array.contains(fresh, milestoneUnlockId(id)),
)

const TAB_FRESHNESS: Readonly<
  Record<JournalTab, (fresh: ReadonlyArray<string>) => boolean>
> = {
  Zombies: () => false,
  Things: fresh =>
    Array.some(
      MILESTONES,
      ({ id, maybeThing }) =>
        Option.isSome(maybeThing) && isFreshPage(fresh, id),
    ),
  Rooms: () => false,
  Story: fresh => Array.some(STORY_ORDER, id => isFreshPage(fresh, id)),
  Heroes: () => false,
}

// NOTE: whether a tab has something new: a story page on Story, a thing a
// new milestone opened on Things.
export const isTabFresh: {
  (tab: JournalTab): (fresh: ReadonlyArray<string>) => boolean
  (fresh: ReadonlyArray<string>, tab: JournalTab): boolean
} = Function.dual(2, (fresh: ReadonlyArray<string>, tab: JournalTab): boolean =>
  TAB_FRESHNESS[tab](fresh),
)

// HEROES

// NOTE: each hero's reason for taking the dare (LORE.md, "Heroes and
// bots"), shown once the player has played a run as them.
export const HERO_REASONS: Readonly<Record<Calling, string>> = {
  You: 'Your friends dared you. That is the whole reason.',
  Handyman: 'The town paid him to board the place up. From the inside.',
  TrackStar: 'Fastest kid in school. Dared to run straight through.',
  PennyPincher: 'Heard about the Munch silver. Brought a big bag.',
  LineCook: "Wants Grandma Munch's soup recipe. Will not say why.",
}

export const isHeroKnown: {
  (calling: Calling): (journal: SavedJournal) => boolean
  (journal: SavedJournal, calling: Calling): boolean
} = Function.dual(2, (journal: SavedJournal, calling: Calling): boolean =>
  Array.contains(journal.heroesPlayed, calling),
)
