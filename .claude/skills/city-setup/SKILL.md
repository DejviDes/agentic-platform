---
name: city-setup
description: Set up Agentic Platform step by step. Use when the user says "set up my city", "install", "setup", "I want to set it up", "change the city settings", "add a building", "change notes / Brain", "turn on a module" (also in Slovak: „nastav mi Mesto“, „inštalácia“, „zmeň nastavenie Mesta“), or when the app folder has no world.json yet.
---

# Setting up Agentic Platform

1. Read `docs/SETUP.md` and follow it exactly, step by step.
2. Start with `node setup/verify.mjs --json` (read only) and decide from `app.worldJson` whether this is a first setup or a change. Pick the procedure by `system` (`mac`, `linux`, `windows`): macOS is tested; on Linux and Windows use the "Linux and Windows" part of `docs/SETUP.md` (systemd service, Task Scheduler or WSL 2) and say what is switched off there (Touch ID, system notifications, Mac sleep, dictation).
3. Ask about one topic at a time. For each feature explain in one or two sentences what it does (from `docs/FEATURES.md`), suggest the recommended choice and wait for the answer. Speak the user's language; a Slovak speaker gets `docs/sk/` and `"language": "sk"`.
4. Write `world.json` only after a summary and explicit consent. Check it with `node build-world.js`.
5. At the end start the city (or say how) and walk the user through the first steps (step 12 of the procedure).
