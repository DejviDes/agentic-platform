// platform.js – which OS the server runs on (2026-11-26). Mac-only things (Touch ID, pmset, osascript, notifier, launchd)
// are disabled outside macOS. AGENTIC_PLATFORM=linux|win32 is only for testing on a Mac.
export const PLATFORM = process.env.AGENTIC_PLATFORM || process.platform;
export const IS_MAC = PLATFORM === 'darwin';
