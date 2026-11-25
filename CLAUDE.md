# Quasar (formerly Arch) — project notes

Two products live here:

- **`browser/`: Quasar**, the main product. It's an Electron, Arc-style browser shipped as a self-updating
  Windows installer. Almost all work happens here.
- `extension/` + `themes/`: the older Chrome extension and themes ("Arc+Chrome"). These are rarely touched.

## Run it

```
cd browser
npm install          # first time only
npm start
```

To test without touching your real profile (`%APPDATA%\Quasar`), set `ARCH_USER_DATA` to an
empty folder first. Use PowerShell: `$env:ARCH_USER_DATA = "$env:TEMP\qtest"; npm start`.
A plain `--user-data-dir` does **not** work: a running Quasar holds the single-instance lock
and the new process just exits.

There are no automated tests. A quick check is `node --check` on every `src/**/*.js` and
`ui/*.js`, then a launch on a test profile while you watch the console for errors.

## Layout

- `browser/src/main.js`: app start and every `ipcMain` handler. Page IPC checks
  `e.senderFrame === e.sender.mainFrame` and validates its arguments. Keep it that way.
- `browser/src/shell.js` + `browser/src/shell/*.js`: the window/tab/Space logic, split by area
  (mixins on the `Shell` class).
- `browser/src/preload.js`: the bridge for Quasar's own UI pages (`window.arch`).
  `page-preload.js` is for web pages, which never get `preload.js`.
- `browser/ui/`: Quasar's own pages (sidebar `index.html`/`app.js`, settings, library, passwords…).
- `browser/src/passwords.js`: passwords/addresses/cards, encrypted with Electron `safeStorage`
  in `%APPDATA%\Quasar\passwords.bin`.
- `browser/src/app-update.js`: the installer's self-update (electron-updater → GitHub Releases).
  `updater.js` updates only the Electron engine for old zip copies.

## Releasing

Full guide: `PUBLISHING.md`. In short:

1. **Propose** the next version (small semver bumps are preferred) and wait for the owner's OK.
   A published version can't be reused, so any rebuild after publishing needs a bump.
2. Set `version` in `browser/package.json` and the `**Version X.Y.Z**` line in `browser/README.md`.
3. Add an entry for the version in `browser/src/whats-new.js` (shown once after updating).
4. `powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -Notes "What changed"`
   This builds `dist\installer\Quasar-Setup-<ver>.exe` and creates a GitHub Release.

Releases go to the **public** repo `ThatPineappleKing/quasar` (saved in `tools/github.json`).
**Never change that owner/repo**: installed copies look for updates only there.
The source code is backed up separately in the **private** repo `ThatPineappleKing/quasar-source`
(git remote `origin`). Never push source to the public releases repo.

The installer isn't code-signed, so Windows SmartScreen warns on first install
("More info › Run anyway").

## Branches

`master` is the main branch. Short-lived feature branches (e.g. `ui-cleanup`) get merged into it.
