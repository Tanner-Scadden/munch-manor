# Waiting on Tanner

Things the game is blocked on until the owner does or decides them. Agents add an item here when work stops on the owner, and remove it once it is done. Newest first.

## To do

- [ ] **Turn on R2 for RECORD MY RUNS, give the CI token R2, then record some runs.** Added 2026-11-11. The recorder's pull request (#188) adds an R2 bucket (`munch-manor-recordings`, and `munch-manor-recordings-pr-N` for previews). Its preview deploy fails while planning the bucket with "Unauthorized: Authentication error" (Cloudflare code 10000): the CI token has no R2 permission, and the account may not have R2 on yet. #188 adds `Workers R2 Storage Write` to the token in `infra/github.ts` (`CI_PERMISSIONS`); it reaches Cloudflare only when you deploy that file by hand.
  1. Cloudflare dashboard, R2 Object Storage, and accept the R2 plan if asked (the free tier holds 10 GB and 1 million writes a month; a run is about 100 KB to a few MB).
  2. Give the CI token R2 from #188's branch, as "Credentials" in `infra/README.md` says. It needs your broad keychain token (`cloudflare-api-token`, which can create API tokens), the account id, and `gh` logged in (`gh auth status`):
     ```sh
     git fetch origin && git checkout feat/record-my-runs
     cd infra && bun install
     export CLOUDFLARE_API_TOKEN=$(security find-generic-password -s cloudflare-api-token -w)
     export CLOUDFLARE_ACCOUNT_ID=<the 32 character account id>
     export GITHUB_TOKEN=$(gh auth token)
     export ITCH_API_KEY=$(security find-generic-password -s itch-api-key -w)
     bun alchemy plan github.ts --stage prod     # should show only the munch-manor-ci token's permissions changing
     bun alchemy deploy github.ts --stage prod --yes
     ```
     This updates the `munch-manor-ci` token and writes the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` Actions secrets (`.github/workflows/deploy.yml` reads them). Fallback if it fails: Cloudflare dashboard, Manage Account, Account API Tokens, `munch-manor-ci`, Edit, add Account, Workers R2 Storage, Edit, and save (the token's value stays the same, so the secret needs no change; the next `github.ts` deploy keeps it, since the file now lists it).
  3. Re-run the pull request's deploy job (Actions, the failed run, Re-run failed jobs), check the preview, then merge.
  4. On each device you play on, open `https://munchmanor.com/?record=1` once, then Settings, RECORD (on). Play as usual.
  5. To pull your runs: `cd infra && bunx wrangler r2 object get munch-manor-recordings/recordings/<player id>/<run id>.json.gz --file ../run.json.gz --remote`, then `cd .. && bun run learn:replay -- run.json.gz`. Find your player id and runs in the dashboard's bucket browser, under `recordings/`.

- [ ] **Let GitHub's runners through Cloudflare for munchmanor.com (optional).** Added 2026-11-01. The deploy check now uses the workers.dev address and treats the custom domain's 403 as a warning, so deploys no longer fail. To get the real check back: Cloudflare dashboard, munchmanor.com, Security, WAF, Custom rules, add a rule "Skip" for requests with the header `X-Deploy-Check: <a random secret>` (skip Bot Fight Mode / Super Bot Fight Mode and Browser Integrity Check), or turn off Bot Fight Mode under Security, Bots. Then tell an agent, who adds the header (stored as a GitHub secret) to the workflow's custom domain check.

- [ ] **Turn on device emulation so agents can test on an Android emulator (and iOS Simulator).** This lets an agent check the installed app's ROTATE toggle and test touch, portrait, and the PWA on real mobile browsers, without your phone.
  1. In T3 Code, turn on device access for this environment (the setting that lets agents use the Device panel; today agents get "Agent device access is turned off for this environment").
  2. Reply "OK to install the Android SDK" (about 6 to 8 GB). An agent then runs `brew install --cask android-commandlinetools` and installs a Pixel system image with Google Play Chrome and an emulator through `sdkmanager`, and creates the device. Nothing else on the Mac changes.
  3. Optional, for iOS: install Xcode from the App Store (about 10+ GB) and open it once to accept the license, so the iOS Simulator is available too.
