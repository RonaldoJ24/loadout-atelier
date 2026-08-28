# Official API research

Research was performed on 2026-08-28 before implementation. Only Wynncraft's official documentation and service were used for integration decisions.

## Supported surface

Loadout Atelier targets the current v3 base URL, `https://api.wynncraft.com/v3`. A bounded unauthenticated request to `GET /ability/tree/mage` returned HTTP 200 and the `Version: v3.7.2` response header on 2026-08-28.

The MVP uses these documented contracts:

| Purpose             | Official route                                       | Cache / bucket                  | Product decision                                                                             |
| ------------------- | ---------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------- |
| Public profile      | `GET /player/{username}`                             | 2 minutes / `PLAYER`            | Optional local lookup; normalize online/access state and discard identity/account fields.    |
| Character list      | `GET /player/{username}/characters`                  | 2 minutes / `PLAYER`            | Normalize only class/level; discard UUID map keys, nicknames, XP, modes, and unknown fields. |
| Character detail    | `GET /player/{username}/characters/{uuid}`           | route documented under `PLAYER` | Fetch only after a public profile grants access. Never retain or publish a user's UUID.      |
| Character abilities | `GET /player/{username}/characters/{uuid}/abilities` | `PLAYER`                        | Optional; access rules can make it unavailable.                                              |
| Item database       | `GET /item/database?fullResult`                      | 1 hour / `ITEMS`                | Local typed tool; the presence-only `fullResult` flag must not be sent as `true` or `false`. |
| Ability definition  | `GET /ability/tree/{class}`                          | 1 hour / `SHARED`               | Local typed tool for one of five documented classes.                                         |

The API documents independent guest limits of 50 requests per minute for the `SHARED`, `PLAYER`, `GUILD`, `ITEMS`, `LEADERBOARDS`, and `MAP` buckets; authenticated callers receive 120 requests per minute. The product does not require authentication and does not multiply capacity. It records nonsecret version/cache/rate-limit response headers and uses timeouts plus bounded in-memory caching only for shared static item/ability data. Profile, character, and character-ability responses bypass the cache because they may contain personal identifiers.

## Privacy and permitted use

The [API Privacy documentation](https://docs.wynncraft.com/privacy) states that profile and character fields can be restricted through access rules. The `restrictions` map is authoritative; a restricted or incomplete response is not converted into a build.

The public route accepts a username or UUID, and the documentation recommends UUIDs to avoid ambiguous names. Loadout Atelier deliberately accepts usernames only: a UUID would create a stronger persistent identifier, while an ambiguous username is safer to surface as a typed failure. The browser sends the transient username to the loopback service in a POST body; only the server constructs the official GET paths.

The [Wynncraft API Terms](https://wynncraft.com/api-terms), effective 2026-05-18, permit API use subject to the documentation, law, and platform access controls. They also require applications to:

- keep API credentials and tokens confidential;
- use OAuth authorization only for the represented user-facing purpose;
- avoid bypassing authentication, privacy controls, scopes, or rate limits;
- promptly stop using and delete or anonymize retained data when a later privacy setting restricts it; and
- never represent restricted, removed, or private data as current, complete, or available.

Loadout Atelier therefore stores only user-created builds in browser-local storage. Public profile lookup is transient, optional, and unavailable in the hosted fixture-only demo. OAuth, account linkage, and profile retention are intentionally out of scope.

## Attribution and availability

The official API Terms page does not state a separate logo or attribution formula. The product nevertheless labels every official source card “Wynncraft,” links to the exact official documentation route, shows retrieval time/version/mode, and states that the project is unofficial and unaffiliated.

The API terms reserve the right to change or discontinue endpoints without notice. Live failures, schema changes, privacy restrictions, and stale data therefore produce a readable fallback or abstention. The versioned synthetic fixture demonstrates tool contracts and validation behavior; it is not represented as a complete or current item database.

## Primary references

- [API v3 introduction, cache headers, and rate limits](https://docs.wynncraft.com/welcome)
- [Authentication and public-token guidance](https://docs.wynncraft.com/authentication)
- [API privacy and access rules](https://docs.wynncraft.com/privacy)
- [Player profile route](https://docs.wynncraft.com/modules/player/get-player)
- [Character list route](https://docs.wynncraft.com/modules/player/list-player-characters)
- [Character detail route](https://docs.wynncraft.com/modules/player/get-player-character)
- [Character ability route](https://docs.wynncraft.com/modules/player/get-player-character-abilities)
- [Item database route](https://docs.wynncraft.com/modules/item-recipe/list-items)
- [Ability tree route](https://docs.wynncraft.com/modules/ability-aspect/get-ability-tree)
- [Wynncraft API Terms](https://wynncraft.com/api-terms)
