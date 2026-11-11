import { Function, Option, String } from 'effect'
import { Canvas } from 'foldkit'
import type { Html } from 'foldkit/html'

import type { ApplicationViewBuilder } from '../../app/composition'
import type { Model } from '../../app/model'
import {
  CARD_ARROW,
  CASE_ART,
  CASE_HEIGHT,
  CASE_WIDTH,
  PRIZE_SPRITES,
} from '../../art/caseArt'
import { type BakedText, bakeText, placeBaked } from '../../art/font'
import { group, placeAt } from '../../art/sprite'
import { CaseCard } from '../../domain/clientSchema'
import { featLockShapes } from '../../render/featLockView'
import { LANDSCAPE_SIZE } from '../../render/screen'
import { caseLookOf } from '../../world/feats/caseSpots'
import { levelOf } from '../../world/level/arena'
import { DISPLAY_CASE_NAME } from '../../world/names'
import { focusOf } from '../../world/party/party'
import type { DisplayCase } from '../../world/schema/worldSchema'
import { clamp } from '../../world/step/geometry'
import { CASE_CARD_MS, canSkipCaseCard, maybeCardCase } from './caseCard'
import { OnboardingMessage } from './message'

// The display case's first-time card (src/features/onboarding/caseCard.ts)
// on screen, in the new zombie card's style: a band across the landscape
// frame with DISPLAY CASE over the case's own feat lock, filled to the
// player's progress with its count, an arrow, and the case itself drawn
// big with its prize behind the glass, then one short line. Show, don't
// explain: do this, win that. Its button is HTML, over the band.

const CENTER_X = LANDSCAPE_SIZE.width / 2
const CARD_TOP = 40
const CARD_BOTTOM = 136
const CARD_FILL = 'rgba(24, 14, 22, 0.94)'
const CARD_EDGE = '#ff8a3d'
const CARD_DIM = 'rgba(8, 10, 12, 0.4)'
const ART_SCALE = 2
const ART_MIDDLE_Y = 82
const LOCK_X = CENTER_X - 48
const ARROW_X = CENTER_X + 18
const CASE_LEFT = CENTER_X + 34
const TITLE_Y = CARD_TOP + 6
const LINE_Y = 115
const TIMER_Y = 128
const TIMER_WIDTH = 96
const TIMER_BACK = 'rgba(255, 138, 61, 0.25)'
const TITLE_SCALE = 2

const TITLE: BakedText = bakeText(
  String.toUpperCase(DISPLAY_CASE_NAME),
  'Title',
)
const LINE: BakedText = bakeText("DO THE DEED. WIN WHAT'S INSIDE.", 'Plain')

const centered = (baked: BakedText, y: number, scale = 1): Canvas.Shape =>
  placeBaked(baked, { x: CENTER_X, y, align: 'Center', scale })

// NOTE: a dim over the whole screen, past the landscape frame, as the new
// zombie card's, so it dims the HUD band in portrait too.
const DIM = Canvas.Rect({
  x: -LANDSCAPE_SIZE.width,
  y: -LANDSCAPE_SIZE.height * 2,
  width: LANDSCAPE_SIZE.width * 3,
  height: LANDSCAPE_SIZE.height * 5,
  fill: CARD_DIM,
})

const BAND: ReadonlyArray<Canvas.Shape> = [
  Canvas.Rect({
    x: 0,
    y: CARD_TOP - 1,
    width: LANDSCAPE_SIZE.width,
    height: CARD_BOTTOM - CARD_TOP + 2,
    fill: CARD_EDGE,
  }),
  Canvas.Rect({
    x: 0,
    y: CARD_TOP,
    width: LANDSCAPE_SIZE.width,
    height: CARD_BOTTOM - CARD_TOP,
    fill: CARD_FILL,
  }),
]

const timerShapes = (ageMs: number): ReadonlyArray<Canvas.Shape> => {
  const left = CENTER_X - TIMER_WIDTH / 2
  return [
    Canvas.Rect({
      x: left,
      y: TIMER_Y,
      width: TIMER_WIDTH,
      height: 2,
      fill: TIMER_BACK,
    }),
    Canvas.Rect({
      x: left,
      y: TIMER_Y,
      width: Math.round(TIMER_WIDTH * clamp(1 - ageMs / CASE_CARD_MS, 0, 1)),
      height: 2,
      fill: CARD_EDGE,
    }),
  ]
}

