# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Playtest the sideways aim assist on a phone.** A phone on its side now gets the same gentle pull onto the nearest zombie as upright. The balance bot wins 42% on Normal with it against 25% without, far more than upright gained, but the bot's shaky aim is not a thumb's.
  1. On the phone, open https://munchmanor.com, hold it sideways, and play a Normal campaign to wave 5 or so.
  2. Expected: holding fire a hair off a zombie lands the shots on it; aiming well away from a zombie goes where your thumb points.
  3. Reply "feels right", "too easy", or "too sticky". If too easy or sticky, an agent shrinks the cone (`outerRadians`) or the reach (`reachPx`) in `src/aimAssist.ts` for sideways play.
- [ ] **Turn off Cloudflare Web Analytics on munchmanor.com.** Cloudflare injects its own analytics beacon (`static.cloudflareinsights.com/beacon.min.js`) into pages on the new domain. That breaks offline play's "same build" check and adds a third-party tracker the game's own privacy rules don't allow (analytics only go through the game's opt-in run summary). In the Cloudflare dashboard: munchmanor.com, then Analytics & Logs, then Web Analytics, and turn off automatic setup (or remove the site). Reply "done" and an agent re-runs the offline audit.
- [ ] **Retest SHARE on your phone.** It now opens the phone's share sheet instead of a link (the link opened the X app without a draft).
  1. On the phone, open https://munchmanor.com in the browser, and play until you die.
  2. Tap SHARE (the black X button). Expected: the phone's share sheet slides up with the post's line and the game's link.
  3. Pick X. Expected: X's own composer opens with the line and the link filled in, ready to post. Close it without posting if you like.
  4. Tap SHARE again and close the sheet without picking anything. Expected: nothing else happens; you stay on the card.
  5. Repeat steps 1 to 3 from the installed app (the Home Screen icon).
  6. Reply with what each step did, and the phone and browser (for example "iPhone 15, Safari"). If the sheet never appears, SHARE has fallen back to X's link, `x.com/intent/tweet`; say whether that opened a draft in the X app.

- [ ] **Watch the devlog clips and pick which to post.** They are in `tools/video/out/` (`rattles-mine`, `portrait-aim`, `coop-looks`, `fridge-pull`, each an `.mp4` and a looping `.gif`). Say which to post and any caption to change (captions live in `tools/video/shots/devlog.json`).
- [ ] **Play with Mystery Leftovers and say if the prices and odds feel right.** Open the kitchen, then hold Enter at the fridge on its back wall ($75 a pull). The proposed numbers are in "Mystery Leftovers" in `GAME_DESIGN.md`: Cooker 36, Pan 36, Brain Freeze 8 (rising 3 a slam, up to 20), Sandwich 11, Dud 9 out of 100; a slam after 3 or 4 pulls for 30 s; Rattles' upgrades $70, $160, $300 for the Cooker, $60, $150, $300 for the Pan, and $30 Lid Stacks. Reply with any you want changed.
- [ ] **Turn on device emulation so agents can test on an Android emulator (and iOS Simulator).** This lets an agent check the installed app's ROTATE toggle (the item below) and test touch, portrait, and the PWA on real mobile browsers, without your phone.
  1. In T3 Code, turn on device access for this environment (the setting that lets agents use the Device panel; today agents get "Agent device access is turned off for this environment").
  2. Reply "OK to install the Android SDK" (about 6 to 8 GB). An agent then runs `brew install --cask android-commandlinetools` and installs a Pixel system image with Google Play Chrome and an emulator through `sdkmanager`, and creates the device. Nothing else on the Mac changes.
  3. Optional, for iOS: install Xcode from the App Store (about 10+ GB) and open it once to accept the license, so the iOS Simulator is available too.
- [ ] **Check the rotation setting on a real Android phone (installed app).** The app now starts in landscape, and Settings' ROTATE tile (LOCKED or AUTO) lets it turn. Install it, flip ROTATE, turn the phone, and say if it follows.

## Later

- [ ] **Nudge players on the old address to move?** The game now lives at https://munchmanor.com, and the old https://munch-manor.tanner-scadden.workers.dev keeps serving the same build on purpose: a save lives per address (the on-device database, settings, the offline copy), and installed apps are tied to the address they came from, so a redirect would strand every save there. Decide whether to add a small in-game "we moved, bring your save" card on the old address only. It would use the device link that already exists (Profile, ACCOUNT): open munchmanor.com, link it to the old address with a code, and the new address takes the old one's progress. Reply "build the move nudge" or "leave it". Nothing is built yet. See "Two origins" in `PLATFORM.md`.

- [ ] **Release video, once co-op lands.** See `RELEASE_VIDEO.md`. You will need: the X account to post from. The players-together shots are mocked in pixel art.
