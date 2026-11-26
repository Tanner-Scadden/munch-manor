# Mobile stores

**Status: scoped and decided with the owner on 2026-11-09, not started** (see "Decided"). This file is the plan for getting Munch Manor into Apple's App Store and Google Play: the decisions, the order, the approach, and the work. It waits on the lore and cleanup work (see "When"). The web game, its hosting, and its save are in [`PLATFORM.md`](./PLATFORM.md); the escape the manor direction in [`LORE.md`](./LORE.md).

## Decided

Decided with the owner on 2026-11-09:

- **When.** After the escape the manor work reaches steps 1 and 2 in `LORE.md` and the cleanup after it (see "When").
- **One Capacitor app for both stores.** The game is built into the app, and live updates come from munchmanor.com through the NEW VERSION gift. A Trusted Web Activity is the fallback only if the Android build fights us.
- **iPhone and iPad** at launch, on iOS. The iPad needs its own screenshots and testing (see "The phone details").
- **Both stores together.** Start Google Play's closed test early so its 14 days overlap the iOS work, then launch on both at once.
- **The name is "Munch Manor".** No subtitle in the name; Apple's separate subtitle line and Play's short description can carry a hook.
- **Free to download, with in-app purchases planned.** The first release may ship with nothing to buy, but the door stays open: the app is built so purchases can join without redoing it (see "In-app purchases"). No ads. The Stripe coffee is hidden in the store builds.
- **Co-op on at launch.** Store players join web players' rooms by code and QUICK PLAY, as the itch.io build does.
- **Testers** for the Play closed test: friends and family, and itch.io players asked on the game's page.

## When

After the escape the manor work reaches steps 1 and 2 of "What would change in the game" in `LORE.md` (the words, and the three pieces in fixed spots), and after the cleanup that follows it. Why wait:

- **The listing is the story.** The store name line, description, screenshots, trailer, and age rating all describe what the game is about. Written before the lore lands, they would be written twice. The manifest's description already drifted ("through 8 waves", while a run is ten).
- **A launch happens once.** Reviewers and players judge the first build they see, and a game with a clear goal clears Apple's "more than a website" bar more easily.
- **Little code waits on it.** Nothing here reshapes the game, so waiting costs nothing but the calendar. The one slow clock is Google Play's closed test (see "Google Play"): start it as soon as a build is close to final.

## The approach

**One Capacitor app for both stores, with the game inside it and live updates from munchmanor.com.**

- **The game ships inside the app.** Capacitor wraps the built `dist/` in a native iOS and Android project, served from the app itself (`capacitor://localhost` on iOS, `https://localhost` on Android). The app starts and plays with no network, as an installed web app does today.
- **Live updates, no review per release.** On launch the app checks munchmanor.com for a newer build, downloads it as a zip in the background, and swaps it in on the next launch or when the player taps the update gift. Apple allows this for web code run in the system web view, as long as an update keeps the app's purpose and does not dodge review (the Developer Program License Agreement, 3.3.1(B), and App Review guideline 2.5.2). Bug fixes, balance, new zombies, and lore all qualify. Only a change to the native shell (a new plugin, a permission, the icon) goes through the stores.
- **Never a pointer to the website.** An app that only loads munchmanor.com is what Apple rejects under guideline 4.2 ("minimum functionality"). The bundled build, the offline play, and the native touches (haptics, the splash) are what make it an app.

### Why not a Trusted Web Activity on Android

A Trusted Web Activity (Bubblewrap or PWABuilder) is the cheapest way onto Google Play: the app is Chrome showing munchmanor.com full screen, updates are instant, and it shares the save a player already has in Chrome. It was the first recommendation. With live updates on Capacitor, one app for both stores gives one build, one update path, and one set of bugs to chase, so Capacitor for both was decided. A TWA stays the fallback if the Capacitor Android build fights us.

## What is already in place

- **A self-contained build.** `tools/itch/build.sh` builds against production's API, turns the service worker into its kill switch, and points room links at munchmanor.com. A store build follows the same recipe.
- **The API takes any origin.** `CORS_HEADERS` in `infra/worker/syncCore.ts` allow `*`, so co-op, sync, and run summaries should work from the app's origin with no Worker change.
- **Touch, portrait, and landscape** layouts, the rotation lock, and offline play are built and tested.
- **Moving a save.** Device linking (the Profile's ACCOUNT tab) moves a player's save from the browser into the app.
- **Icons.** `public/` has the 512 px icon and a maskable one to start the store icons from.

## The work

### 1. The store build (about a day)

- `bun run build:mobile`, beside `build:itch`: production's API, `VITE_COOP=On`, room links at munchmanor.com, the service worker off (the app serves its own files), a build id that says `mobile`, and `SUPPORT_URL` empty (see "The tip jar").
- `capacitor.config.ts` and the `ios/` and `android/` projects, checked in. `bunx cap sync` copies `dist/` in.
- Runs in the iOS Simulator and an Android emulator (the emulator item in `TANNER_TODO.md`).

### 2. The phone details (two to three days)

- **The save on iOS.** The SQLite save on OPFS has to work in iOS's built-in web view and survive an app update and a live update. The `localStorage` fallback exists, but a save that vanishes is the worst bug this plan can ship. Prove it first: this is the biggest risk.
- **The notch and the home bar.** Safe area insets in the CSS, in both layouts.
- **Rotation.** The ROTATE setting locks through Capacitor's screen orientation plugin instead of `screen.orientation.lock`, which iOS lacks. Settings can then show ROTATE on iOS too.
- **Full screen.** The app is always full screen, so its button hides.
- **Sound.** Web Audio starts on the first tap in the web view, as on iOS Safari. Check it.
- **SHARE and links.** SHARE through Capacitor's share plugin, outside links in the system browser.
- **iPad.** The landscape layout on iPad's wider and squarer screens, both ways round, with touch, and with a keyboard and mouse or trackpad attached (iPadOS hands them to the web view like a desktop's). Split View and Stage Manager resize the window mid-run.
- **Haptics.** A light tap on hits, the shop, and the fridge's pull. Cheap, and part of being more than a website.
- **The splash.** A native splash in the game's purple, handing over to the loading splash without a flash.

