# The itch.io page

What is on Munch Manor's itch.io page, https://tannerscadden.itch.io/munch-manor.
The build comes from `bun run build:itch` (pushed by CI after each deploy);
the images and the clip came from the screenshot scripts and
`bun run video`. This file holds the words and the settings.

## Settings

| Field             | Value                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Title             | Munch Manor                                                                                            |
| Project URL       | `munch-manor` (https://tannerscadden.itch.io/munch-manor)                                              |
| Short description | Try not to get eaten.                                                                                  |
| Classification    | Games                                                                                                  |
| Kind of project   | HTML                                                                                                   |
| Release status    | In development                                                                                         |
| Pricing           | No payments (or Donations, to match the coffee in the game)                                            |
| Uploads           | the zip, with "This file will be played in the browser" ticked                                         |
| Embed options     | 960 x 540, Mobile friendly, Fullscreen button, Click to launch                                         |
| Orientation       | Default (the game plays upright and sideways)                                                          |
| Genre             | Shooter                                                                                                |
| Tags              | zombies, pixel-art, top-down-shooter, co-op, multiplayer, wave-survival, arcade, browser, mobile, cute |
| Input             | Keyboard, Mouse, Touchscreen                                                                           |
| Multiplayer       | Server-based networked multiplayer, 2 to 4 players                                                     |
| Cover image       | `cover-630x500.png`                                                                                    |
| Screenshots       | `1-coop-wave.png` to `6-first-wave.png`, and `clip-6s.gif`                                             |

## Description

> Something in the manor is hungry, and it is not the cat.
>
> Hold the parlour for ten waves of Groaners, Hotfoots, Kaboomers, Big Lugs, and worse, then meet Uncle Chunk. Spend your kill money at Rattles' stall between waves: bigger guns, board up the doors, plonk down a gnome. Pry open the kitchen if you dare.
>
> **Play with friends.** CO-OP puts up to four of you in one room: QUICK PLAY finds a crew, or share a five-letter code. Revive each other. Argue about who gets the shotgun.
>
> **On your phone too.** Two thumbs, upright or sideways. Play it at [munchmanor.com](https://munchmanor.com) to install it to your home screen and play offline.
>
> **Controls.** WASD to move, mouse to aim and shoot, R to reload, F for the knife, Enter to start a wave. On a phone, one thumb moves and the other aims.
>
> **Easy on everyone.** Turn off screen shake, mute sound or music on their own, pause any time, or play on Easy. Every menu works with a keyboard and a screen reader, and the menus hold still if your device asks for less motion.
>
> Free, in your browser, no account. Your progress saves on your device, and links across devices if you want.
>
> Made with love and a worrying number of zombie sounds. Also at [munchmanor.com](https://munchmanor.com). Open source at https://github.com/Tanner-Scadden/munch-manor

## Metadata and the other tabs

- Metadata: inputs Keyboard, Mouse, Touchscreen; sessions A few minutes; server-based multiplayer, 1 to 4 players; English; accessibility Interactive tutorial; no sensitive content.
- Interact, Notifications: "email owners on new uploads" is off, since CI uploads after every deploy that changes the game.
- Build settings: semantic versioning and unique versions stay off (CI's versions are `itch-<commit>`).
- Ratings on; no geo restrictions; no third-party analytics (the game has its own, anonymous).
