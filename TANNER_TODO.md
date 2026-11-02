# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Let GitHub's runners through Cloudflare for munchmanor.com (optional).** Added 2026-11-01. The deploy check now uses the workers.dev address and treats the custom domain's 403 as a warning, so deploys no longer fail. To get the real check back: Cloudflare dashboard, munchmanor.com, Security, WAF, Custom rules, add a rule "Skip" for requests with the header `X-Deploy-Check: <a random secret>` (skip Bot Fight Mode / Super Bot Fight Mode and Browser Integrity Check), or turn off Bot Fight Mode under Security, Bots. Then tell an agent, who adds the header (stored as a GitHub secret) to the workflow's custom domain check.

- [ ] **Look at two tools that could improve the game, and pick what to try.** Added 2026-11-01.
  1. Ritmo's tools, https://ritmo.typeonce.dev/tools/: see whether any fit our sound, music, or rhythm (the synthesized chiptune in `src/music.ts` and the sound recipes in `src/audioRecipes.ts`).
  2. Agent Sprite Forge, https://github.com/0x0funky/agent-sprite-forge: see whether it can help agents make pixel art (new zombies, heroes, hats, rooms) in our sprite style (`src/sprite.ts`, `spriteShapes`, the atlas in `tools/sprites/`). The art must stay original.
  3. Reply with what to try, and an agent will try it out on a branch.

- [ ] **Turn on device emulation so agents can test on an Android emulator (and iOS Simulator).** This lets an agent check the installed app's ROTATE toggle and test touch, portrait, and the PWA on real mobile browsers, without your phone.
  1. In T3 Code, turn on device access for this environment (the setting that lets agents use the Device panel; today agents get "Agent device access is turned off for this environment").
  2. Reply "OK to install the Android SDK" (about 6 to 8 GB). An agent then runs `brew install --cask android-commandlinetools` and installs a Pixel system image with Google Play Chrome and an emulator through `sdkmanager`, and creates the device. Nothing else on the Mac changes.
  3. Optional, for iOS: install Xcode from the App Store (about 10+ GB) and open it once to accept the license, so the iOS Simulator is available too.
