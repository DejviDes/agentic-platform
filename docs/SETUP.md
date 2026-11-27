# Setting up Agentic Platform (instructions for the AI)

**English** · [Slovenčina](sk/SETUP.md)

This file is for the AI assistant (Claude Code or another AI in this folder) that walks the user through setup. A person can read it too, but usually just says "set up my city".

## How to lead the conversation

- **One topic at a time.** For each feature say in one or two sentences what it does and what the user gets from it, suggest the recommended choice and ask. Do not dump all the questions at once.
- **Speak the user's language.** English by default. If the user writes in Slovak, answer in Slovak, follow `docs/sk/SETUP.md` and set `"language": "sk"` (the interface and agent instructions then switch to Slovak). For another language answer in it and tell the user the interface is in English or Slovak.
- **Run nothing silently.** Before each command say briefly what it does. Change nothing outside the app folder without consent (exception: the service file in step 10, also only after consent).
- **Never an API key.** The city runs on the Claude subscription through the signed-in Claude Code CLI (`claude auth login`). If `ANTHROPIC_API_KEY` is set, say that the city removes it before starting agents.
- **Invent nothing.** Take paths from the output of `setup/verify.mjs` or from the user. If you do not know something, ask.
- **Everything can be changed later.** When unsure, pick the simpler option and say it can be changed with "change the city settings".
- Collect the answers and write `world.json` **only at the end**, after a summary and consent (step 11).

The catalog of all features with descriptions is in `docs/FEATURES.md`. When the user asks "what is that?", answer from it.

## 0. Find out where we are

```bash
node setup/verify.mjs --json
```

- `app.worldJson: true` → the city is already set up. Show the current setup (`app.buildings`, `app.brain`, `app.modules`) and ask what to change. Go through the relevant steps only and finish with step 11 (changed parts only).
- Otherwise go through the whole procedure. Greet the user and say in two sentences what is coming: "We will go through about 10 short questions (5 to 10 minutes). At the end I will start the city and show you how to use it."

## 1. Requirements

| Check | If missing |
|---|---|
| `node.ok` (Node 22+) | macOS: `brew install node` or `nvm install 22`. Linux: nvm. Windows: the installer from nodejs.org. |
| `claude.installed` | Install Claude Code following the official documentation (docs.claude.com, Claude Code). |
| `claude.loggedIn` | The user runs `claude auth login` in a terminal and signs in with their subscription (Pro or Max). Do not do it for them, it needs a browser. |
| `git.installed` | Recommend installing it (the Control center, change history and updates need it). |
| `app.packagesInstalled` | Run in step 11 (`npm install`). |
| `port.free` | Port 4747 is taken (the city or another server is already running). Use another port in step 11 (`PORT=5050 npm start`). |

System: the city runs on macOS, Linux and Windows (the server is Node). macOS is tested; on Linux and Windows the Mac-only features (Touch ID, system notifications, Mac sleep, dictation) are switched off, the procedure is in "Linux and Windows" after step 10.

## 2. Edition

Ask which edition the user wants. The edition is only a preset, modules can be turned on or off any time.

| Edition | What it contains | For whom |
|---|---|---|
| **Core** | The 3D city of your projects: buildings, floors, a lead and a team of agents on every floor, chat, approvals, Workroom, Control center | anyone who wants an overview of projects and agents |
| **Full** | Core + Brain (your notes, e.g. Obsidian) + the Home district (daily overview, tasks, calendar, habits, scheduled agents) + the city on your phone | anyone who also wants a personal "life hub" |

Note: the Home, Mail and Mobile modules are still in preparation (see `docs/FEATURES.md`, the Status column). If the user picks Full, say so and set up Core + Brain for now; the modules come later.

## 3. About the user

1. **Name**: how agents and cards should address them (`user.name`). The name is not sent anywhere, it stays in `world.json`.
2. **City they live in** (optional): only for the exact sunrise and sunset in the day colors. Write approximate coordinates `location: { "lat": …, "lon": … }` (two decimals are enough). Without it the location is estimated from the time zone.
3. **Language**: `"language": "en"` (default) or `"sk"`. It can also be switched in Settings.

