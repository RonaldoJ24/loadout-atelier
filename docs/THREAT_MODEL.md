# Security, privacy, and threat model

## Assets

- optional `DEEPSEEK_API_KEY` in a local process environment;
- optional transient public Wynncraft profile/character responses;
- user-authored local builds;
- recommendation integrity and evidence provenance;
- repository, CI logs, screenshots, build artifacts, and exported summaries.

## Trust boundaries

The browser is not trusted with provider secrets. Wynncraft responses, provider responses, imported builds, local storage, free-form goals, source text, and URL parameters are untrusted inputs. The deterministic engine is the authority for validity but still receives schema-checked data.

## Primary threats and controls

| Threat                                      | Control                                                                                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider key reaches browser or repository  | Server reads `process.env`; no `VITE_*` key; secret env files ignored; safe example only; repository/history/build/artifact scans.                             |
| Prompt injection in retrieved material      | Retrieved text is data, delimited and length-bounded; instructions are discarded; IDs/sources are allowlisted; deterministic recheck is mandatory.             |
| Malformed or adversarial model output       | JSON-only request; strict Zod schema; unknown keys fail; bounded arrays/strings; no tool execution from model output.                                          |
| Invented or unsupported recommendation      | Candidate item/ability/source IDs must exist; citations must cover claims; applied build must pass the engine; otherwise fallback/abstain.                     |
| Private profile data is retained or exposed | No accounts/database; optional lookup is transient; restrictions/403/incomplete responses stop import; UUIDs and bodies are excluded from traces/logs/exports. |
| Privacy changes after caching               | Player responses use short memory caching only; restricted responses are not cached as builds; no persistent server store.                                     |
| Rate-limit abuse                            | Route-aware cache, one bounded attempt, no credential pooling, visible rate metadata, no retry for 300/403/404.                                                |
| Denial of service / oversized payload       | Request body size limit, fetch timeouts, bounded response parsing, local-only service default.                                                                 |
| Stale fixtures presented as current         | Prominent fixture state, retrieval/version cards, stale threshold, recommendation abstention when stale.                                                       |
| Cross-origin misuse of local server         | Same-origin/local origin allowlist, JSON content type, no credentialed wildcard CORS.                                                                          |
| Export leaks                                | Export is generated from build/config/result metadata only; profile/account identifiers are excluded.                                                          |

## Non-goals

The MVP has no accounts, cloud database, OAuth, payments, social layer, public write API, automated trading, or game-client integration. It does not promise complete item coverage, gameplay correctness, production availability, or resistance to a hostile local machine.
