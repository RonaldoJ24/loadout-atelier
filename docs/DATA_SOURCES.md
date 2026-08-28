# Data sources and attribution

## Data-state labels

Loadout Atelier uses these labels consistently:

- **Manual**: entered or explicitly selected by the user.
- **Live**: returned during the current local session from an official API route.
- **Cached**: returned from a bounded in-memory cache or recorded official documentation metadata; the retrieval time and version remain visible.
- **Fixture**: synthetic, versioned demonstration content shipped in the repository.
- **Inferred**: deterministically derived from an identified source fact.
- **Unknown**: absent, restricted, malformed, or unverified.
- **AI-derived**: optional explanatory text or preference reconciliation returned by the local provider and accepted only after schema/citation/engine validation.

No data may be silently promoted from one state to another.

## Transient public-profile evidence

The local service may use a public player name to call the official profile and character-list routes. The selector and raw responses remain server-side for the duration of the request. The product-facing normalizer allowlists only online state plus character class and level. UUID map keys, character identifiers, nicknames, reskins, XP, modes, guild/account fields, and unexpected values are discarded before serialization.

Applying a character copies class and level into an ordinary manual build and removes already-selected abilities from a different class. It does not establish equipped items, exact item rolls, powders, tomes, bank contents, currency, derived totals, or unused ability points. Those fields stay manual or unknown, and the deterministic validator may immediately flag the existing equipment as incompatible with the imported class/level.

## Synthetic portfolio fixture

`fixture-2026.08` and its prior snapshot are original, small regression datasets. Item and ability names, numerical values, availability flags, costs, and balance changes are fictional. Class names and equipment concepts are used only to demonstrate the documented public API shape and deterministic rules. They must not be used as live gameplay advice.

The fixture intentionally contains unavailable items, class-locked weapons, requirement thresholds, mutually exclusive abilities, a patch-added item, and a changed support stat so the evaluation suite can replay failure and patch-impact behavior without depending on network availability.

## Official sources

API contract and policy references are listed in [API_RESEARCH.md](API_RESEARCH.md). Each visible source card includes publisher, direct URL, retrieval timestamp, dataset version, mode, and freshness. Wynncraft is a trademark of its respective owner. Loadout Atelier is an unofficial project and is not affiliated with or endorsed by Wynncraft.

The optional explanation adapter targets DeepSeek's official chat-completions API and JSON-output mode. Provider output is untrusted and is not treated as a gameplay data source: it must match the local schema, cite source IDs already supplied by the application, and pass deterministic revalidation. The default model name is configuration, not a claim that any particular model will remain available. Primary references: [chat completion API](https://api-docs.deepseek.com/api/create-chat-completion/) and [JSON output guide](https://api-docs.deepseek.com/guides/json_mode/).
