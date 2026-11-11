// The studio's left side: the library's tabs, each with an icon from the
// game's own art, and the display settings as segmented controls, swatches,
// and switches. It redraws only when one of them changes.
import { Array, Function, Option, String } from 'effect'
import { Canvas } from 'foldkit'
import { type Html, createLazy } from 'foldkit/html'

import type { Facing } from '../../src/art/sprite'
import {
  Backdrop,
  Message,
  type Model,
  type StudioViewBuilder,
  ZOOMS,
} from './block'
import { Tab, Tone, sectionsOf, tabIconOf } from './catalog'
import {
  BACKDROP_COLORS,
  padded,
  sizeOf,
  spritesBounds,
  zoomed,
} from './drawing'
import {
  HOUSES,
  type RoomView,
  StudioRoom,
  isRoomTarget,
  isToggleOn,
  roomToggleOf,
} from './room'

const ICON_BOX = 22

const ROOM_LABELS: Readonly<Record<StudioRoom, string>> = {
  Manor: 'Manor',
  Dining: 'Dining',
  Parlour: 'Parlour',
  Library: 'Library',
  Cellar: 'Cellar',
}

const TONE_LABELS: Readonly<Record<Tone, string>> = {
  Normal: 'Normal',
  Flash: 'Hit',
  Lit: 'Lit',
  Rage: 'Angry',
}

// NOTE: a tab's icon scaled to fit its box, the same size for every tab.
const iconView = (tab: Tab, h: StudioViewBuilder): Html => {
  const sprite = tabIconOf(tab)
  const bounds = padded(spritesBounds([sprite]))
  const fit = Math.max(
    1,
    Math.floor(
      ICON_BOX /
        Math.max(bounds.right - bounds.left, bounds.bottom - bounds.top),
    ),
  )
  const { width, height } = sizeOf(bounds, fit)
  return h.span(
    [h.Class('nav-icon')],
    [
      Canvas.view(
        {
          key: `icon-${tab}`,
          width,
          height,
          shapes: [zoomed(sprite, bounds, fit)],
          className: 'sprite',
        },
        h,
      ),
    ],
  )
}

type Choice = Readonly<{
  label: string
  isOn: boolean
  message: Message
  title?: string
}>

const segmented = (
  choices: ReadonlyArray<Choice>,
  h: StudioViewBuilder,
): Html =>
  h.div(
    [h.Class('segmented'), h.Role('group')],
    Array.map(choices, choice =>
      h.button(
        [
          h.Class(choice.isOn ? 'segment on' : 'segment'),
          h.AriaPressed(choice.isOn ? 'true' : 'false'),
          h.Title(choice.title ?? choice.label),
          h.OnClick(choice.message),
        ],
        [choice.label],
      ),
    ),
  )

const switchRow = (
  label: string,
  isOn: boolean,
  message: Message,
  h: StudioViewBuilder,
): Html =>
  h.button(
    [
      h.Class('switch-row'),
      h.Role('switch'),
      h.AriaChecked(isOn),
      h.OnClick(message),
    ],
    [
      h.span([], [label]),
      h.span([h.Class(isOn ? 'switch on' : 'switch')], [h.span([])]),
    ],
  )

const field = (label: string, control: Html, h: StudioViewBuilder): Html =>
  h.div(
    [h.Class('field')],
    [h.span([h.Class('field-label')], [label]), control],
  )

const swatches = (backdrop: Backdrop, h: StudioViewBuilder): Html =>
  h.div(
    [h.Class('swatches'), h.Role('group')],
    Array.map(Backdrop.literals, choice =>
      h.button([
        h.Class(choice === backdrop ? 'swatch on' : 'swatch'),
        h.AriaPressed(choice === backdrop ? 'true' : 'false'),
        h.AriaLabel(`${choice} background`),
        h.Title(choice),
        h.Style({ background: BACKDROP_COLORS[choice] }),
        h.OnClick(Message.ClickedBackdrop({ backdrop: choice })),
      ]),
    ),
  )

const navView = (tab: Tab, freshTabs: string, h: StudioViewBuilder): Html =>
  h.div(
    [h.Class('nav')],
    Array.map(Tab.literals, choice =>
      h.button(
        [
          h.Key(choice),
          h.Class(choice === tab ? 'nav-item on' : 'nav-item'),
          h.AriaPressed(choice === tab ? 'true' : 'false'),
          h.OnClick(Message.ClickedTab({ tab: choice })),
        ],
        [
          iconView(choice, h),
          h.span([h.Class('nav-label')], [choice]),
          ...(String.includes(choice)(freshTabs)
            ? [
                h.span([
                  h.Class('nav-dot'),
                  h.Title('Something here was updated'),
                ]),
              ]
            : []),
        ],
      ),
    ),
  )