## 4. Buildings (projects)

The city is built from real folders: **building = a folder with a group of projects, floor = one project (a subfolder)**. The city computes floor activity from Claude Code sessions.

1. Show the `candidates` from the check (path, number of folders, how many are in git or have a `CLAUDE.md`) and ask which groups should be buildings. At most 5 buildings.
2. For each building: a key (lowercase, no spaces), `title`, `color` (offer from the palette `#14a3b8` teal, `#8a6cff` violet, `#4f7cff` blue, `#2bb68a` green, `#e0739a` pink, `#f2a65a` orange), `root`, folders to skip (`exclude`).
3. **Archive:** a project without activity for 30 days goes to the "archive" annex and returns on the first work (`archive: true`, length `archiveAfterDays` at the top level). For a building where the user does not want that (e.g. courses during a semester), `archive: false`.
4. **Only projects with `CLAUDE.md`** (`onlyWithClaudeMd: true`): useful when the folder also holds things that are not projects.
5. **A study building** (optional, offer it to students): floor = a course, the course notes are in one folder (`root`) and the assignment code in another (`code`, folders named `<CODE>` or `<CODE>-…`), `subjectCode: true`. Sessions from both count for the course.
6. Single projects can be renamed, hidden, ordered or moved to another building in `floors` (see `world.example.json`). This can also be done later right in the app (Settings › Floors).

If the user is unsure, start with one building over the folder with projects.

## 5. Brain and notes

The Brain is a building in the middle of the city: a folder with notes (a second brain) where agents propose notes about decisions and findings. A note is always written only after a click on the card.

Ask: **"Do you keep notes? Where?"** and depending on the answer:

| Answer | What to set |
|---|---|
| **Obsidian** | Offer the vaults from the check (`obsidian`). `brain: { "title": "Brain", "path": "<vault>", "kind": "obsidian" }`. Agents write markdown with `[[…]]` links. |
| **A folder of markdown files** (Logseq, iA Writer, a Bear export, VS Code…) | `brain: { "title": "Brain", "path": "<folder>", "kind": "folder" }`. |
| **Notion, Apple Notes, OneNote or another cloud app** | The city does not read them locally. Offer two options: no Brain (leave out `brain`, notes stay in project folders), or create a simple folder `~/Notes` as a new Brain. Notion can be connected to agents through the Notion MCP, that is outside the city setup. |
| **I don't have any** | Suggest no Brain. Agents then propose notes and decisions into the project folder (`"notes": "folder"` on each building). If the user wants, create `~/Notes`. |

Optional Brain keys: `private` (top-level folders shown without names in the app) and `omitOrphaned` (folders skipped when looking for notes without links), see `world.example.json`.

**Brain rules:** if the vault has a `CLAUDE.md`, agents follow it (where to write, what never to change). If it does not, offer a short `CLAUDE.md` for the vault with 3 rules: new notes go to the `Inbox/` folder, existing ones are only extended, nothing is deleted. Write it only with consent.

**Where project notes go** (decisions, status, TODO that an agent proposes with a card): ask for each building and write it as the building's `notes`:

| Choice | `notes` |
|---|---|
| into the Brain, one file per project | `"~/Notes/Projects/{slug}.md"` (`{slug}` = folder name in lowercase with dashes, `{name}` = exact folder name) |
| into the Brain, a folder per project | `"~/Notes/Projects/{name}/"` (the agent picks the file by the folder's `CLAUDE.md`) |
| into the project folder, never into the Brain | `"folder"` |
| notes inside the floor itself (a study building where a floor is a notes folder) | `"{path}/"` |

For work and client projects recommend `"folder"`, so company things do not mix with personal notes. Without `notes` an agent proposes no notes, it only writes decisions into its answer.

## 6. Agents

The default model and effort of agents (`agents`). Recommendation: `claude-opus-5-5` and `medium`. Cheaper (`claude-sonnet-5-5`, effort `low`) saves the subscription limit. Every floor and every conversation can change it in the app.

Explain in one sentence how a team is formed: every floor has a lead; when the user asks it to "propose a team", the lead goes through the project and proposes team members with a card; after Hire they are written to `.claude/agents/` in the project.

## 7. City look

| Scene | Description |
|---|---|
| **Layers** (recommended) | A calm city of slabs, fast even on a weaker computer. Floor = a slab, the office as a small city of the team. |
| **Classic city** | Glass towers with windows, interiors, little agent figures. More detail, heavier on graphics. |

`"city": "layers"` or `"classic"`. Also switchable in the app (Settings › Appearance).

## 8. Control center

The Control center is the floor of the app itself: its agent can change the city (look, features) on request, and you start commit or push with a click. On by default (`"controlCenter": true`). It needs the app folder in git: if `git.appInGit` is `false`, with consent run `git init -b main && git add -A && git commit -m "My city"`.

## 9. Guards

Guards always apply, also in Auto mode. Explain them briefly (see `docs/FEATURES.md`, section Guards) and ask only one thing: **are there git servers agents must never push to?** (a company GitLab, a school server). Write the hosts to `guards.bannedPush`.

## 10. Optional extras

Offer them one at a time, only if they make sense for the user's system.

| Extra | System | What it needs |
|---|---|---|
| **Background service** (the server starts after login and restarts itself) | macOS | `bash launchd/install.sh` (fills in the template, does not start the service, prints the commands to turn it on) |
| **Dictation** (microphone in the message field, transcribed locally with Whisper on the Apple chip) | macOS with Apple silicon | `uv` and `ffmpeg`; the model downloads on first use (about 1.5 GB) |
| **App check** `npm run check` (only if the user will change the city's code) | all | `npx playwright install chromium` (about 150 MB) |
| **Home, Mail, Mobile** | | in preparation, leave `modules` at `false` |

On Linux and Windows offer the service from "Linux and Windows" below.

## Linux and Windows

macOS is tested and ready. On Linux and Windows the server starts and switches the Mac-only features off by itself. `node setup/verify.mjs` reports the system in `system` (`os`, `title`, `mac`, `linux`, `windows`, `wsl`) and on Linux also `linux.systemd` and `linux.service`, on Windows `windows.task`. Pick the procedure by that and tell the user in one sentence what will not be there on their system:

| Thing | On Linux and Windows |
|---|---|
| City lock (Touch ID) | off. The app is protected only by the server listening on `127.0.0.1`. Say so explicitly on a shared computer. |
| System notifications | only in the app window (beep and browser notification), no system notifications |
| Mac sleep | the Mac category in Settings is not shown |
| Terminal button at a conversation, folder picker through Finder | not available; in floor management enter the folder as a path |
| Opening a file in the system | Linux `xdg-open`, Windows `start` |
| Task in the Claude desktop app (`mcp__agentic__run_in_claude_app`) | macOS only |
| Server restart by an agent (`mcp__agentic__restart_server`) | not available, the user restarts the server (commands below) |

### Linux: systemd user service

1. Check `linux.systemd` (`systemctl --user` works). If not (e.g. WSL without systemd), stay with `npm start`.
2. Find the paths: `command -v node`, `command -v claude` and the app folder.
3. Write `~/.config/systemd/user/agentic-platform.service` (fill in the real paths; `PATH` must contain the folders of both `node` and `claude`):

```ini
[Unit]
Description=Agentic Platform
After=network.target

[Service]
WorkingDirectory=/path/to/app
ExecStart=/path/to/node server.js
Environment=PATH=/home/user/.local/bin:/path/to/node/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

4. Tell the user the commands (run them yourself only with consent): `systemctl --user daemon-reload`, `systemctl --user enable --now agentic-platform`. Log: `journalctl --user -u agentic-platform -f`, restart: `systemctl --user restart agentic-platform`. To keep it running without being logged in: `loginctl enable-linger $USER`.

### Windows

- Recommend **WSL 2** (Ubuntu) and the Linux procedure inside it: Claude Code and the command guards are written for a POSIX shell. The user then opens the app in a Windows browser at `http://localhost:4747`.
- Native Windows: Node 22+, Claude Code for Windows (needs Git for Windows), `npm install`, `npm start` in the app folder. It is less tested, say so.
- Start after login (native): Task Scheduler. Show the user the PowerShell command and let them run it (fill in the path):

```powershell
$a = New-ScheduledTaskAction -Execute "node.exe" -Argument "server.js" -WorkingDirectory "C:\path\to\app"
$t = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "AgenticPlatform" -Action $a -Trigger $t -Description "Agentic Platform"
```

  Stop: `Stop-ScheduledTask AgenticPlatform`, remove: `Unregister-ScheduledTask AgenticPlatform`. Dictation (mlx-whisper) is macOS only.

## 11. Summary, writing and starting

1. Show a summary in a few lines (name, language, buildings with paths, Brain, scene, Control center, guards, extras) and ask "May I write it like this?".
2. Write `world.json` following `world.example.json` (only the filled-in keys, without the `_note` comments).
3. Check without a server: `node build-world.js` prints the buildings and floors. If a building is empty, fix its `root`.
4. `npm install` (if it has not run yet).
5. Start: with the service from step 10, otherwise `npm start` in the background (so you can continue the conversation), or let the user start it in their own terminal. Another port: `PORT=5050 npm start`.
6. Tell the user to open **http://localhost:4747**.

## 12. First steps (a short tour)

Walk the user through this, one sentence each, and point to `docs/USAGE.md`:

1. The city shows their buildings. Drag to rotate, wheel to zoom, click a floor to open its office.
2. In the office, give the lead a short task. When writing or running a command, the agent asks for approval with a card (Allow / Reject). Permission mode, model and effort are next to the message field.
3. "Propose a team" → a card with proposed team members → Hire.
4. The "What needs doing?" field in the city overview suggests which floor a task belongs to.
5. Key **W** switches to the Workroom (all conversations of the city without 3D), **⌘,** opens Settings.

Finally tell the user that the setup can be changed any time with "change the city settings" (here in the app folder or in the Control center).

## Troubleshooting

| Problem | Cause and fix |
|---|---|
| `EADDRINUSE` on `npm start` | Port 4747 is used by another server (also the service). `PORT=5050 npm start`, or stop the other one. |
| An agent reports 401 or "not logged in" | `claude auth login` in a terminal, then `claude auth status`. |
| The city is empty | `world.json` is missing or the paths in `root` are wrong. `node build-world.js` prints buildings and warnings. A building without floors is not built. |
| A project is missing from the tower | It is in the archive, hidden, or the building has more than `maxFloors` floors. For the floor set `"archive": false` in `floors`. |
| `claude: command not found` in the service | The service does not have the terminal's PATH. Check PATH in `start.sh` (`~/.local/bin`, Homebrew, node from nvm). |
| `npm run check` reports that the server is not running | Start the server first. Another port: `npm run check -- http://localhost:5050`. |
| A red mark in the app header | The server does not respond. See the log (macOS `~/Library/Logs/agentic-platform.log`, Linux `journalctl --user -u agentic-platform`, otherwise the terminal). |
| Linux: the service cannot find `claude` | `Environment=PATH=` in the service file lacks the folder with `claude` (usually `~/.local/bin`). Fix it, `systemctl --user daemon-reload` and restart. |
| An agent cannot write `CLAUDE.md` or `.claude/agents/` | That is a guard. The agent proposes them with a card; they are written after your click. |
| The subscription limit runs out fast | A lower model or effort, a new conversation instead of a very long one. The app shows the estimated cost, and Settings › Usage has the saving level. |