// NOTE: the case as it stands, locked: its body, its prize, and its glass.
const bigCaseShapes = (
  model: Model,
  displayCase: DisplayCase,
): Canvas.Shape => {
  const art = CASE_ART[caseLookOf(levelOf(model), displayCase)]
  return group({
    translate: {
      x: CASE_LEFT,
      y: ART_MIDDLE_Y - (CASE_HEIGHT * ART_SCALE) / 2,
    },
    scale: { x: ART_SCALE, y: ART_SCALE },
    shapes: [
      placeAt(0, 0, art.body),
      placeAt(
        CASE_WIDTH / 2,
        art.prizeDropPx,
        PRIZE_SPRITES[displayCase.prize],
      ),
      placeAt(0, 0, art.front),
    ],
  })
}

const cardShapes = (
  model: Model,
  displayCase: DisplayCase,
  ageMs: number,
): ReadonlyArray<Canvas.Shape> => [
  DIM,
  ...BAND,
  centered(TITLE, TITLE_Y, TITLE_SCALE),
  group({
    translate: { x: LOCK_X, y: ART_MIDDLE_Y },
    scale: { x: ART_SCALE, y: ART_SCALE },
    shapes: featLockShapes(displayCase.feat, focusOf(model), {
      x: 0,
      y: 0,
      countSide: 'Right',
      countShows: 'Always',
    }),
  }),
  group({
    translate: { x: ARROW_X, y: ART_MIDDLE_Y },
    scale: { x: ART_SCALE, y: ART_SCALE },
    shapes: CARD_ARROW,
  }),
  bigCaseShapes(model, displayCase),
  centered(LINE, LINE_Y),
  ...timerShapes(ageMs),
]

// NOTE: in the landscape frame, over the round's overlay.
export const caseCardShapes = (model: Model): ReadonlyArray<Canvas.Shape> =>
  CaseCard.match(model.caseCard, {
    Hidden: () => [],
    Showing: ({ ageMs }) =>
      Option.match(maybeCardCase(model), {
        onNone: () => [],
        onSome: displayCase => cardShapes(model, displayCase, ageMs),
      }),
  })

// THE BUTTON

const CASE_TITLE_ID = 'case-card-title'
const CASE_BODY_ID = 'case-card-body'

const buttonView = (model: Model, h: ApplicationViewBuilder): Html =>
  canSkipCaseCard(model)
    ? h.button(
        [
          h.Type('button'),
          h.Class('debut-card-button'),
          h.DataAttribute('device', model.lastDevice),
          h.AriaKeyshortcuts('Enter'),
          h.OnClick(OnboardingMessage.ClickedCaseCardButton(), {
            focusSelector: '.game-surface',
          }),
        ],
        model.lastDevice === 'Touch'
          ? ['GOT IT']
          : [
              'GOT IT',
              h.kbd([h.Class('debut-card-key'), h.AriaHidden(true)], ['ENTER']),
            ],
      )
    : h.empty

// NOTE: the card's button and what it says for a screen reader, in the new
// zombie card's place and style.
export const caseCardView: {
  (h: ApplicationViewBuilder): (model: Model) => Html
  (model: Model, h: ApplicationViewBuilder): Html
} = Function.dual(2, (model: Model, h: ApplicationViewBuilder): Html =>
  CaseCard.match(model.caseCard, {
    Hidden: () => h.empty,
    Showing: () =>
      h.div(
        [
          h.Class('debut-card'),
          h.Role('group'),
          h.AriaLabelledBy(CASE_TITLE_ID),
          h.AriaDescribedBy(CASE_BODY_ID),
        ],
        [
          h.h2([h.Id(CASE_TITLE_ID), h.Class('sr-only')], [DISPLAY_CASE_NAME]),
          h.p(
            [h.Id(CASE_BODY_ID), h.Class('sr-only')],
            [
              "Do the deed. Win what's inside. The lock over each case shows its deed and how far along you are.",
            ],
          ),
          buttonView(model, h),
        ],
      ),
  }),
)
