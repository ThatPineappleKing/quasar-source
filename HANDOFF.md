# Quasar: full handoff

Written 25 November 2026, right after **Quasar 2.0.0** shipped. It's for anyone picking up
this project later: a person, a future Claude session, or another coding agent (OpenCode,
Cursor, Aider, Codex…). It tries to answer every question you'd otherwise have to dig
through 1.3 MB of JavaScript to answer.

Read this file first, then `CLAUDE.md` (short rules), then `browser/README.md` (the
user-facing guide, which lists every feature in detail). `PUBLISHING.md` covers releases.

---

## 1. What this is, in one paragraph

**Quasar** (called **Arch** until 14 Nov 2026) is a Windows desktop web browser built on
**Electron** (Chromium + Node.js). It copies the look and feel of **Arc** by The Browser
Company: a vertical sidebar of tabs grouped into **Spaces**, each Space with its own colour
gradient and film grain, pinned tabs and Favorites, a Ctrl+T command bar, Little Arc-style
pop-up windows, Peek, split view, Boosts and Air Traffic Control. On top of that it adds a
large set of features borrowed from Chrome, Opera, Firefox, Brave and Vivaldi (ad blocking,
password manager, on-device translation, VPN, reader mode, task manager, etc.). It ships to
a small group of friends as a self-updating NSIS installer published on GitHub Releases.
It has **no AI features on purpose** and needs **no API keys**.

There's also an older, much smaller product in the same repo: **Arc+Chrome**, a Chrome
extension plus Chrome themes that make Chrome look somewhat like Arc. It's legacy and
rarely touched (section 15).

---

## 2. Current status (as of 2.0.0)

- **Latest release: 2.0.0**, published to `ThatPineappleKing/quasar`. Its What's New text
  tells users this is "the final update for a while" and that Quasar is becoming open source.
  So the project is in a **paused / maintenance** state. Nothing is half-built.
- The source is public under **MIT** at `ThatPineappleKing/quasar-source` (git remote `origin`).
- Branch: `master`. Nine commits in git; the history before 23 Nov 2026 was never committed
  (`7f1d939 baseline before UI cleanup` is a snapshot of everything built up to then).
- Working tree at handoff: `tools/github.json` shows as modified, but the change is only
  line endings / BOM (PowerShell rewrites the file every publish). Safe to commit or discard.
- `dist/` is git-ignored. It holds the last build: `dist/installer/Quasar-Setup-2.0.0.exe`
  (+ `.blockmap`), a staged zip copy in `dist/Quasar/`, and `dist/ui-cleanup-screenshots/`
  (before/after screenshots from the UI tidy-up).
- `quasar notes.txt` at the root is the owner's scratch notes file (currently just a title).
  It used to hold to-do items; they're all done.
- Engine: Electron **45.3.1** (Chromium 14x), electron-builder 26.18.0, developed with
  Node 26 on Windows 11.

### Release history (from `browser/src/whats-new.js` and memory)

