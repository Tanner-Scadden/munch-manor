import * as Alchemy from 'alchemy'
import * as Config from 'effect/Config'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Redacted from 'effect/Redacted'

import * as Cloudflare from '@alchemy.run/cloudflare'
import * as GitHub from '@alchemy.run/github'

const OWNER = 'Tanner-Scadden'
const REPOSITORY = 'munch-manor'

const CI_PERMISSIONS = [
  'Workers Scripts Write',
  'Secrets Store Write',
  'Account Settings Read',
  'Workers Tail Read',
  'D1 Write',
  'Workers R2 Storage Write',
] as const

const MUNCHMANOR_ZONE_ID = 'e0b39985e4fdbd2cb2a8f2ffa1e33ac5'

const CI_ZONE_PERMISSIONS = [
  'Zone Read',
  'Workers Routes Write',
  'Dynamic URL Redirects Write',
] as const

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
