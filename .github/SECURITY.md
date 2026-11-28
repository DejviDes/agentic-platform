# Security

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it and what an attacker could do with it.

You can expect a first reply within about a week. Fixes ship in the next release and are noted in [CHANGELOG.md](../CHANGELOG.md). Only the latest release is supported.

## How Agentic Platform is designed to stay safe

Agentic Platform runs AI agents (Claude Code) that can read and change files on your computer. Its safety model:

- **Local only.** The server listens on `127.0.0.1:4747` and is not reachable from other devices. Do not expose it to a network or the internet.
- **Your own Claude account.** Agents run on your own Claude subscription through the official Claude Agent SDK. The app never asks for or stores an API key.
- **You approve actions.** Tool calls that change things (writing files, running commands) need your click in the app, unless you have allowed them yourself.
- **Built-in guards.** A hook blocks agents from writing to the app's own data, its configuration and agent definitions, from stopping the server, from pushing to git and from approving their own actions through the API.
- **Folders you choose.** Agents work only in the folders you add as buildings and floors during setup.

## Your responsibility

Review what agents propose before you approve it, keep `world.json` (or the original `svet.json`) and the `data/` folder private, and keep Node.js and Claude Code up to date. The software is provided without warranty; see [LICENSE](../LICENSE).