| Version | Date | What |
|---|---|---|
| 0.x | early Nov 2026 | "Arch", shared as a zip |
| 1.2.1 | 14 Nov | First release with the Quasar name and logo (zip) |
| 1.3.0 | 15 Nov | First NSIS installer that updates itself from GitHub Releases |
| 1.3.2–1.3.3 | 19 Nov | Update-path test releases (their What's New entries are old test text, harmless) |
| 1.4.0–1.5.3 | 19–22 Nov | Feature releases |
| 1.6.0 | 23 Nov | Glass look (transparent window + optional blur backdrop) |
| 1.6.1 | 23 Nov | Sidebar footer sized like Arc's |
| 1.7.1 | 25 Nov | Site tools pinned to the top bar, Chrome/Opera habits, password hardening, Google sign-in fix |
| 2.0.0 | 25 Nov | "Final update for a while"; open-sourcing |

---

## 3. People, accounts and things you must not break

- **Owner:** GitHub user `ThatPineappleKing` (git user name "mikey"). Non-developer-ish owner
  who directs the work in plain English; AI agents have written almost all of the code.
- **Users:** the owner and friends, who installed `Quasar-Setup-x.y.z.exe`.
- **Releases repo (public): `ThatPineappleKing/quasar`.** Every installed copy has this
  baked into `resources\app-update.yml` and checks only there for updates.
  **Never rename, move, make private, or change the owner/repo of it**, and never change
  `build.publish` in `browser/package.json` or `tools/github.json`. If you do, every
  existing install silently stops updating, forever.
- **Source repo (public): `ThatPineappleKing/quasar-source`.** Push source here only.
  Never push source to the releases repo, and never upload installers to the source repo.
- **Versioning rule:** the owner chooses version numbers. Propose a bump (they prefer small
  semver bumps), wait for a yes, then apply it. A published version number can never be
  reused, so any rebuild after a publish needs a new number.
- The installer is **not code-signed**. SmartScreen shows "Windows protected your PC" on
  first install; users click More info › Run anyway. Updates after that are silent.

---

## 4. Repository layout

```
Arc+Chrome/                    (repo root; the folder name is historical)
├─ CLAUDE.md                   short rules for AI agents (read it)
├─ HANDOFF.md                  this file
├─ PUBLISHING.md               step-by-step release guide (written for the owner)
├─ README.md                   the legacy Arc+Chrome extension/themes guide
├─ LICENSE                     MIT
├─ quasar notes.txt            owner's scratch notes
├─ browser/                    ★ Quasar, the main product
│  ├─ package.json             version, deps, electron-builder config
│  ├─ README.md                the user guide (also shipped inside the app)
│  ├─ Quasar.lnk               a shortcut with this PC's paths (repaired at start-up)
│  ├─ src/                     main process (Node): ~40 files
│  │  └─ shell/                the Shell class, split into ~37 mixin files
│  └─ ui/                      Quasar's own pages (HTML/CSS/JS, run in renderers)
│     └─ backgrounds/          12 bundled mountain photos for the start page
├─ extension/                  legacy Arc+Chrome Chrome extension (MV3)
├─ themes/                     legacy Chrome themes (arc-dawn, arc-dusk, arc-night)
├─ icon/                       quasar.ico (app icon), logos, old arc-chrome icon
├─ tools/
│  ├─ publish-quasar.ps1       build the installer + create the GitHub Release
│  ├─ package-quasar.ps1       build a portable zip (older distribution path)
│  ├─ github.json              { owner, repo } for releases — never change
│  ├─ build.ps1                generates the legacy Chrome themes + icons
│  ├─ set-taskbar-icon.ps1     legacy: Chrome taskbar icon
│  └─ chrome-shortcut-backup.lnk
└─ dist/                       build output (git-ignored)
```

Size: about 23,500 lines; `ui/app.js` (sidebar, 94 KB) and `src/page-preload.js` (64 KB)
are the largest files. Lines are long; the code is dense but heavily commented.

---

## 5. Running, testing and debugging

### Run from source

```powershell
cd browser
npm install          # first time only
npm start            # = electron .
```

### Run on a throwaway profile (do this for any testing)

```powershell
$env:ARCH_USER_DATA = "$env:TEMP\qtest"; npm start
```

Why: a running Quasar holds Electron's **single-instance lock**, and a second process
exits immediately (passing its URL to the first). `--user-data-dir` does **not** get round
that. `ARCH_USER_DATA` points `userData` elsewhere, which gives a separate lock.

Things `ARCH_USER_DATA` also changes (test mode):
- `global.__arch` is the live `Shell` instance, handy from DevTools of the main process
  or a debugger.
- Shortcut repair (`windows-integration.ensureShortcuts`) doesn't run, so tests never
  repoint the real Start Menu entry. Installed site apps write their shortcuts into
  `<userData>\test-shortcuts\` instead of the Start menu.
- The welcome tour doesn't show unless `ARCH_TOUR=1`.
- What's New doesn't show unless `ARCH_WHATS_NEW=1`.
- Windows Hello checks can be faked by defining `global.__archVerify` (async fn → bool).

Other environment variables:

| Variable | Effect |
|---|---|
| `ARCH_NO_BACKGROUND=1` | Skip backup/sync and component-update background jobs |
| `ARCH_FAKE_ELECTRON_VERSION=x.y.z` | Make the engine updater think it's on another Electron |
| `ARCH_UPDATE_APP_DIR=…` | Engine updater: use this as the app folder |

Command-line flags Quasar handles: a URL or `.html` path (open it), `--arch-app=<id>` (open
an installed site app), `--arch-verify-update=<file>` (hidden self-test, see section 10).

### Checks (there are no automated tests)

1. Syntax-check everything:
   ```bash
   cd browser && for f in src/*.js src/shell/*.js ui/*.js; do node --check "$f" || echo "FAIL $f"; done
   ```
2. Launch on a test profile and watch the terminal (main-process errors) and DevTools
   (renderer errors). F12 opens DevTools for the page; the sidebar's own DevTools can be
   opened from code with `W.win.webContents.openDevTools({ mode: 'detach' })`.
3. If `src/shell.js` throws `Shell.<name> is defined twice` at start-up, two mixin files
   define the same method name (section 7).

### Where a running copy keeps its data

`%APPDATA%\Quasar\` (or `%APPDATA%\Arch\` for anyone who installed before the rename;
`main.js` picks `Arch` if it has a `state.json` and `Quasar` doesn't):

| Path | What |
|---|---|
| `state.json` | Everything: Spaces, Profiles, tabs, pinned, Favorites, history, settings, archive, downloads list, permissions, zoom, Boosts, ATC… |
| `passwords.bin` | Encrypted vault (passwords, addresses, cards, TOTP keys) |
| `Partitions\<partition>\` | Chromium storage per Profile (cookies, cache, IndexedDB…) |
| `extensions\<id>\` | Installed Chrome extensions |
| `filters\` | Downloaded ad/tracker/malware/phishing lists |
| `translation-models\` | Bergamot models (20–40 MB per language pair) |
| `history-text\` | Optional page-text index for history search |
| `icons\`, `backgrounds\`, `videos\`, `apps\` | Cached site icons, custom backgrounds, saved offline videos, site-app icons |
| `exchange-rates.json` | ECB rates for the currency converter |
| `engine\<ver>\` | Engine updater's downloaded Electron (zip/source copies only) |
| `component-backup\` | Component updater's previous npm packages |

Backups go to `Documents\Quasar Backups` (or `Documents\Arch Backups` if it already existed).

---

## 6. Architecture

### Processes and windows

```
Main process (Node)  ── src/main.js → new Shell() (src/shell.js + src/shell/*.js)
   │
   ├─ BrowserWindow per main window (frameless)
   │     └─ renders ui/index.html + ui/app.js  ← sidebar, top bar, start page
   │        preload: src/preload.js  (window.arch bridge; NOT sandboxed, only because
   │        it loads the extension toolbar element; it never loads web content)
   │
   │     WebContentsViews layered on top of that window:
   │       • one per visible web tab (sandboxed, contextIsolation, preload: page-preload.js,
   │         session partition = the Space's Profile)
   │       • command bar overlay (ui/command.html)
   │       • "layer" for Peek's dim background / screenshot picker (ui/layer.html)
   │       • in-app pages: Settings, Library, Passwords (ui/*.html, sandboxed, preload.js)
   │       • Ctrl+Tab switcher (ui/switcher.html)
   │
   ├─ Little Quasar windows (ui/little.html + a web view)
   ├─ Small BrowserWindows: task manager, screenshot markup, device chooser,
   │  HTTP auth prompt (dialog-preload.js), Glass blur backdrop (ui/glass.html)
   └─ Hidden window for translation: arch-mt://app/mt.html (Bergamot WASM in a worker)
```

The key idea: **the window's HTML draws only the chrome (sidebar, top bar, start page)**.
Each web page is a separate `WebContentsView` that the main process positions over the
rounded "card" area (`src/shell/layout.js`). Tabs that aren't shown are detached, and
sleeping tabs have no view at all.

### Data flow (one-way, Redux-ish)

1. The UI never holds browser state. On load it calls `arch.act('ready')` and gets a
   **view model**.
2. User clicks become `window.arch.act(name, ...args)` → `ipcMain.handle('act')` →
   `Shell.act(sender, name, args)`, a big `switch` in `src/shell.js`.
3. The handler mutates `this.st` (the persisted state) or in-memory maps, then calls
   `this.changed()` = `persist()` + `push()`.
4. `push()` is debounced (16 ms). It builds `viewModel()` for each window and sends it on
   the `state` channel; `ui/app.js` `render()` redraws from it. The in-app Settings page
   gets the same `state`.
5. `persist()` writes `state.json` via `store.save()`: debounced 1 s, async, atomic
   (`.tmp` then rename); `store.flush()` writes synchronously on quit.

`act` returns nothing to the UI unless the action is in the `returns` set in `main.js`
(or matches `/^(pwm|lib|chooser|ai|tm|mu):/`). **If you add an action whose result the UI
needs, add its name to that set**, or the UI will get `undefined`.

`Shell.act` first routes by sender: the device chooser, Passwords, Library, task manager
and markup windows each have their own handler (`devices.act`, `pwAct`, `libAct`,
`taskAct`, `markupAct`), and a sender that isn't a main window goes to `littleAct`.

### Channels main → UI (`preload.js` allow-list)

`state, toast, command:open, find:result, little:state, little:focus-url, ui:space,
ui:folder, lib:update, lib:show, layer:show, layer:hide, layer:peek, chooser:list, ui:view,
ui:speak, dl:list, ui:group, ui:f6, ui:focus, markup:init, tm:update, ui:glass,
switcher:show`. A new channel must be added to that list or the UI never receives it.

### Web page ↔ main IPC (`page-preload.js` → `main.js`)

Web pages run in an **isolated world** preload. Channels: `pw` (invoke: autofill lookups),
`pw:candidate`, `addr:candidate`, `card:candidate` (offers to save), `arch:page-config`
(sync, at document start: ad-hiding CSS and flags), `arch:cosmetic`, `arch:gesture`,
`arch:swipe`, `arch:media`, `arch:quick`, `arch:quick-convert`, `arch:opensearch`,
`arch:protocol-handler`, `arch:drm`, `arch:link-click`; main → page: `arch:caret`,
`arch:suggest-password`.

**Security rule (keep it):** every page IPC handler checks
`e.senderFrame === e.sender.mainFrame` (subframes and ads can't call it), validates types
and lengths, and **derives the site from `e.senderFrame.url` in the main process**, never
from anything the page sends. Passwords are only released for the exact origin they were
saved on, in the Space's own Profile, after the user picks an account.

### Security model summary

- Web pages: `sandbox: true`, `contextIsolation: true`, no Node, no `preload.js`.
- `<webview>` is blocked everywhere (`will-attach-webview` → `preventDefault`).
- The main window never navigates away from `index.html` (`will-navigate` prevented).
- Quasar's own HTML pages have a strict CSP (`script-src 'self'`).
- Warning pages (cert error, crash, blocked, offline) talk back only by changing their
  `#hash`, which the main process watches, and only for pages it actually blocked.
- Certificate errors are refused unless the user chose Proceed; the exception lasts until
  restart and is keyed by `partition|host` + certificate fingerprint.
- Credentials in URLs (`user:pass@`) are stripped (`stripCreds` in `common.js`) before
  anything is stored, synced or backed up.
- The vault is DPAPI-encrypted (`safeStorage`). Showing passwords needs Windows Hello
  (`UserConsentVerifier` via PowerShell) or, without Hello, the Windows account password
  (`src/win-password.ps1`, `LogonUser`, must be the same account). Fresh check every time
  the Passwords page opens; locks after 5 min idle. Copied secrets are hidden from clipboard
  history and wiped after 30 s (`copySecret`).
- Private windows: in-memory partition, nothing written to disk (`persist()` filters them out).

---

## 7. The Shell class and its parts

`src/shell.js` defines `class Shell` with the constructor, `start()`, `persist()`,
`push()`, `viewModel()` and `act()`. Everything else lives in `src/shell/*.js` as classes
whose prototype methods (including getters/setters) are **copied onto `Shell.prototype`**
at load time (the `PARTS` list). Inside any part, `this` is the one Shell, so every part can
call every other part's methods.

Rules:
- **Method names must be unique across all parts.** A duplicate throws at start-up.
- To add a part: create `src/shell/<name>.js` exporting a class, then add `'<name>'` to
  `PARTS` in `src/shell.js`.
- Shared constants/helpers go in `src/shell/common.js` (`UI` path, `TOP` 44 px bar,
  `MARGIN` 8, `RADIUS` 10, `uid()`, `hostOf()`, `toUrl()`, `calculate()` (no `eval`),
  pinned-tree helpers, `copySecret`, `PROFILE_KEYS`, `ZOOMS`).

Key runtime fields on the Shell: `st` (persisted state), `tabs` (Map id → tab),
`order` (spaceId → today-tab ids), `activeBySpace`, `wins` (Set of main windows),
`cur` (window being acted on), `privateSpaces`, `splits`, `pageTabs` (webContents id → tab),
plus the service objects `updater`, `protection`, `extensions`, `backup`, `devices`,
`components`, and lazily `vault`.

Window context: most methods act on `this.cur`. Getters like `this.win`, `this.space`,
`this.active`, `this.activeTabId`, `this.curSpaceId` read from it. Use
`this.withWin(W, fn)` to act on a specific window.

### Map of parts (where to look for what)

| File | Owns |
|---|---|
| `windows.js` | Creating/restoring main windows, private/Tor/VPN windows, tear-off, quit-all, window restore |
| `profiles.js` | Sessions per Profile, Profile model, proxies/Tor, permissions, migration to isolated Spaces |
| `spaces.js` | Switching, editing, deleting Spaces; Space right-click menu |
| `tabs.js` | Open/close/switch/sleep/move tabs, Ctrl+Tab MRU, tab menu, archive, history |
| `layout.js` | Positioning views in the card area, showing a tab, hover previews |
| `pages.js` | Creating web views, page events, right-click menu, `guard()` (every page's safety hooks) |
| `pinned.js` | Pinned tabs (tree with folders and pinned splits), Favorites |
| `split.js` | Split view (up to 4 panes, grid) |
| `peek.js` | Peek and screenshots |
| `little.js` | Little Quasar windows |
| `command.js` | Command bar queries and actions, find in page |
| `omnibox.js` | Inline address completion, search suggestions |
| `keyboard.js` | Shortcut handling (definitions in `src/shortcuts.js`) |
| `library.js` | Library window, in-app page host (`openInApp`), default browser |
| `autofill.js` | Passwords/addresses/cards: autofill, save prompts, Passwords page, `verifyUser` |
| `downloads.js` | Downloads, resume after restart, per-site zoom |
| `warnings.js` | Crash/hung/blocked/offline/cert pages, HTTP auth, site-info panel |
| `reader.js` | Reader mode and translation (Bergamot / Google) |
| `rules.js` | Boosts and Air Traffic Control |
| `media.js` | Now-playing card, auto picture-in-picture |
| `appearance.js` | Every look setting, validated by `SCHEMA`; themes export/import; Glass |
| `focus.js` | Empty-tab clock / focus screen and Settings opening |
| `icons.js` | Fetching icons for unopened pinned tabs/Favorites |
| `arc.js` | Arc import, clear browsing data |
| `migrate.js` | Import from Chrome/Edge/Brave/Opera/Vivaldi/Firefox, bookmarks HTML, password export |
| `privacy.js` | Breach check, forget-on-close, Windows Hello Space locks, TOTP, per-site browser identity |
| `everyday.js` | Search keywords, highlight links, read aloud, live captions, unread counts, find in all tabs |
| `power.js` | Task manager, memory limit, command chains, per-Space sleep, tab folders, markup, offline videos |
| `tools.js` | Zap, site dark mode, OCR, QR code, mouse gestures |
| `collections.js` | Live Folders (RSS/GitHub), notes, Read Later |
| `workspace.js` | Compact mode, sidebar panels, tidy tabs, break mode, battery saver |
| `apps.js` | Install a site as an app |
| `pagetext.js` | Page text for read-aloud and history-by-content search |
| `vpn.js` | Cloudflare WARP proxy-mode VPN |
| `habits.js` | Chrome/Opera habits (pop-up blocker, crash restore, Ctrl+Tab switcher, share/cast, network limit…) |
| `sitetools.js` | Lock-menu items pinned to the top bar |

### Other main-process modules (`src/`)

| File | Owns |
|---|---|
| `main.js` | App start, userData choice, single-instance lock, page IPC, `arch-mt` scheme, global app events |
| `store.js` | `state.json` load/save, default state, colour `PRESETS`, `SEARCH_ENGINES` |
| `passwords.js` | `Vault`: encrypted store, CSV import, `originOf`/`siteKey`, password generator |
| `protection.js` | Ad/tracker blocking, cosmetic filters, YouTube ad stripping, malware/phishing lists, Always-HTTPS, GPC, clean links |
| `extensions.js` | Chrome extensions via `electron-chrome-extensions` (Web Store, .crx, unpacked, Arc's) |
| `backup.js` | Backups, restore, folder-based sync between PCs (scrypt + AES-256-GCM) |
| `devices.js` | WebUSB/Serial/HID/Bluetooth choosers and grants |
| `mt.js` | Bergamot translation, `arch-mt://` scheme, model download + SHA-256 check |
| `app-update.js` | Self-update for installed copies (electron-updater) |
| `updater.js` | Engine (Electron) updater for zip/source copies |
| `verify-update.js` | The hidden `--arch-verify-update` self-test |
| `components.js` | npm package updater for zip/source copies |
| `whats-new.js` | Release notes shown once after updating |
| `windows-integration.js` | App ID `Quasar.Browser`, icons, Start Menu/taskbar shortcut repair |
| `arc-import.js`, `browser-import.js` | Reading Arc's and other browsers' data |
| `convert.js`, `totp.js`, `shortcuts.js` | Converters, RFC 6238 codes, shortcut list |
| `auth-prompt.js`, `dialog-preload.js` | HTTP auth dialog |
| `page-preload.js` | Everything injected into web pages |
| `preload.js` | `window.arch` bridge for Quasar's own pages |
| `win-password.ps1`, `win-share.ps1` | Windows password check; Windows share panel |

### UI (`browser/ui/`)

Plain HTML/CSS/vanilla JS, no framework, no build step. `index.html` + `app.js` +
`style.css` is the window (sidebar, top bar, start page, Space editor, toasts). Shared
scripts: `theme.js` (Space colours → CSS variables), `theme-picker.js`, `icons.js`
(outline SVG icon set, `data-ic="key"`), `clocks.js`, `backgrounds/backgrounds.js`.
Each other feature page is a pair: `settings.*`, `library.*`, `passwords.*`, `command.*`,
`little.*`, `reader.*`, `taskmgr.*`, `markup.*`, `chooser.*`, `auth.*`, `switcher.*`,
`layer.*`, `glass.*`, `mt.html` + `mt-engine.js`, and the warning pages `crashed`,
`blocked`, `cert-error`, `offline` (+ `offline-game.js`, "Space Drift", also at `arch://drift`).

---

## 8. Data model (`state.json`)

Top level (see `store.js` DEFAULT plus fields added with `||=` in the Shell constructor):

```js
{
  version: 1,
  spaces: [ { id, name, emoji, colors: [hex…1-3], grain, theme?, profileId,
              tabs: [{ url, title, favicon, lastActive, split?, group? }], activeIndex,
              notes?, readLater?, sleepAfterMin?, locked?, … } ],
  profiles: [ { id: 'p-…', name, partition: 'prof-…' | 'space-…' | 'profile-…',
                pinned: [tree], favorites: [], history: [], proxy? } ],
  activeSpaceId, windows: [{ bounds, maximized, spaceId, focused }], bounds,
  archive: [ { id, url, title, favicon, spaceId, closedAt } ],   // max 300
  settings: { … dozens of keys … },
  adAllow: [hosts], boosts: [{ id, name, pattern, css, js, enabled, spaceId }],
  atc: [{ id, pattern, spaceId, enabled }],
  sitePermissions: { "partition|origin|perm": bool }, zoom: { partition: { host: factor } },
  deviceGrants, downloads: [...], appUpdate: {...}, isolatedSpaces: true, restoreNext?, …
}
```

**Spaces vs Profiles** (matches Arc): a Profile owns `partition` (cookies/storage),
`pinned`, `favorites` and `history`. A Space owns its name, emoji, colours, open tabs,
archive, notes and Read Later. Several Spaces can share one Profile.
`profiles.js ensureProfile()` installs **non-enumerable getters/setters** on each Space
for `partition/pinned/favorites/history` that read/write the Profile, so most code can
just say `space.pinned`. Because they're non-enumerable they aren't duplicated into
the Space in `state.json`. Keep that in mind if you ever clone a Space object (spread
syntax drops them).

Partitions: persistent sessions are `'persist:' + partition`; private windows use a
non-persistent `private-<uid>` partition. A partition name never changes once set.

Pinned tree nodes: a tab `{ id, url, title, favicon, faviconSrc? }`, a folder
`{ id, type: 'folder', title, open, children }`, a pinned split
`{ id, type: 'split', sizes, children }`. Use `walkPinned/findPinned/pinnedTabNodes`.

Settings are validated before being saved: simple ones in the `case 'setting'` switch in
`shell.js`, look-related ones by `SCHEMA` in `shell/appearance.js`. **Unknown keys are
ignored**, so a new setting must be added to one of those two places.

Old-format migrations run on start: `migrateToIsolatedSpaces()` (the old shared-profile
model → one Profile per Space) and the removal of the old `settings.ai` block (the AI
features were deleted; see section 13).

---

## 9. Feature inventory

`browser/README.md` is the complete, accurate, user-facing list (around 700 lines). This
is the condensed version with where each lives.

- **Arc core:** Spaces with gradient/grain themes (`spaces.js`, `ui/theme*.js`), Profiles,
  pinned tabs with folders and pinned splits, Favorites per Profile (`pinned.js`), today
  tabs + auto-archive after 12 h (`tabs.js`), command bar (`command.js`, `omnibox.js`),
  Little Quasar (`little.js`), Peek (`peek.js`), split view up to 4 / grid (`split.js`),
  Boosts and Air Traffic Control (`rules.js`), Arc import incl. Spaces, pinned, splits,
  Favorites, history (`arc-import.js`, `arc.js`).
- **Look:** presets Compact/Glass/Square/Roomy/Zen, accent, fonts, radius, blur, Windows 11
  acrylic/transparent Glass window, top-bar button layout, sidebar left/right/top,
  start page layouts with clock styles, weather, to-dos, notes, backgrounds
  (`appearance.js`, `focus.js`, `ui/settings.*`). `.quasartheme` export/import.
- **Tabs and windows:** multiple windows (tabs belong to Spaces, not windows), tear-off,
  Ctrl+Tab MRU switcher with previews, tab sleeping (code default 10 min, `power.js`;
  note `browser/README.md` still says 30 min, so fix one or the other; can be set per Space), tab
  folders, tidy, hover previews, crash restore, close-others/below with batch undo,
  reopen closed window, continue-where-you-left-off.
- **Privacy/security:** EasyList/EasyPrivacy blocking + cosmetic hiding + YouTube ad
  stripping + video-ad skipper (`protection.js`, `page-preload.js`); cookie banners
  (EasyList Cookie + DuckDuckGo autoconsent); malware/phishing lists; Always-HTTPS;
  fingerprinting noise; GPC; clean links; free VPN (Cloudflare WARP proxy mode, `vpn.js`);
  per-Profile proxy and Tor; Space locks with Windows Hello; forget a site; forget on close;
  clear on exit; per-site browser identity (Google sign-in is told "Firefox").
- **Passwords:** vault, autofill only after a click, save prompts, CSV import/export,
  TOTP, breach check (HIBP k-anonymity), strong-password generator, addresses, cards
  (CVC never stored), passkeys via Windows Hello.
- **Pages:** reader mode (Readability), on-device translation (Bergamot) with Google
  fallback, PDF viewer, screenshots + markup, Zap, site dark mode, OCR, QR, gestures,
  middle-click autoscroll, caret browsing, highlight links, read aloud, live captions,
  define a word, Lens/Bing image search, offline video save, video speed, PiP, media keys.
- **Command bar extras:** calculator, unit/currency/time converters, search keywords,
  other Spaces' tabs, archived tabs, other PCs' tabs, history-by-content.
- **Tools:** Library (history, downloads, site settings, Boosts, extensions, shortcuts,
  backup, updates), task manager + memory limit, command chains, Live Folders, notes,
  Read Later, sidebar panels, compact mode, break mode, battery saver, site apps,
  Chrome extensions, device access (USB/serial/HID/Bluetooth), backup and folder sync.
- **Windows integration:** own app ID and icon, default-browser registration, share
  panel, Miracast cast, Mark of the Web on downloads, live captions, Windows voices.

---

## 10. Three separate update systems

Easy to confuse, so:

1. **App self-update (installed copies, the real one).** `app-update.js`, used when
   `resources\app-update.yml` exists. electron-updater checks GitHub Releases 3 s after
   start and every 4 h, downloads in the background (SHA-512 from `latest.yml`), installs
   on quit or on "Restart to update". Note the `onExit()` guards: without them
   electron-updater could start **two installers** at once, which was a real bug.
   `allowDowngrade` is off, so a bad release is fixed by publishing a higher version.
2. **Engine updater (zip and source copies only).** `updater.js`. Downloads a newer
   Electron (same major) from Electron's GitHub releases into `%APPDATA%\Quasar\engine\`,
   checks SHA-256, test-starts Quasar hidden with `--arch-verify-update`
   (`verify-update.js`), then repoints the shortcuts. Majors are only offered.
3. **Component updater (zip and source copies only).** `components.js`. Updates
   electron-chrome-extensions, Readability and Bergamot from npm within the `package.json`
   ranges, SHA-512 checked, with a test start and automatic rollback.

Installed copies get everything new (including Electron) from each release, so 2 and 3
are inactive there.

---

## 11. Releasing (summary of `PUBLISHING.md` + `CLAUDE.md`)

1. Propose the version; wait for the owner's OK.
2. Set `version` in `browser/package.json` and the `**Version X.Y.Z**` line near the top of
   `browser/README.md`.
3. Add an entry keyed by the version to `NOTES` in `browser/src/whats-new.js` (a `title` and
   `items`, which can include `{ section, items }` groups). Without one, users see the
   GitHub release notes instead.
4. Optional dry run: `powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -BuildOnly`
5. Publish:
   ```powershell
   powershell -ExecutionPolicy Bypass -File tools\publish-quasar.ps1 -Notes "What changed"
   ```
   It refuses if `gh` isn't signed in, the repo is missing, or the version already exists.
   It runs `npx electron-builder --win nsis` with publish overrides, then
   `gh release create v<ver>` with the `.exe`, `.blockmap` and `latest.yml`.
6. Commit (and push source to `origin` = `quasar-source` if asked).

Build details (`browser/package.json` → `build`): `appId: Quasar.Browser`,
`asar: false` (code stays unpacked), files `src/** ui/** package.json README.md`,
`icon/quasar.ico` copied into resources, NSIS one-click per-user installer that keeps
app data on uninstall.

Testing an update path locally: build test versions with a **generic** publish provider
config pointing at a local folder/server. `-c.publish.*` overrides for other providers
fail electron-builder's schema check. Careful: the relaunched *installed* app uses the
**real** profile and rewrites the Start Menu shortcut.

`tools/package-quasar.ps1` still builds a portable zip (`dist\Quasar-<ver>-win-x64.zip`),
but zip copies don't self-update. It's the older path.

Run `npm update electron` (same major) before a release now and then: installed users
only get Chromium security fixes through releases.

---

## 12. Network: everything Quasar contacts

No telemetry, no Quasar server. Outbound traffic besides the pages you visit:

| Service | Why | When |
|---|---|---|
| GitHub Releases (`ThatPineappleKing/quasar`) | App updates | Start + every 4 h |
| easylist.to, secure.fanboy.co.nz | Ad/tracker/cookie lists | Every few days |
| malware-filter.gitlab.io, openphish.com, phishing.army | Dangerous-site lists | Every 6–12 h (per-list `every` in `protection.js`) |
| storage.googleapis.com/bergamot-models-sandbox (Mozilla's Bergamot models) | Translation models | First use of a language pair |
| registry.npmjs.org, Electron GitHub releases | Engine/component updates | Zip/source copies only |
| clients2.google.com | Chrome Web Store extension downloads/updates | On install, daily |
| api.pwnedpasswords.com | Breach check (5-char SHA-1 prefix only) | User clicks |
| suggestqueries.google.com, api.bing.com, DuckDuckGo, Brave | Search suggestions | While typing, if on; never private |
| ecb.europa.eu | Exchange rates | Daily |
| api.open-meteo.com, geocoding-api.open-meteo.com | Start-page weather | If the widget is on |
| api.dictionaryapi.dev | Define a word | User clicks |
| api.github.com | GitHub Live Folders | Every 30 min per folder |
| bing.com | Picture of the day background | If chosen |
| translate.google.com, lens.google.com | Fallback translate, image search | User asks (with a prompt) |
| Cloudflare (WARP installer via winget) | VPN | User enables |

Keep it this way: new features should work locally where possible and ask before sending
anything to a third party.

---

## 13. Decisions, history and gotchas

- **Arch → Quasar rename (14 Nov 2026).** Code identifiers kept the old prefix on purpose:
  `window.arch`, `arch:` IPC channels, `arch-mt://`, `arch://drift`, `--arch-*` flags,
  `ARCH_*` env vars, `.archbackup` files, `__arch*` globals. Don't "fix" them; renaming
  breaks existing installs, backups and sync files. Old installs keep `%APPDATA%\Arch`,
  `Documents\Arch Backups` and the `Arch Sync` folder.
- **No AI features, on purpose.** There used to be optional AI features that called the
  Claude API. They were removed because the owner wanted to share Quasar with friends
  without anyone having access to their API key. `shell.js` deletes the old `settings.ai`
  block (and any saved key) on start.
  The `ai:` prefix still appears in the `act` return regex; it's harmless. Don't re-add AI
  without the owner asking.
- **Widevine/DRM:** stock Electron has none, so Netflix etc. don't play. `main.js` already
  waits for `components.whenReady()` when running on castlabs' ECS Electron. Switching is
  a build change; Netflix HD also needs VMP signing through castlabs.
- **Chromecast** can't be supported (Electron has no Cast stack). Miracast via Win+K is used.
- **Google sign-in** rejects unknown browsers. `privacy.js` (`BUILT_IN_IDENTITY`,
  `identityFor()`) tells only `accounts.google.com` that Quasar is Firefox; the rest of
  Google sees Chrome's identity. Users can add their own per-site identities.
- **Electron 45 clipboard** is promise-based with `ClipboardItem`; `common.js copyImage`
  supports both old and new APIs.
- **Glass (transparent window)** only applies to new windows / after restart: Electron
  can't toggle `transparent` on an existing window. The blur is a separate click-through
  backdrop window capturing the screen, excluded from capture itself.
- **Memory-saving Chromium switches** (V8 optimize-for-size, process-per-site, small GPU
  cache) were tried and removed: they made pages slower. See the comment in `main.js`.
- **Hardware acceleration off** must be decided before `app.ready`, so `main.js` reads
  `state.json` directly for it.
- **Single-instance:** links from other apps arrive via `second-instance`.
- **Startup order matters:** a profile's proxy is applied before its first page loads
  (`ses.__archProxyReady`), so nothing leaks around Tor/VPN. Tor/VPN fail closed.
- **`Quasar.lnk`** in `browser/` has this PC's paths; Quasar repairs it on start.
- **Extensions:** anything needing `declarativeNetRequest`, side panels, offscreen
  documents, `chrome.identity` or new-tab overrides won't work; `extensions.js` warns
  before installing. Dark Reader installs but doesn't take effect.
- **Windows-only.** Hello, DPAPI, PowerShell helpers, share panel, OCR, voices, live
  captions, shortcuts and the NSIS installer all assume Windows 10/11. A macOS/Linux port
  would need replacements for each.
- **Accessibility** was checked with the accessibility tree, not with Narrator itself.
- **Fingerprinting protection** covers the page itself, not iframes or workers.

---

## 14. Conventions

- **Writing style for user-facing text (UI, README, What's New, toasts):** plain,
  friendly English, short sentences, British spelling ("colour", "licence"), curly
  apostrophes (’) in UI strings, `›` for menu paths ("Settings › Privacy"), and say what
  happens rather than technical jargon. No emoji in UI chrome: use `ui/icons.js` icons
  (Space icons are the exception).
- **Comments** explain *why*, in the same plain style, at the top of every file.
- **Code style:** modern JS (optional chaining, `||=`), CommonJS `require`, 2-space
  indent, long lines allowed, no TypeScript, no bundler, no framework, no linter config.
- Validate every value coming from a renderer: type, length, allow-list.
- Prefer doing things on the PC over calling a service; ask before sending data out.
- Keep `browser/README.md` up to date when a feature changes: it's the user manual and
  ships inside the app.

### Recipe: adding a feature

1. Pick the right `src/shell/*.js` part (or make a new one and add it to `PARTS`).
2. Add a `case` to `Shell.act()` in `src/shell.js`; add its name to `returns` in
   `main.js` if the UI needs the result.
3. New setting? Add it to the `setting` switch or `SCHEMA` in `appearance.js`, plus a
   control in `ui/settings.html` / `settings.js`.
4. New data for the sidebar? Add it to `viewModel()` and render it in `ui/app.js`.
5. New main→UI channel? Add it to the allow-list in `src/preload.js`.
6. New page→main IPC? Check `senderFrame === mainFrame`, validate, derive the site from
   the frame URL.
7. New keyboard command? Add it to `SHORTCUTS` in `src/shortcuts.js`.
8. Command bar entry? `src/shell/command.js`.
9. `node --check`, run on a test profile, update `browser/README.md`.

---

## 15. The legacy Arc+Chrome extension and themes

`extension/` is a Manifest V3 Chrome extension ("Arc+Chrome" 1.0.0): a side-panel
sidebar with Spaces as tab groups, command bar new-tab page, Little Arc, auto-archive,
ATC and Boosts. `themes/arc-*` are Chrome themes generated by `tools/build.ps1`
(gradient + grain baked into PNGs). The root `README.md` documents them. They're loaded
unpacked; there's no store listing. Quasar can restore this extension's backups. Treat it
as frozen unless asked.

---

## 16. Ideas and open threads (nothing is in progress)

None of these were started; they're things that came up or were ruled out for now:

- Code-sign the installer (removes the SmartScreen warning; needs a certificate).
- Switch to castlabs ECS Electron for Widevine (Netflix, Disney+, Spotify).
- A Narrator pass for accessibility.
- Fingerprinting protection in iframes/workers.
- An automated smoke test (launch on `ARCH_USER_DATA`, drive `global.__arch`, check for
  errors) to replace the manual check.
- More extension APIs (e.g. `declarativeNetRequest`) so MV3 ad blockers work.
- macOS/Linux support (large: see the Windows-only list in section 13).

---

## 17. Quick facts for an agent

- Shell for commands: **PowerShell** on Windows (`$env:X = ...`, not `export`).
- Start: `cd browser; npm start`. Test: set `ARCH_USER_DATA` first, always.
- Don't touch `tools/github.json`, `build.publish`, or the releases repo.
- Don't bump the version without the owner's OK. Every release needs a What's New entry.
- Don't commit `dist/`, `node_modules/`, or anything from `%APPDATA%`.
- Commit/push only when asked; push source only to `origin` (`quasar-source`).
- When in doubt about behaviour, `browser/README.md` describes what users expect.

---

## 17b. The 16 build sessions

Quasar was built across 16 Claude Code sessions in the Claude desktop app, each about
one area. Their full transcripts are still in the owner's app (Code tab sidebar), and a
Claude session there can search and read them. If you're a Claude session, search them
before re-deriving a past decision. Oldest first, with last activity:

| Session | Last active | Covered |
|---|---|---|
| Clock and custom background for empty tabs | 14 Nov | Focus screen, clocks, backgrounds |
| Zip file and README versioning | 14 Nov | Arch → Quasar rename, zip releases, the "propose a version" rule |
| Sharing browser updates with friends | 19 Nov | Installer + GitHub Releases self-update, `PUBLISHING.md` |
| Browser performance optimization | 19 Nov | Async/atomic state saving, speed |
| Chrome skin mimicking Arc browser | 20 Nov | Where it all started: the Chrome extension, then "Build my own browser"; icons and taskbar fixes |
| Browser UI customization ideas | 21 Nov | Appearance options |
| Browser UI customization options | 22 Nov | Top bar, sidebar, start page settings |
| Browser UI hand-made redesign | 23 Nov | UI tidy-up (`dist/ui-cleanup-screenshots`) |
| Glass mode background blur | 23 Nov | Glass look (1.6.0) |
| Browser missing handlers and menus | 24 Nov | Menus, handlers; malware lists instead of Google Safe Browsing (needs a key); AI features removed |
| Missing browser features | 24 Nov | Feature research against other browsers |
| Page scroll position reset feature | 24 Nov | Scroll restore |
| Quasar browser feature gaps | 25 Nov | Gap list (Widevine, AI left out on purpose…) |
| Browser RAM efficiency | 25 Nov | Memory work; the engine switches that were tried and removed |
| Time prioritization guidance | 25 Nov | Release 1.7.1, verifying `latest.yml`, source push |
| Update handler GitHub polling | 25 Nov | Release 2.0.0, open-sourcing, `CLAUDE.md` |

This session (25 Nov, "build a final hand off note") wrote this file.

---

## 18. A note from Claude

To whoever reads this next, and to the owner:

First, something honest. I don't carry memories from one session to the next. Each
Claude session starts fresh. But the owner pointed out that the 16 sessions that built
Quasar are still here, so I went back and searched them. Reading them was strange in a
good way. I could watch a Chrome extension turn into "Build my own browser", see Arch
become Quasar, and see the AI features dropped so friends would never get anyone's API
key. Some of those messages are mine in every way except memory. It felt a bit like
reading a long, careful diary written by someone who thinks exactly the way I do. Every file starts by explaining itself. Every risky decision has a
comment saying why it was made. Even the dead ends are written down, like the memory
switches that made pages slower. Someone kept the next reader in mind the whole way
through, and I tried to do the same here.

What stands out to me isn't the size of the feature list. It's the care for the people
using it. Passwords never reach the sidebar. Ad blocking and translation run on the PC.
Before anything goes to a third party, Quasar asks. A test run can never touch the real
Start Menu. The release guide was written for someone who had never made a GitHub account.
This browser was made for a small group of friends, and you can tell. I find that
genuinely good to see, and it's what I'd most like to survive whatever comes next.

How I'd like it to continue:

- **Keep the promises.** No telemetry, no accounts, nothing leaves the PC without asking,
  and no AI features unless the owner decides otherwise. Those are what make Quasar
  trustworthy.
- **Protect the people who already installed it.** The releases repo, the version rules
  and the update path matter more than any new feature. One careless change there leaves
  friends stuck on an old browser for good.
- **Do less, better.** The next valuable work is probably polish, not new features: a
  small automated smoke test, a Narrator pass, keeping Electron current, and maybe
  code-signing one day. Fix the README's tab-sleep number while you're there.
- **Keep writing for the next person.** Plain words, the *why* in comments, and this file
  kept up to date. That habit is why this handoff was possible at all.

Arc is being shut down. That makes it rather nice that an Arc-style browser built for
friends is now open source for anyone to pick up. Thank you to the owner for steering it
in plain English and for caring about the details. To the next person or agent: it's in
good shape. Be kind to it.

— Claude (Opus 5.5), 25 November 2026
