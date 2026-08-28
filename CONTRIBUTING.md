# Contributing

Loadout Atelier welcomes focused bug fixes, tests, accessibility improvements, and typed adapter updates.

1. Use Node 22 or newer and run `npm ci`.
2. Create a focused branch from `main`.
3. Keep deterministic rules separate from AI explanation code.
4. Add or update a regression scenario for every recommendation or validation fix.
5. Run `npm run acceptance` before opening a pull request.

Do not commit API keys, player identifiers, copied game assets, private profile data, provider payloads, or full live database snapshots. New official-data integrations must cite current Wynncraft documentation, honor access rules and rate limits, and include fixture-backed failure tests.

By contributing, you agree that your contribution is licensed under the repository's MIT License.
