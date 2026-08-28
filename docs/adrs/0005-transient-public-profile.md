# ADR 0005: Transient, identity-free public-profile import

- Status: accepted
- Date: 2026-08-28

## Context

A public player name can make local build setup faster, but the official profile response may contain account and character identifiers that are unnecessary for recommendation logic. The hosted portfolio also has no trusted backend and must not send a visitor's name to GitHub Pages or replace a failed live lookup with a convincing fixture response.

## Decision

Enable public-profile lookup only in the local Vite development runtime backed by the loopback Node service. Accept a Minecraft username in a POST body, keep it in memory for the open panel, and erase it when the lookup is cleared or closed. The server calls the documented public profile and character-list routes, then normalizes both responses into an identity-free allowlist containing only coarse availability, online state, character class, and level. It never returns the selector, UUID map keys, character identifiers, nicknames, raw restrictions, or unexpected fields.

The public Pages build displays the capability and its local-only limitation but cannot submit a lookup. Fixture mode returns an explicit unavailable result; it never impersonates a successful profile import. Profile responses bypass caches and persistence, and exports and saved builds contain no lookup identity.

The preview can copy a selected character's class and level into the manual build only after an explicit action; abilities selected for another class are removed, while equipment is untouched and revalidated. Missing equipment, exact rolls, powders, tomes, bank contents, currency, derived combat totals, and unused ability points remain manual or unknown because the public API does not establish them. A profile response therefore cannot silently create or validate a complete build.

## Consequences

The local workflow can verify that a public profile exists and show the limits of the available evidence without turning a player identity into application state. The hosted demo remains privacy-safe and fully useful with synthetic fixtures. Importing character-specific build fields would require a separate typed normalizer, explicit field-level provenance, deterministic mapping, and another privacy review.
