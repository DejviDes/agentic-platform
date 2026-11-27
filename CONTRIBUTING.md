# Contributing to Agentic Platform

Thanks for your interest. Agentic Platform is a personal project shared as **source-available** software (see [LICENSE](LICENSE)). Contributions are welcome, within a few ground rules.

## How development works

- The project is developed in a private repository. This public repository receives **one commit per release** (with a `vX.Y.Z` tag), produced by an automated release process.
- Because of that, pull requests are **not merged directly**. If a change is accepted, it is applied in the private repository and appears in the next release, with credit in [CHANGELOG.md](CHANGELOG.md) if you want it.

## Good ways to help

- **Report a bug** using the issue template. Include your operating system, Node.js version, the Agentic Platform version (`package.json`) and the steps to reproduce.
- **Suggest a feature** using the feature request template. Describe the problem first, then your idea.
- **Send a pull request** for a small, focused fix. For anything bigger, open an issue first so we can agree on the approach.
- **Share your setup** on Linux or Windows: what worked and what the setup guide should say. macOS is the tested platform; other systems are set up with the help of your AI assistant.

## Pull request checklist

- One topic per pull request, with a short description of what and why.
- `npm run check` passes.
- No personal data in code, examples or screenshots (paths, names, e-mails, tokens). Use the demo data.
- Keep the existing style: plain ES modules, no build step, no new dependencies without a discussion.

## License of contributions

By submitting a contribution (pull request, patch or code in an issue), you agree that it is provided under the terms in section 3 of the [LICENSE](LICENSE): the copyright holder may use, modify, distribute and relicense it as part of the software. Only contribute code you wrote yourself or have the right to share.

## Security

Please do not report security problems in public issues. See [SECURITY.md](SECURITY.md).
