# Agentic Platform

A local app: the user's projects as a 3D city. A building = a group of projects, a floor = a folder, on each floor a lead and a team of agents (`.claude/agents/*.md`) through the Claude Agent SDK. Server `server.js` (Node 22+, `127.0.0.1:4747`), app in `public/` (ES modules, no build step). Settings are in `world.json` (template `world.example.json`).

## Setup comes first

**If `world.json` does not exist, or the user wants to set up the city or change buildings, notes or modules, follow `docs/SETUP.md` exactly** (skill `city-setup`). Ask about one topic at a time, explain from `docs/FEATURES.md`, write `world.json` only after a summary and the user's consent.

## Code rules

- UI state changes only through `setState({ ... })` from `public/app/state.js`.
- ES modules without a build step, Three.js 0.160 through the importmap in `public/index.html`. Modules import each other in a cycle, so only declarations at module top level.
- Performance is a priority. For a new 3D element say what it costs and measure it: `?perf` in the address, then `__perf.test(60, true)` in the console.
- Custom controls, never a native `select` or `confirm`. Icons are line SVGs (`public/app/icons.js`), not emoji.
- After a change in `public/app/` or on the server run `npm run check` (`tests/check.mjs`; needs a running server and Chromium from `npx playwright install chromium`). `node server.js --selftest` loads all modules and builds the world without starting the server.
- UI texts go through `t('key')` with both languages: `public/app/i18n/en-*.js` and `sk-*.js` for the app, `i18n/en.js` and `sk.js` for the server.
- The server listens only on `127.0.0.1` and runs on the subscription (`claude auth login`), never with an API key.
- `data/` and `world.json` do not belong in git.
- In regular expressions on Slovak or Czech text do not use `\b` without the `u` flag; use `(?![\p{L}])` with the `u` flag.
- An agent never writes `.claude/agents/` or a floor's `CLAUDE.md` itself, it proposes them with a card (`mcp__agentic__propose_team`, `mcp__agentic__propose_memory`).

## Documentation

| You need | Where |
|---|---|
| setup, `world.json`, troubleshooting | `docs/SETUP.md` |
| what the city can do, modules | `docs/FEATURES.md` |
| how to use it | `docs/USAGE.md` |
| Slovak versions | `README.sk.md`, `docs/sk/` |
