import { pipe } from 'effect'
import { Update } from 'foldkit'

import { LobbyComposition } from './composition'
import {
  addBot,
  blurredControl,
  botHeroOpenedFrom,
  dropBot,
  finishFold,
  focusedControl,
  heroOpenedFrom,
  leave,
  openBotHero,
  openHero,
  pickDareMark,
  pickDifficulty,
  pickEasyBreak,
  pickMode,
  pickModifier,
  start,
} from './steps'

// NOTE: the lobby's own Messages, its taps and focus, with the root's picks
// as context. Each tap is a Step in steps.ts that its keys share.
export const update = LobbyComposition.makeUpdate.withContext(picks => ({
  ClickedBackButton: leave,
  ClickedBackdrop: leave,
  ClickedStartButton: start,
  ClickedHeroButton: model =>
    pipe(openHero(model), Update.withOutMessage(heroOpenedFrom(model))),
  ClickedAddBotButton: addBot,
  ClickedDropBotButton: (model, { index }) => dropBot(index)(model),
  ClickedBotHeroButton: (model, { index }) =>
    pipe(
      openBotHero({ index, picks })(model),
      Update.withOutMessage(botHeroOpenedFrom({ index, picks })(model)),
    ),
  ClickedModeButton: (model, { mode }) => pickMode(mode)(model),
  ClickedDifficultyButton: (model, { difficulty }) =>
    pickDifficulty(difficulty)(model, picks),
  ClickedModifierButton: (model, { modifier }) =>
    pickModifier(modifier)(model, picks),
  ClickedEasyBreakButton: model => pickEasyBreak(model)(picks),
  ClickedMarkButton: model => pickDareMark(model)(picks),
  FocusedControl: (model, { control }) => ({
    model: focusedControl(control)(model),
  }),
  BlurredControl: model => ({ model: blurredControl(model) }),
  CompletedFocusControl: model => ({ model }),
  CompletedFold: model => ({ model: finishFold(model) }),
}))
