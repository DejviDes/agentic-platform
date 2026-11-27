# Agentic Platform features

**English** · [Slovenčina](sk/FEATURES.md)

A catalog of everything the city can do. During setup the AI explains from here what the user is turning on (`docs/SETUP.md`). Status: **done** = in the package and working, **in preparation** = not in the package yet.

## City

| Feature | What it does | Edition | Status | Requirements, setting |
|---|---|---|---|---|
| **City from folders** | Building = a folder with a group of projects, floor = a project. The city builds itself from real folders and Claude Code sessions. | Core | done | `buildings` in `world.json` |
| **Archive** | A project without activity for N days moves to the "archive" annex and returns to the tower on the first work. | Core | done | `archive`, `archiveAfterDays` |
| **Layers scene** | A calm city of slabs, the office as a small city of the team, fast. | Core | done | `"city": "layers"` |
| **Classic city** | Glass towers with windows, interiors, little agent figures. | Core | done | `"city": "classic"` |
| **Status on the building** | A floor where an agent works pulses gently; where it waits for your approval it gets a strong band in the building color. A "waiting for you" counter in the top bar. | Core | done | |
| **Brain** | A building in the middle of the city: your notes folder (Obsidian or plain markdown). Agents propose notes about decisions and findings there. | Full (also possible in Core) | done | `brain` |
| **Language** | English or Slovak interface, server texts and agent instructions. | Core | done | `"language": "en"` or `"sk"`, also in Settings |

## Agents and work

| Feature | What it does | Status | Note |
|---|---|---|---|
| **Floor office** | On every floor a lead and a team of members (`.claude/agents/*.md` in the project). | done | |
| **Chat with an agent** | A real Claude Code agent in the project folder (Claude Agent SDK, your subscription). Attachments and images, file previews from the answer, interactive visuals in the message. | done | |
| **Approval cards** | You approve a write, a command or another agent step with a click (Allow / Reject). | done | |
| **Permission modes** | Ask, Edits without asking, Plan first, Auto. Switched next to the message field. | done | guards apply in all of them |
| **Model and effort** | Defaults in `agents`, every floor and conversation can change them. | done | |
| **Hiring a team** | The lead goes through the project and proposes team members with a card; after Hire they are written to `.claude/agents/`. | done | |
| **Delegation** | The lead sends tasks to team members, you confirm model and effort with a card. | done | |
| **Project memory** | The agent proposes a rule for the project's `CLAUDE.md` or a note, written after your click. | done | |
| **Work plan** | For a longer task the agent shows a list of steps and checks them off. | done | |
| **Task router** | The "What needs doing?" field: type a task and the city suggests which floor and which agent it belongs to. | done | a fast small model |
| **Dispatch** | Write free text with several tasks; the city splits it, suggests a floor and an agent for each, and you start them all at once or later. | done | |
| **Workroom** | All conversations of the city on one screen without 3D (key W). | done | |
| **Search** | ⌘K: floors, conversations, agents. | done | |
| **Continue in the terminal** | Copies the `claude --resume` command for the open conversation. | done | |

## Control center

| Feature | What it does | Status | Note |
|---|---|---|---|
| **The app's own floor** | The Control center agent changes the city itself (look, features) on request. | done | `"controlCenter": true`, the app folder in git |
| **Change bar** | Changed files, diff, commit and push with a click. | done | push only by your click |
| **Server restart** | After a server change the agent restarts it (`mcp__agentic__restart_server`) only after your approval and a passing self-test. | done | a real restart only with the service (macOS) |

## Guards (always on, also in Auto mode)

- An agent does not write `CLAUDE.md` or `.claude/agents/` itself, it only proposes them with a card.
- An agent does not delete permanently, it moves things to the trash.
- No push to the hosts in `guards.bannedPush`, and no push or commit through the API without your click.
- An agent neither reads nor writes the server's `data/` (sessions, permissions) or sensitive files (`.env`, keys).
- The server listens only on `127.0.0.1` (not reachable from the network) and runs on the subscription, never with an API key.

## Comfort

| Feature | What it does | System | Status |
|---|---|---|---|
| **Settings** (⌘,) | Appearance, city, chat, notifications, usage, floors, scheduled tasks. | all | done |
| **Larger text** | The whole interface one step larger. | all | done |
| **Notifications** | Sound and notification when an agent waits or finishes; quiet mode and "quiet until". | all (in the window), macOS (also without the window) | done |
| **Usage** | Estimated cost of a message and subscription limits (5 h, week); Saving level (High, Medium, Low). | all | done |
| **Dictation** | Microphone in the message field, transcribed locally with Whisper (mlx). | macOS with Apple silicon | done, optional |
| **Lock** | Lock the city, unlock with Touch ID or the Mac password. | macOS | done, optional |
| **Background service** | The server starts after login and again after a crash. | macOS (launchd); Linux and Windows by the setup guide | done, optional |
| **Report a bug** (U) | Writes a report with context for the Control center. | all | done |

## Modules (in preparation)

| Module | What it will do | Edition | Status |
|---|---|---|---|
| **Home** | A district in front of the city: a personal daily overview, tasks (markdown or Notion), a calendar (`.ics` file), habits, sorting of new notes, scheduled agents (morning overview, evening summary). Adapts to whether you have a Brain and what kind. | Full | in preparation |
| **Mail** | An overview of important mail, actions Open / Done / Task. | Full | in preparation |
| **Mobile** | The city on your phone in your home network: pairing, Face ID, push notifications, a home-screen app (PWA). | Full | in preparation |

## Keyboard shortcuts

In the city: click a floor = enter, **G** = Brain, **P** = panel, **W** = Workroom, **⌘K** = search, **U** = report a bug, **Esc** = back, **?** = shortcut line. In the office: **Enter** = send, **⌘↵** = send now.
