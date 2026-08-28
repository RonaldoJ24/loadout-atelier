# ADR 0003: Versioned synthetic fixture for the public demo

- Status: accepted
- Date: 2026-08-28

## Context

The official API is mutable, privacy-aware, rate-limited, and not guaranteed to remain available. Shipping a full copied game database would add copyright, freshness, and maintenance risk.

## Decision

Ship a small original fixture with fictional item/ability names and numbers, aligned only to documented v3 contract concepts. Include current and previous versions for patch-impact regression scenarios.

## Consequences

The demo is reliable and evaluation failures are replayable. It must clearly avoid claiming live balance accuracy or complete item coverage. Live official data remains an opt-in local tool path.
