# Release validation

This document records the release-candidate evidence for `0.1.0`. It distinguishes reproducible offline checks from the single bounded network check.

## Reproducible acceptance

Environment used locally on 2026-08-28: macOS, Node.js `v26.3.1`, npm `11.16.0`, Chromium installed by Playwright.

| Check                                                                        | Result                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Prettier format check                                                        | Passed                                                                           |
| ESLint with zero warnings                                                    | Passed                                                                           |
| TypeScript project build/type check                                          | Passed                                                                           |
| Vitest unit, contract, provider, source, server, UI, and evaluation tests    | 51/51 passed across 6 files                                                      |
| Curated evaluation scenarios                                                 | 34/34 passed; exact metric denominators in [EVALUATIONS.md](EVALUATIONS.md)      |
| Vite production build                                                        | Passed                                                                           |
| Playwright happy path, failure, mobile, export, and Axe accessibility checks | 5/5 passed                                                                       |
| Package audit at high severity                                               | 0 vulnerabilities                                                                |
| Secret scan                                                                  | Passed across working tree, built text artifacts, and Git history                |
| Responsive visual review                                                     | Desktop workspace, comparison, evaluation desk, and 390 px mobile view inspected |

Run the reproducible suite with `npm run acceptance`, then run `npm audit --audit-level=high`.

## Bounded live-provider check

Exactly one DeepSeek request was made after the offline suite passed. The credential was sourced directly into the local process from the user-provided ignored environment file; it was not printed, copied, persisted, or exposed to browser code. The smoke script logs only sanitized status, model name, duration, tool name, and a safe message.

Result: the request reached `deepseek-v4-flash` in 2,525 ms, but the returned object did not satisfy `RecommendationCandidate`. The adapter rejected the result with `schemaValid: false`; no recommendation, provider body, prompt body, or credential was recorded. The request was not retried.

This outcome validates secure connectivity and fail-closed handling. It does **not** validate live recommendation quality, availability, or schema adherence. Deterministic fixture-backed adapter tests are the stable provider contract evidence for this release.

## Visual evidence

- [Analytical workspace](screenshots/workspace.png)
- [Current versus recommended comparison](screenshots/comparison.png)
- [Evaluation desk](screenshots/evaluations.png)
- [Responsive mobile view](screenshots/mobile.png)

All screenshots use synthetic fixture data and contain no personal player identifier or provider content.
