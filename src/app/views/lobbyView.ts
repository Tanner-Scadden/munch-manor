import { Function } from 'effect'

import type { ApplicationHtml, ApplicationViewBuilder } from '#app/component.ts'
import type { Model } from '#app/model.ts'
import { joinName } from '#domain/playerName.ts'
import { hasUnseenCalling } from '#domain/unlocks.ts'
import { startingCallingOf } from '#features/heroes/callingPick.ts'
import { Lobby } from '#features/lobby/block.ts'
import { LobbyMessage } from '#features/lobby/message.ts'
import { type LobbyProps, isLobbyDrawn } from '#features/lobby/model.ts'
import { lobbyPicksOf } from '#screens/home/home.ts'
import { isKeyboard } from '#ui/menuParts.ts'
import { bonesBalanceOf, rankOf, totalPointsOf } from '#world/heroes/rank.ts'

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
