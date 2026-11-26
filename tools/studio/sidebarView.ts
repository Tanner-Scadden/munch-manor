import { Array, Function, Option, String } from 'effect'

import type { Facing } from '../../src/art/sprite'
import {
  Backdrop,
  Message,
  type Model,
  type StudioH,
  type StudioHtml,
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
  LiveBodies,
  LiveMood,
  type LiveScene,
  LiveSpot,
  LiveTool,
} from './liveScene'
import { studioPicture } from './picture'
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
  Live: '3D',
  Manor: 'Manor',
  Dining: 'Dining',
  Parlour: 'Parlour',
  Library: 'Library',
  Cellar: 'Cellar',
}

const MOOD_TITLES: Readonly<Record<LiveMood, string>> = {
  Break: 'A break: warm light',
  Wave: 'Early in a wave',
  Late: 'A wave at its hottest',
  Frenzy: 'A frenzy',
  Boss: 'Uncle Chunk in the house',
}

const TOOL_LABELS: Readonly<Record<LiveTool, string>> = {
  Pin: '📌 Pin',
  Loupe: '🔍 Loupe',
}

const liveControls = (
  live: LiveScene,
  liveTool: LiveTool,
  h: StudioH,
): ReadonlyArray<StudioHtml> => {
  const pick = (change: Partial<LiveScene>) =>
    Message.ClickedLive({ live: { ...live, ...change } })
  return [
    field(
      'Look with',
      segmented(
        Array.map(LiveTool.literals, tool => ({
          label: TOOL_LABELS[tool],
          isOn: tool === liveTool,
          message: Message.ClickedLiveTool({ tool }),
        })),
        h,
      ),
      h,
    ),
    field(
      'Stand in',
      segmented(
        Array.map(LiveSpot.literals, spot => ({
          label: spot,
          isOn: spot === live.spot,
          message: pick({ spot }),
        })),
        h,
      ),
      h,
    ),
    field(
      'Mood',
      segmented(
        Array.map(LiveMood.literals, mood => ({
          label: mood,
          isOn: mood === live.mood,
          message: pick({ mood }),
          title: MOOD_TITLES[mood],
        })),
        h,
      ),
      h,
    ),
    field(
      'Zombies',
      segmented(
        Array.map(LiveBodies.literals, bodies => ({
          label: bodies,
          isOn: bodies === live.bodies,
          message: pick({ bodies }),
        })),
        h,
      ),
      h,
    ),
    switchRow(
      'Lightning strike',
      live.isStrike,
      pick({ isStrike: !live.isStrike }),
      h,
    ),
    switchRow(
      'Chandelier down',
      live.isFallen,
      pick({ isFallen: !live.isFallen }),
      h,
    ),
    switchRow('Hold still', live.isStill, pick({ isStill: !live.isStill }), h),
    switchRow('HUD', live.isHudOn, pick({ isHudOn: !live.isHudOn }), h),
  ]
}

const TONE_LABELS: Readonly<Record<Tone, string>> = {
  Normal: 'Normal',
  Flash: 'Hit',
  Lit: 'Lit',
  Rage: 'Angry',
}

const iconView = (tab: Tab, h: StudioH): StudioHtml => {
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
  return h.span.class('nav-icon').children(
    studioPicture(h)
      .class('sprite')
      .picture({
        key: `icon-${tab}`,
        width,
        height,
        shapes: [zoomed(sprite, bounds, fit)],
      }),
  )
}

type Choice = Readonly<{
  label: string
  isOn: boolean
  message: Message
  title?: string
}>

const segmented = (choices: ReadonlyArray<Choice>, h: StudioH): StudioHtml =>
  h.div
    .class('segmented')
    .attr('role', 'group')
    .children(
      Array.map(choices, choice =>
        h.button
          .class(choice.isOn ? 'segment on' : 'segment')
          .attr('aria-pressed', choice.isOn ? 'true' : 'false')
          .attr('title', choice.title ?? choice.label)
          .on('click', choice.message)
          .children(choice.label),
      ),
    )

const switchRow = (
  label: string,
  isOn: boolean,
  message: Message,
  h: StudioH,
): StudioHtml =>
  h.button
    .class('switch-row')
    .attr('role', 'switch')
    .attr('aria-checked', isOn ? 'true' : 'false')
    .on('click', message)
    .children(
      h.span.children(label),
      h.span.class(isOn ? 'switch on' : 'switch').children(h.span),
    )

const field = (label: string, control: StudioHtml, h: StudioH): StudioHtml =>
  h.div
    .class('field')
    .children(h.span.class('field-label').children(label), control)

const swatches = (backdrop: Backdrop, h: StudioH): StudioHtml =>
  h.div
    .class('swatches')
    .attr('role', 'group')
    .children(
      Array.map(Backdrop.literals, choice =>
        h.button
          .class(choice === backdrop ? 'swatch on' : 'swatch')
          .attr('aria-pressed', choice === backdrop ? 'true' : 'false')
          .attr('aria-label', `${choice} background`)
          .attr('title', choice)
          .style({ background: BACKDROP_COLORS[choice] })
          .on('click', Message.ClickedBackdrop({ backdrop: choice })),
      ),
    )

const navView = (tab: Tab, freshTabs: string, h: StudioH): StudioHtml =>
  h.div.class('nav').children(
    Array.map(Tab.literals, choice =>
      h.button
        .key(choice)
        .class(choice === tab ? 'nav-item on' : 'nav-item')
        .attr('aria-pressed', choice === tab ? 'true' : 'false')
        .on('click', Message.ClickedTab({ tab: choice }))
        .children(
          iconView(choice, h),
          h.span.class('nav-label').children(choice),
          ...(String.includes(choice)(freshTabs)
            ? [
                h.span
                  .class('nav-dot')
                  .attr('title', 'Something here was updated'),
              ]
            : []),
        ),
    ),
  )

const sidebarBody = (
  h: StudioH,
  tab: Tab,
  zoom: number,
  backdrop: Backdrop,
  facing: Facing,
  tone: Tone,
  isPlaying: boolean,
  roomView: RoomView,
  isGridOn: boolean,
  live: LiveScene,
  liveTool: LiveTool,
  freshTabs: string,
): StudioHtml =>
  h.nav.class('sidebar').children(
    h.div
      .class('brand')
      .children(
        h.span.class('brand-mark').children('M'),
        h.div.children(
          h.p.class('brand-name').children('Munch Studio'),
          h.p.class('brand-sub').children('The game’s art, up close'),
        ),
      ),
    h.p.class('section-label').children('Library'),
    navView(tab, freshTabs, h),
    h.p.class('section-label').children('Display'),
    ...(tab === 'Rooms' && roomView.room === 'Live'
      ? []
      : [
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
        ]),
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
          ...(roomView.room === 'Live' ? liveControls(live, liveTool, h) : []),
          ...(roomView.room === 'Manor' || roomView.room === 'Live'
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
    h.p
      .class('sidebar-foot')
      .children('When Claude changes the art, it shows up here by itself.'),
  )

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

export const sidebarView: {
  (model: Model): (h: StudioH) => StudioHtml
  (h: StudioH, model: Model): StudioHtml
} = Function.dual(2, (h: StudioH, model: Model): StudioHtml =>
  h.lazy(
    sidebarBody,
    model.tab,
    model.zoom,
    model.backdrop,
    model.facing,
    model.tone,
    model.isPlaying,
    roomViewOf(model),
    model.isGridOn,
    model.live,
    model.liveTool,
    freshTabsOf(model),
  ),
)
