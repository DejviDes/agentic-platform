# Settings migrations

When a new version needs to change your settings (for example a renamed key in `world.json`), a file `<version>.mjs` appears here, for example `0.3.0.mjs`. After downloading, `npm run update` runs every migration between your version and the new one, oldest first.

The file exports one function:

```js
export default async function ({ root, home, listing }) {
  // root = the app folder, home = the user's home folder, listing(text) = a message to the console
  // A migration must be safe to run more than once and must back up world.json before changing it (world.json.before-<version>).
}
```

If a migration fails, the update rolls the app back to the previous version.
