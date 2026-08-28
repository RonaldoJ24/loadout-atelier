# Data sources and attribution

## Data-state labels

Loadout Atelier uses four labels consistently:

- **Live**: returned during the current local session from an official API route.
- **Cached**: returned from a bounded in-memory cache or recorded official documentation metadata; the retrieval time and version remain visible.
- **Fixture**: synthetic, versioned demonstration content shipped in the repository.
- **AI-derived**: optional explanatory text or preference reconciliation returned by the local provider and accepted only after schema/citation/engine validation.

No data may be silently promoted from one state to another.

## Synthetic portfolio fixture

`fixture-2026.08` and its prior snapshot are original, small regression datasets. Item and ability names, numerical values, availability flags, costs, and balance changes are fictional. Class names and equipment concepts are used only to demonstrate the documented public API shape and deterministic rules. They must not be used as live gameplay advice.

The fixture intentionally contains unavailable items, class-locked weapons, requirement thresholds, mutually exclusive abilities, a patch-added item, and a changed support stat so the evaluation suite can replay failure and patch-impact behavior without depending on network availability.

## Official sources

API contract and policy references are listed in [API_RESEARCH.md](API_RESEARCH.md). Each visible source card includes publisher, direct URL, retrieval timestamp, dataset version, mode, and freshness. Wynncraft is a trademark of its respective owner. Loadout Atelier is an unofficial project and is not affiliated with or endorsed by Wynncraft.
