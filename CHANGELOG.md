# Changelog

Every release has its own version (a `vX.Y.Z` tag in the repository). Update with `npm run update`, which downloads only the changes and shows you what is new. Y goes up with new features, Z with fixes.

## 0.2.2 (2026-11-27)

Tidier repository: server modules moved to server/, the README shows up right away.

- **A short top-level folder:** on GitHub the README now appears right below a few files. The server modules live in `server/`, the start script in `scripts/`, the sample settings in `setup/world.example.json`, the Slovak README in `docs/`, and the contribution and security guides in `.github/`.
- **Nothing changes for your city:** `npm start`, `node server.js` and your `world.json` and `data/` stay where they were.
- **The launchd service is updated for you:** on macOS `npm run update` points the service to the new `scripts/start.sh` and reloads it (a backup of the service file is kept next to it).

## 0.2.1 (2026-11-27)

Better screenshots and a Workroom demo in the README.

- **Sharper pictures in the README:** screenshots in double resolution (sharp on Retina screens) and smooth animations instead of the old GIF: entering a floor with an approval card, and the Workroom.
- **The Workroom in demo mode:** without a server the Workroom now shows the sample conversations of the demo city (waiting for you, running, done today). Approve a step right in the list or open a team's conversation, nothing is sent anywhere.
- **Control center in the English demo:** the sample Control center floor no longer shows its Slovak name.
- **A new section about the Workroom** in the README and pictures in the usage guide.
- **Translation check:** the built-in check now stops when a text is missing in English or Slovak.

## 0.2.0 (2026-11-27)

The first public release, now called **Agentic Platform**.

- **English first, Slovak included:** the interface, the instructions for agents and all messages are in English. Switch to Slovak in Settings › Appearance › Language.
- **English code:** files, functions, API paths and the settings file are in English. Your settings file `svet.json` becomes `world.json` and the files in `data/` are converted on the first start, with a backup.
- **All platforms:** macOS is tested and ready. On Linux and Windows the server runs and Mac-only features (Touch ID lock, system notifications, sleep control, the launchd service) switch off; the setup guide helps your AI set up a systemd service or Windows Task Scheduler.
- **Start a task in a new session:** a lead can propose a bigger task as a card with an editable brief; one click starts it in a new conversation on the same floor while you keep talking in the current one.
- **Scribe and Chronicler:** after a turn with a decision or a commit, Scribe proposes a note for your notes on a card you accept or skip (at most 40 a day). Chronicler runs at night, compares the day with your notes, fixes what is clear and asks you about the rest.
- **Brain activity:** when agents read or write notes in your Brain (notes folder), the Brain shows it live, with today's activity and orphaned notes you can ask an agent to link.
- **Questions with options:** when an agent asks you to choose, a card with options and your own answer appears in the chat.
- **Conversation titles** follow the topic; a title you set yourself stays.
- **Mac sleep modes (macOS):** normal, while agents work, or never, with battery and overheating guards.
- **License:** source-available [Agentic Platform License](LICENSE). Free to use and modify for yourself; see the README for a summary.
- **One-command update:** `npm run update` downloads only the changes since your version, shows the news, runs `npm install` (only when needed) and restarts the service. If the new version fails the self-test, it rolls back. `npm run update -- --verify` only tells you what is new.
- **Saving level in Settings (Usage):** high, medium or low. It controls how much of the 5-hour limit one message may use, the context threshold, the cap for scheduled tasks and the highest model offered for delegation. Above 80 % of the 5 h limit, high switches on by itself.
- **Delegation at the high saving level** offers at most Sonnet and medium effort (you can change it on the card). A scheduled task that exceeds its cap stops.

## 0.1.0-alfa

- First private test release (as „Mesto agentov“): the Core edition (a city with agent teams, the Layers and Classic scenes, a setup guide for the AI).