### 3. Live updates (two to three days)

- **The updater.** Capgo's open source Capacitor updater, self-hosted: no third-party service, no account.
- **The host.** Each production deploy also uploads the build as a zip with a small manifest (build id, checksum, the lowest native shell it runs on) to munchmanor.com, beside `version.json`, as the deploy already pushes to itch.io.
- **The gift.** The NEW VERSION gift stays the one way an update reaches a player: the app downloads the new build quietly, the gift shows on the home menu once it is ready, and a tap swaps it in. Updates still never cost a run.
- **Rollback.** A build that fails to start falls back to the last good one, and the bundled build is always there underneath.
- **The shell floor.** A build that needs a newer native shell (a new plugin) is skipped by older apps until the player updates from the store.

### 4. The stores (a few days of work, then waiting)

- **Listings.** Name, short and long description, keywords, and screenshots for each phone size and for iPad, made with the shots scripts and `tools/video`. A short trailer from `tools/video` too.
- **A privacy policy URL.** A page on munchmanor.com. It covers the anonymous run summaries (off with "Share anonymous play stats"), the sync of the save, and co-op. Nothing personal is collected.
- **Privacy forms.** Apple's privacy labels and Google's Data safety form, from the same facts.
- **Age rating.** The questionnaires on both stores. Cartoon gore puts it around Teen, PEGI 12 to 16.
- **Signing and submitting.** By hand in Xcode and the Play Console at first. Builds from CI (macOS runners and fastlane) can follow once releases settle, since live updates make native releases rare.

## The tip jar

Both stores generally require their own payment system for tips to the developer inside an app, so the Stripe coffee link risks a rejection. The store build hides it (`SUPPORT_URL` empty already does). A tip can come back later as an in-app purchase (see below). Check the current rules at submission time; they change.

## In-app purchases

Planned by the owner (2026-11-09), not designed yet: what is sold, and its price, are open. Nothing in the first release may depend on them, and nothing in it may close the door on them.

**What keeps the door open:**

- **The shell can take a billing plugin.** Purchases go through StoreKit on iOS and Play Billing on Android, by a Capacitor plugin (RevenueCat's, or the open source `cordova-plugin-purchase`). A plugin is native code, so adding it is a store release, not a live update. If purchases are near, put the plugin in the first native release, unused, so the purchases themselves can arrive by live update later.
- **Purchases go through one service.** In the game, a purchase is an Effect service (`Purchases`) behind a Command, like `PlayerStore`, with a web version that offers nothing (or the Stripe path on munchmanor.com) and a store version over the plugin. `update` stays pure: it asks with a Command and hears back with a Message.
- **What is owned is part of the save.** An owned item goes in `PlayerSave` and syncs like the rest, so it follows a player to every linked device. The store's receipt is the truth: restore purchases on a new install, and check receipts on the API Worker before granting anything that matters.
- **The products are registered with each store.** Every product (its id, price, and description) is set up in App Store Connect and the Play Console and reviewed by the store, so a new kind of product waits on review even though the code to sell it can arrive by live update.
- **The forms change.** The privacy labels, the Data safety form, and the listing ("Offers in-app purchases") change once purchases ship.
- **Fairness with the web.** The same game runs on munchmanor.com and in co-op with store players. Decide whether web players can buy the same things (Stripe on the web) or whether purchases are cosmetic only, so a co-op room never splits on who paid. Bones are earned today; selling them would change "Heroes cost Bones" in `GAME_DESIGN.md` and needs the owner's call.

## Google Play

- **Account.** A Play Console developer account, $25 once.
- **The closed test.** A new personal account must run a closed test with about 12 testers for 14 days before it can publish to everyone. Start it as soon as a build is close to final, and gather testers early: friends and family, and itch.io players asked on the game's page. Each must opt in with a Google account and stay in for the whole 14 days, so ask for a few more than 12. Check the current numbers when signing up.
- **Review.** Usually a few days for a first release.

## Apple App Store

- **Account.** An Apple Developer Program membership, $99 a year.
- **A Mac with Xcode,** for the Simulator, signing, and uploads (the iOS item in `TANNER_TODO.md`).
- **TestFlight** for a beta before review.
- **Review.** Usually a day or two. The likely pushback is guideline 4.2; the answer is the bundled build, offline play, and the native touches above.

## Rough cost

| What                         | Time           | Money      |
| ---------------------------- | -------------- | ---------- |
| The store build              | about a day    |            |
| The phone details            | 2 to 3 days    |            |
| Live updates                 | 2 to 3 days    |            |
| Listings, policy, forms      | a few days     |            |
| Google Play account and test | 14 days' clock | $25 once   |
| Apple Developer Program      |                | $99 a year |

About two weeks of work in all, overlapping the Play test's clock.

## Open questions

1. **What do in-app purchases sell, and when do they ship?** Cosmetics (hats, prints, gun skins), heroes, Bones, a tip, or a supporter pack, and whether they come in the first release or later. See "In-app purchases".

New ones go here as the work turns them up.
