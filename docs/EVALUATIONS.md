# Evaluation definitions and results

## Scope

The `loadout-atelier-curated-v1` suite contains 40 small, synthetic scenarios over `fixture-2026.08`. These tests establish regression behavior for the implemented contracts. They do **not** measure production recommendation accuracy, live Wynncraft balance correctness, expert preference, or complete item coverage.

Replay the suite with `npm run eval`. The machine-readable report is written to `outputs/evaluation-report.json`. A reviewed case can be promoted to a standalone regression record with `npm run eval:promote -- <scenario-id>`; promotion is explicit so an unreviewed failure cannot silently become the expected answer.

## Metric definitions

Denominators include only scenarios where the metric applies.

| Metric                  | Definition                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema validity         | External/provider payload was accepted only when it matched the expected typed schema, or rejected/fell back when malformed.                                          |
| Constraint satisfaction | The deterministic engine enforced the scenario's expected compatibility, requirement, budget, evidence, or goal constraint. Correct rejection counts as satisfaction. |
| Recommendation validity | A recommendation contained a deterministically valid proposed build, or an expected abstention contained no candidate/citations.                                      |
| Citation coverage       | Every accepted recommendation cited at least one known source and every citation ID resolved in the active dataset.                                                   |
| Correct abstention      | A scenario designed to be unsafe, unsupported, private, stale, malformed, or impossible returned no applied recommendation/output.                                    |
| Tool-selection accuracy | The scenario used the intended deterministic, Wynncraft, or DeepSeek boundary and recorded the expected sanitized trace.                                              |
| Regression stability    | Reordering inputs or comparing reviewed dataset versions produced the exact expected stable result.                                                                   |

## Latest exact result

Run on 2026-08-28:

| Metric                  |       Result |
| ----------------------- | -----------: |
| Scenario pass rate      | 40/40 (100%) |
| Schema validity         | 11/11 (100%) |
| Constraint satisfaction | 34/34 (100%) |
| Recommendation validity | 17/17 (100%) |
| Citation coverage       |   4/4 (100%) |
| Correct abstention      | 17/17 (100%) |
| Tool-selection accuracy | 40/40 (100%) |
| Regression stability    |   4/4 (100%) |

## Scenario coverage

The suite includes complete and incomplete builds, manual unavailable-item abstention without invented replacements, mixed level/skill/class/slot/duplicate/incompatibility violations, insufficient level and assigned skill points, unmet item skills, class/slot/duplicate/incompatible items, ability prerequisites/conflicts/point limits (including a combined gate case), impossible budgets, zero-change and exclusion constraints, stale and missing sources, source disagreement, incomplete/403/300 API responses, provider timeout, malformed JSON, malformed provider schema, unknown citations, unsupported absolute claims, prompt-injection-like retrieved text, provider-unavailable fallback, patch impact, selected-item invalidation, and build/dataset input-order stability.

Provider and API cases use injected deterministic fakes; they make no network calls. A separate one-request DeepSeek smoke on 2026-08-28 reached the provider but returned output that failed the candidate schema. The adapter rejected it without applying a recommendation, which verifies the fail-closed runtime path but does not establish live recommendation quality. See [VALIDATION.md](VALIDATION.md).
