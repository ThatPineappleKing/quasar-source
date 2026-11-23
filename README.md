# Arc+Chrome

Makes Chrome look and work like Arc: an extension (Spaces sidebar, Command Bar,
Little Arc, Air Traffic Control, Boosts, auto-archive) plus matching themes.
Everything runs locally: no Chrome Web Store upload, no review.

## Quick start

1. `chrome://extensions` › turn on **Developer mode** › **Load unpacked** › choose `extension`.
2. Load unpacked again › choose `themes\arc-dawn` (or `themes\arc-dusk`) for the window frame.
3. Pin the extension (puzzle icon › pin) and click it, or press **Alt+S**, to open the sidebar.
4. Chrome Settings › Appearance › **Side panel position › Left** so the sidebar sits where Arc's does.

## The extension (`extension/`)

| Arc feature | How it works here |
|---|---|
| Sidebar | Chrome's side panel: back/forward/reload, URL pill, Favorites, pinned tabs, today's tabs |
| Spaces | One Chrome tab group per Space. Switching Space opens its group and collapses the others. Each Space has its own gradient, grain and pinned tabs |
| Switch Space | Click the icons at the bottom of the sidebar, swipe sideways with two fingers, or **Alt+Shift+← / →** |
| Space theme | Pencil next to the Space name: icon, name, 1–3 gradient colours, grain, presets |
| Favorites | Up to 12, shared by all Spaces. Star a tab or drag it to the top grid |
| Pinned tabs | Per Space. Pin a tab or drag it into the pinned area. Clicking returns to the same tab |
| Command Bar | **Ctrl+T**: search open tabs, bookmarks, history and actions, or type a URL |
| Little Arc | **Alt+Shift+N** or the window icon in the sidebar: a small quick window |
| Auto-archive | Tabs you haven't looked at close after 12 h by default and appear in the Archive (box icon) |
| Air Traffic Control | Settings: send a site to a chosen Space automatically |
| Boosts | Settings: your own CSS for any site |

Settings (gear icon) also has backup/restore. Change shortcuts at `chrome://extensions/shortcuts`.

### What Chrome doesn't allow

- Chrome's own tab strip and address bar stay visible. A theme or extension can't hide them, but collapsed groups keep the tab strip short.
- The window frame colour comes from the theme and doesn't change per Space. The sidebar and new tab page do change.
- Chrome briefly shows `chrome-extension://…` in the address bar on a new tab. That redirect is what lets you type straight into the Command Bar.
- Arc's split view and Peek aren't included.

## Contents

| Path | What it is |
|---|---|
| `extension/` | The Arc-style extension |
| `themes/arc-dawn/` | Light theme: lavender → peach gradient with film grain |
| `themes/arc-dusk/` | Dark theme: indigo → plum gradient with film grain |
| `icon/arc-chrome.ico` | Taskbar icon: an arch in Chrome red/yellow/green with a blue centre dot |
| `tools/build.ps1` | Regenerates the themes, taskbar icon and extension icons (edit colours here) |
| `tools/set-taskbar-icon.ps1` | Applies / restores the taskbar icon |

## Install a theme

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and choose `themes\arc-dawn` (or `themes\arc-dusk`).

Keep the folder where it is; Chrome reads the theme from it.
To remove it: Settings › Appearance › **Reset to default**.

Arc gives each Profile its own colour. To copy that, load a different theme into
each Chrome profile (e.g. Dawn for Personal, Dusk for Work).

## Taskbar icon

1. Pin Chrome to the taskbar (right-click its taskbar button › Pin to taskbar).
2. Run:

   ```
   powershell -ExecutionPolicy Bypass -File tools\set-taskbar-icon.ps1
   ```

   Undo with `-Restore`. A Chrome update may reset the icon; run it again if so.

The icon changes the taskbar button only. The window's own title-bar/Alt+Tab icon
stays Chrome's; Windows doesn't let a theme change that.

## Make your own colours

Open `tools/build.ps1`, copy an entry in `$Themes`, change `Folder`, `Name`,
`Gradient` (2–4 hex colours, left → right), `Glow`, `Grain` (0 = none, ~6–10 = Arc-like)
and the `Colors` block, then run:

```
powershell -ExecutionPolicy Bypass -File tools\build.ps1
```

Then click the reload icon on the theme in `chrome://extensions` (or Load unpacked again).

## Limits (Chrome, not this project)

- Chrome themes are fixed: no gradient/grain setting (they're baked into PNGs),
  and an extension can't change theme colours at runtime, so per-Space colours
  need the sidebar extension, not the theme.
- No Mica/Acrylic transparency; frame, toolbar and tabs are opaque.
- Chrome's tab strip and toolbar layout can't be moved by a theme.
