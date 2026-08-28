# Architecture and contracts

Loadout Atelier is a local-first TypeScript application with two deliberate runtime surfaces:

```text
Hosted/static browser                          Optional local Node service
┌──────────────────────────────┐              ┌──────────────────────────────┐
│ React analytical workspace   │  same origin │ Express /api                 │
│ synthetic versioned fixture  │ ───────────► │ Wynncraft typed tools        │
│ deterministic engine         │              │ DeepSeek bounded adapter     │
│ localStorage + JSON export   │              │ timeout/cache/redaction      │
└──────────────┬───────────────┘              └──────────────┬───────────────┘
               │                                             │
               └──────── strict schema + deterministic recheck┘
```

The GitHub Pages build is useful without a service: manual construction, validation, deterministic recommendations, comparisons, saved builds, fixture patch re-evaluation, scenario replay, evidence cards, and export all run locally. Public profile lookup and provider-assisted explanations are local-service capabilities; the hosted app never receives provider credentials.

## Module boundaries

| Module         | Responsibility                                                                                                  | Trust level                                 |
| -------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `src/domain`   | Shared TypeScript contracts and strict Zod schemas.                                                             | Contract boundary                           |
| `src/fixtures` | Small, versioned synthetic item/ability datasets plus a sample build.                                           | Demonstration data, not production coverage |
| `src/engine`   | Totals, requirements, compatibility, ability graph, cost, scoring, recommendation validation, patch comparison. | Deterministic authority                     |
| `src/data`     | Wynncraft route wrappers, validation, caching, timeouts, readable outcomes, nonsecret metadata.                 | Untrusted external input                    |
| `src/ai`       | Optional DeepSeek request, strict structured parsing, citation allowlist, and deterministic recheck.            | Untrusted suggestion source                 |
| `src/evals`    | Curated scenario definitions, replay, exact metric numerators/denominators, regression output.                  | Release gate                                |
| `src/ui`       | Analytical workspace, source/traces display, local saves, fixture re-evaluation, export.                        | Presentation only                           |
| `server`       | Local-only secret access and same-origin API surface.                                                           | Secret boundary                             |

## Decision boundary

Deterministic code owns every claim that can be computed from data: slot compatibility, item availability, class/level/skill requirements, totals, ability prerequisites and conflicts, point budgets, explicit item incompatibilities, build cost, bounded candidate search, before/after validation, and patch comparisons.

AI is optional and may only interpret free-form goals, order competing preferences, explain already-computed tradeoffs, and return a candidate in the strict `RecommendationCandidate` schema. The provider cannot introduce an item, ability, source, or fact outside the supplied allowlists. Every parsed response is applied to a copy of the build and sent through the deterministic validator. A failed schema, citation, source-freshness, tool, timeout, or validation check yields the deterministic fixture fallback or a visible abstention.

## Typed tool outcome

Every external tool returns a discriminated result:

```ts
type ToolOutcome<T> =
  { ok: true; data: T; trace: ToolTrace } | { ok: false; error: ToolError; trace: ToolTrace };
```

`ToolTrace` records the tool name, sanitized status/message, mode, duration, nonsecret source identifiers, and start time. It never contains authorization headers, API keys, full prompts, raw provider output, account identifiers, or request bodies.

## State and data flow

Builds are plain typed objects. Browser persistence is explicit and local; JSON export includes the selected build, goals, validation, recommendation, dataset metadata, source cards, and retrieval timestamps. No server database exists. Live profile output is transient and is not written to local storage automatically.

The fixture includes synthetic names and values designed to exercise the engine. Official documentation establishes route contracts, privacy behavior, cache/rate-limit behavior, and the live API version; it does not validate the fixture's fictional item balance.
