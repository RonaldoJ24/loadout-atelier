# ADR 0002: Deterministic engine is the recommendation authority

- Status: accepted
- Date: 2026-08-28

## Context

Build compatibility and patch comparisons are exact computations. A language model is useful for interpreting competing preferences, but it cannot be trusted to invent or validate game state.

## Decision

All proposals, including provider output, use a strict schema, known-ID/source allowlists, and a final deterministic recheck. The product falls back or abstains when the gate fails.

## Consequences

Recommendations are reproducible and failure behavior is testable. The deterministic engine and fixture coverage become explicit product limitations rather than hidden model assumptions.