const sidebarBody = (
  tab: Tab,
  zoom: number,
  backdrop: Backdrop,
  facing: Facing,
  tone: Tone,
  isPlaying: boolean,
  roomView: RoomView,
  isGridOn: boolean,
  freshTabs: string,
  h: StudioViewBuilder,
): Html =>
  h.nav(
    [h.Class('sidebar')],
    [
      h.div(
        [h.Class('brand')],
        [
          h.span([h.Class('brand-mark')], ['M']),
          h.div(
            [],
            [
              h.p([h.Class('brand-name')], ['Munch Studio']),
              h.p([h.Class('brand-sub')], ['The game’s art, up close']),
            ],
          ),
        ],
      ),
      h.p([h.Class('section-label')], ['Library']),
      navView(tab, freshTabs, h),
      h.p([h.Class('section-label')], ['Display']),
      field(
        'Size',
        segmented(
          Array.map(ZOOMS, choice => ({
            label: `${choice}×`,
            isOn: choice === zoom,
            message: Message.ClickedZoom({ zoom: choice }),
          })),
          h,
        ),
        h,
      ),
      field('Background', swatches(backdrop, h), h),
      ...(tab === 'Rooms'
        ? [
            field(
              'Room',
              segmented(
                Array.map(StudioRoom.literals, room => ({
                  label: ROOM_LABELS[room],
                  isOn: room === roomView.room,
                  message: Message.ClickedRoom({ room }),
                })),
                h,
              ),
              h,
            ),
            ...Option.match(roomToggleOf(roomView.room), {
              onNone: () => [],
              onSome: toggle => [
                field(
                  toggle.label,
                  segmented(
                    [
                      {
                        label: toggle.off,
                        isOn: !isToggleOn(roomView),
                        message: Message.ClickedRoomToggle(),
                      },
                      {
                        label: toggle.on,
                        isOn: isToggleOn(roomView),
                        message: Message.ClickedRoomToggle(),
                      },
                    ],
                    h,
                  ),
                  h,
                ),
              ],
            }),
            ...(roomView.room === 'Manor'
              ? [
                  field(
                    'House',
                    segmented(
                      Array.map(HOUSES, ({ house, label }) => ({
                        label,
                        isOn: house === roomView.house,
                        message: Message.ClickedHouse({ house }),
                      })),
                      h,
                    ),
                    h,
                  ),
                ]
              : []),
            switchRow('Tile grid', isGridOn, Message.ClickedGrid(), h),
          ]
        : [
            field(
              'Facing',
              segmented(
                [
                  {
                    label: '← Left',
                    isOn: facing === 'Left',
                    message: Message.ClickedFacing({ facing: 'Left' }),
                  },
                  {
                    label: 'Right →',
                    isOn: facing === 'Right',
                    message: Message.ClickedFacing({ facing: 'Right' }),
                  },
                ],
                h,
              ),
              h,
            ),
            field(
              'Look',
              segmented(
                Array.map(Tone.literals, choice => ({
                  label: TONE_LABELS[choice],
                  isOn: choice === tone,
                  message: Message.ClickedTone({ tone: choice }),
                  title:
                    choice === 'Flash'
                      ? 'The white flash when it gets hit'
                      : choice === 'Rage'
                        ? 'Red eyes in a frenzy'
                        : choice,
                })),
                h,
              ),
              h,
            ),
            switchRow('Animate', isPlaying, Message.ClickedPlay(), h),
          ]),
      h.p(
        [h.Class('sidebar-foot')],
        ['When Claude changes the art, it shows up here by itself.'],
      ),
    ],
  )

// NOTE: the tabs holding something Claude changed that has not been looked
// at since, as one string the lazy sidebar can compare.
const freshTabsOf = (model: Model): string =>
  Array.join(
    Array.filter(Tab.literals, tab =>
      Array.some(
        model.notes,
        note =>
          note.status === 'Done' &&
          !Array.contains(model.seenDone, note.noteId) &&
          (tab === 'Rooms'
            ? isRoomTarget(note.targetId)
            : Array.some(sectionsOf(tab), section =>
                Array.some(
                  section.entries,
                  entry => entry.id === note.targetId,
                ),
              )),
      ),
    ),
    ',',
  )

// NOTE: one value the lazy sidebar can compare, rebuilt only when the room
// or its toggles change.
const roomViews = new Map<string, RoomView>()

const roomViewOf = (model: Model): RoomView => {
  const key = `${model.room}:${model.isKitchenOpen}:${model.house}:${model.isTwistOn}`
  const kept = roomViews.get(key)
  if (kept !== undefined) {
    return kept
  }
  const view: RoomView = {
    room: model.room,
    isKitchenOpen: model.isKitchenOpen,
    house: model.house,
    isTwistOn: model.isTwistOn,
  }
  roomViews.set(key, view)
  return view
}

const lazySidebar = createLazy()

export const sidebarView: {
  (h: StudioViewBuilder): (model: Model) => Html
  (model: Model, h: StudioViewBuilder): Html
} = Function.dual(
  2,
  (model: Model, h: StudioViewBuilder): Html =>
    lazySidebar(sidebarBody, [
      model.tab,
      model.zoom,
      model.backdrop,
      model.facing,
      model.tone,
      model.isPlaying,
      roomViewOf(model),
      model.isGridOn,
      freshTabsOf(model),
      h,
    ]) ?? h.nav([]),
)
