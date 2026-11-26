import { Function } from 'effect'

import { joinName } from '../domain/playerName'
import { hasUnseenCalling } from '../domain/unlocks'
import { startingCallingOf } from '../features/heroes/callingPick'
import { Lobby } from '../features/lobby/block'
import { LobbyMessage } from '../features/lobby/message'
import { type LobbyProps, isLobbyDrawn } from '../features/lobby/model'
import { lobbyPicksOf } from '../screens/home/home'
import { isKeyboard } from '../ui/menuParts'
import { bonesBalanceOf, rankOf, totalPointsOf } from '../world/heroes/rank'
import type { ApplicationHtml, ApplicationViewBuilder } from './definition'
import type { Model } from './model'

const lobbyPropsOf = (model: Model): LobbyProps => {
  const rank = rankOf(totalPointsOf(model.rank))
  return {
    lobby: model.lobby,
    picks: lobbyPicksOf(model),
    name: joinName(model),
    look: model.appearance,
    rank,
    calling: startingCallingOf(model),
    isHeroNew: hasUnseenCalling(rank, model.seenUnlocks),
    bought: model.boughtCosmetics,
    bones: bonesBalanceOf(model.rank),
    fresh: model.freshUnlocks,
    isKeyboard: isKeyboard(model),
  }
}

export const lobbyView: {
  (h: ApplicationViewBuilder): (model: Model) => ApplicationHtml | null
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null
} = Function.dual(
  2,
  (model: Model, h: ApplicationViewBuilder): ApplicationHtml | null =>
    isLobbyDrawn(model.lobby)
      ? Lobby(h, {
          key: 'lobby',
          props: lobbyPropsOf(model),
          onEmit: {
            RequestedLeave: () => LobbyMessage.RequestedLeaveLobby(),
            RequestedStart: () => LobbyMessage.RequestedStartFromLobby(),
            RequestedHeroPicker: () => LobbyMessage.RequestedLobbyHeroPicker(),
            RequestedBotHeroPicker: ({ index }) =>
              LobbyMessage.RequestedLobbyBotHeroPicker({ index }),
            RequestedAddBot: () => LobbyMessage.RequestedAddLobbyBot(),
            RequestedDropBot: ({ index }) =>
              LobbyMessage.RequestedDropLobbyBot({ index }),
            PickedMode: ({ mode }) => LobbyMessage.PickedLobbyMode({ mode }),
            PickedDifficulty: ({ difficulty }) =>
              LobbyMessage.PickedLobbyDifficulty({ difficulty }),
            ToggledModifier: ({ modifier }) =>
              LobbyMessage.ToggledLobbyModifier({ modifier }),
            SteppedEasyBreak: () => LobbyMessage.SteppedLobbyEasyBreak(),
            SteppedDareMark: () => LobbyMessage.SteppedLobbyDareMark(),
            FocusedControl: ({ control }) =>
              LobbyMessage.FocusedLobbyControl({ control }),
            BlurredControl: () => LobbyMessage.BlurredLobbyControl(),
            PickedHero: ({ calling }) =>
              LobbyMessage.PickedLobbyHero({ calling }),
            RequestedBuyHero: ({ calling }) =>
              LobbyMessage.RequestedBuyLobbyHero({ calling }),
            RequestedCloseHeroPicker: () =>
              LobbyMessage.RequestedCloseLobbyHeroPicker(),
          },
        })
      : null,
)
