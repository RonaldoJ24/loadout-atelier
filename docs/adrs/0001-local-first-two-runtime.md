# ADR 0001: Local-first browser plus optional Node service

- Status: accepted
- Date: 2026-08-28

## Context

The portfolio needs a public, reliable demo while provider credentials and live-service policy cannot be delegated to browser code.

## Decision

Publish a fixture-first Vite/React application to GitHub Pages. Keep live Wynncraft reads and DeepSeek calls in an optional local Express service. The browser remains useful when that service is absent.

## Consequences

Recruiters can explore the complete analytical workflow without keys or uptime dependencies. The hosted demo cannot perform live profile lookup or provider-assisted explanation; it labels that limitation directly. A future production deployment would require a separately secured backend and retention/privacy review.
