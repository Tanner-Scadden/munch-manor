import * as Alchemy from 'alchemy'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

// Mints the narrow Cloudflare token that CI deploys with and writes it, with
// the account id, to the repository's Actions secrets, beside the itch.io
// API key CI uploads the game with. Deploy it by hand with an admin
// credential that can create account API tokens, and again only to rotate a
// token or change its permissions. The itch.io key lives in the keychain
// (`itch-api-key`) and reaches this app as ITCH_API_KEY:
//
//   ITCH_API_KEY=$(security find-generic-password -s itch-api-key -w) \
//     bun alchemy deploy github.ts --stage prod

const OWNER = 'Tanner-Scadden'
const REPOSITORY = 'munch-manor'

// Workers Scripts Write deploys the site. Secrets Store Write lets CI read
// the Cloudflare state store's token, which Alchemy reads back by binding
// the secret to a short-lived preview Worker. Account Settings Read and
// Workers Tail Read cover account lookups and `alchemy logs`. D1 Write
// creates each stage's analytics database and applies its migrations.
const CI_PERMISSIONS = [
  'Workers Scripts Write',
  'Secrets Store Write',
  'Account Settings Read',
  'Workers Tail Read',
  'D1 Write',
] as const

// NOTE: production serves munchmanor.com as Workers Custom Domains
// (alchemy.run.ts). Zone Read finds the zone by name, Workers Routes Write
// attaches the custom domains, and Dynamic URL Redirects Write keeps the
// www to apex redirect rule. Scoped to that one zone.
const MUNCHMANOR_ZONE_ID = 'e0b39985e4fdbd2cb2a8f2ffa1e33ac5'

const CI_ZONE_PERMISSIONS = [
  'Zone Read',
  'Workers Routes Write',
  'Dynamic URL Redirects Write',
] as const

// NOTE: reading ITCH_API_KEY needs Alchemy's own platform layer, as
// alchemy.run.ts's stack does; only the Alchemy CLI reads this export.
/** @stability unstable */
export default Alchemy.Stack(
  'munch-manor-github',
  {
    providers: Layer.mergeAll(Cloudflare.providers(), GitHub.providers()),
    state: Cloudflare.state(),
  },
  Effect.gen(function* () {
    const { accountId } = yield* yield* Cloudflare.CloudflareEnvironment

    const token = yield* Cloudflare.ApiToken.AccountApiToken('CiToken', {
      name: 'munch-manor-ci',
      accountId,
      policies: [
        {
          effect: 'allow',
          permissionGroups: [...CI_PERMISSIONS],
          resources: { [`com.cloudflare.api.account.${accountId}`]: '*' },
        },
        {
          effect: 'allow',
          permissionGroups: [...CI_ZONE_PERMISSIONS],
          resources: {
            [`com.cloudflare.api.account.zone.${MUNCHMANOR_ZONE_ID}`]: '*',
          },
        },
      ],
    })

    yield* GitHub.Secret('CloudflareApiToken', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_API_TOKEN',
      value: token.value,
    })

    yield* GitHub.Secret('CloudflareAccountId', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'CLOUDFLARE_ACCOUNT_ID',
      value: Redacted.make(accountId),
    })

    // NOTE: the itch.io API key butler uploads with (tools/itch/build.sh,
    // tools/itch/page.md), read redacted so it never prints.
    const itchApiKey = yield* Config.Redacted('ITCH_API_KEY')
    yield* GitHub.Secret('ButlerApiKey', {
      owner: OWNER,
      repository: REPOSITORY,
      name: 'BUTLER_API_KEY',
      value: itchApiKey,
    })

    return { tokenName: token.name }
  }),
)
