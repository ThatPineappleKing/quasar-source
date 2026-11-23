# Quasar

**Version 1.3.0** · *(Formerly called Arch.)*

An Arc-style browser built on Electron (the Chromium engine). Unlike the Chrome
extension, it controls the whole window, so it can look like Arc: no title bar,
sidebar on the left, pages shown as a rounded card, and the Space's gradient and
grain across the whole window.

## Start it

Double-click **`Quasar.lnk`** in this folder, or search **Quasar** in the Start menu (Quasar adds
itself there the first time it runs). To pin it, right-click its taskbar icon while it's
running and choose **Pin to taskbar**.

Quasar registers itself with Windows as its own app (app ID `Quasar.Browser`) with the arch
icon, so pins, the Start menu, Alt+Tab and the taskbar all show Quasar's icon rather than
Electron's. Each time Quasar starts, it repairs `Quasar.lnk`, the Start menu entry and any Quasar
taskbar pin if their icon has been changed.

From a terminal, in this folder:

```
npm start
```

## Using it

| Do this | How |
|---|---|
| Open a page / search | **Ctrl+T** opens the command bar, which searches this Space's tabs, pinned tabs, Favorites, history and actions |
| Edit the current URL | **Ctrl+L**, or click the address pill at the top |
| Find in page | **Ctrl+F** |
| Switch Space | Icons at the bottom of the sidebar, **Ctrl+1–9**, or a two-finger sideways swipe |
| Edit a Space | Pencil next to the Space name: icon, name, 1–3 gradient colours, grain, presets |
| Pin a tab to the Space | **Ctrl+D**, the pin button, or drag it above the line |
| Favorite (this Space) | Star button or drag to the top grid (up to 12 per Space). Right-click a favorite to remove it |
| Move a tab to another Space | Drag it onto that Space's icon, or right-click › Move to Space. Between Spaces on the same Profile it moves as it is (still signed in); to a Space on another Profile it reopens fresh there |
| Switch tabs | **Ctrl+Tab** goes to the tab you used last (hold Ctrl and press Tab again to go further back); Settings can make it follow the sidebar order instead. **Ctrl+Alt+↑/↓** always follow the sidebar |
| Close several tabs | Right-click a tab › Close Other Tabs / Close Tabs Below; right-click a folder (or a pinned tab in one) › Close Tabs in Folder |
| All shortcuts | **Ctrl+/** shows them; change any of them in Library › Keyboard shortcuts |
| Hide the sidebar | **Ctrl+S** |
| Little Quasar window | **Ctrl+Alt+N**, the window icon, or right-click a link. "Open in Quasar" moves the page into the main window |
| Copy URL | **Ctrl+Shift+C** |
| Reopen closed tab | **Ctrl+Shift+T** |
| Archive | Tabs you haven't looked at close after 12 h by default (change in Settings); restore them from the box icon |
| Developer tools | **F12** |

### Spaces and Profiles

Like Arc, every Space uses a **Profile**. A Profile holds:

- cookies and logins (signing in to a site signs you in in every Space on that Profile)
- site storage, cache and site permissions (camera, location, notifications)
- browsing history (the command bar suggests the Profile's history)
- pinned tabs and Favorites
- saved passwords

Each Space keeps its **own name, emoji, theme and open tabs** (plus its archive and
recently closed tabs). So you can have **Home** and **Second Home** on one Profile: same
logins, history and pinned tabs, but different open tabs and colours. A Space on a
different Profile shares nothing with them, like a separate Chrome profile.

**New Space** (the **+** in the bottom bar, or right-click a Space › New Space) asks for a
name, an emoji, a Profile (an existing one to share, or **New profile…**) and a theme.
To change a Space's Profile later: right-click it › **Set Profile**, or use the Profile
box in the Space editor. Its open tabs reopen in the new Profile.

**Deleting a Space** only removes the Space if another Space still uses its Profile. If
it's the last Space on that Profile, the Profile's logins, history, pinned tabs, Favorites
and passwords are deleted too, after asking. **Clear browsing data** (Settings) clears the
current Space's Profile. The only things shared by all Profiles are Quasar's own settings
(search engine, archive timing, sidebar width).

Existing Spaces were each given their own Profile, so nothing changed for them until you
choose to share one.

Your data is kept in `%APPDATA%\Quasar` (`state.json` holds Spaces, tabs and settings; each
Space's cookies and site data are in `Partitions\`). **If you used it before it was renamed
from Arch,** your data stays in `%APPDATA%\Arch` and Quasar keeps using it there, so nothing
was moved or lost. Wherever this guide says `%APPDATA%\Quasar`, read `%APPDATA%\Arch` for
your install. Likewise an existing `Documents\Arch Backups` folder and a shared `Arch Sync`
folder keep their names, so syncing PCs still find each other.

## Make it yours

**Settings** (gear) has four sections for this; every change shows straight away.

| Section | What you can change |
|---|---|
| Appearance | Style presets (Compact, Glass, Square, Roomy, Zen), colours for the Space, accent colour, font and text size, corner roundness, blur, window transparency (Windows 11 acrylic). **Export / Import theme** shares a setup as a `.quasartheme` file |
| Top bar | Drag buttons (Back, Forward, Reload, Home, New tab, Copy URL, Extensions, Profile, Little Quasar) left or right of the address bar, or hide them. Height, what the address shows (domain, full address, title), hide until pointed at, its own colour and strength, where Home goes. Right-click the top bar for quick options |
| Sidebar | Left, right or **top** (tabs in a strip), width, icons only, hide until pointed at, which sections show (Favorites, pinned, folders, recent downloads, recent history), icon/title/both, row spacing, new tabs at the top or bottom. Right-click a folder › Change Icon… |
| New tab and start page | What Ctrl+T opens (command bar, start page or a page you choose), layouts (Minimal, Focus, Dashboard), clock, date, greeting (with your name or your own message), shortcuts (add, drag to reorder, emoji or image icons, columns and size), weather (Open-Meteo), to-do list, notes, recently closed tabs, search box position and engine, background (colour, gradient, Bing picture of the day, mountain photos or your own) |

## Import from Arc

The first time Quasar starts on a PC with Arc installed, it offers to import. You can also
do it any time from **Settings (gear) › Import from Arc…**.

| Comes across | Notes |
|---|---|
| Spaces | Name, emoji, colour (as a gradient) and grain. Each becomes its own separate profile |
| Pinned tabs | Kept with their folders (nested folders too) and split views |
| Split views | Open split views come over as Quasar split views |
| Open tabs | Each Space's unpinned tabs |
| Favorites | Arc keeps them per profile; each Space gets the ones from its own Arc profile (up to 12) |
| History | Optional tick box. Each Space gets only its own Arc profile's history |

**Not imported:** logins, cookies and saved passwords. Chromium encrypts them so only
Arc can read them, so you sign in to sites again in each Space. Running the import
again only adds Spaces that aren't already in Quasar.

Arc's data lives in
`%LOCALAPPDATA%\Packages\TheBrowserCompany.Arc_…\LocalCache\Local\Arc`. If Quasar can't
find it, it asks you to pick `StorableSidebar.json` from there. Arc stops working on
22 December 2026, so import before then (the files stay on disk, but it's safest
while Arc is still installed).

## Import from other browsers

**Settings › Import from Chrome, Edge, Firefox, Brave, Opera…** (or the command bar) lists
the browsers and profiles on this PC: Chrome, Edge, Brave, Vivaldi, Opera, Opera GX and
Firefox. Their bookmarks come in as a pinned folder ("From Google Chrome") in the Space
you're in, with their folders, and their history (optional) helps the command bar suggest
sites. It works while the other browser is open. Then Quasar says where that browser
exports its passwords; choose the CSV file it makes and Quasar adds them (see Passwords).

**Bookmarks file:** Settings › Import bookmarks file… reads the standard bookmarks HTML
file every browser exports. **Export bookmarks file…** writes this Space's pinned tabs
(with folders), Favorites and Read Later the same way, so any browser can take them.

## Passwords

Open **Settings › Saved passwords…**, or type "Passwords" in the command bar.

**Import:** export your passwords as a CSV file in the other browser. Arc:
`arc://password-manager/settings` › **Export passwords** (once for each Arc profile).
Chrome, Edge, Brave, Opera, Vivaldi: Password Manager › Settings › Export passwords.
Firefox: Passwords › ⋯ › Export passwords. Bitwarden and 1Password CSV files work too,
including their authenticator keys. In Quasar's Passwords window, pick the Space they belong
to (e.g. School), click **Import CSV…**, then let Quasar move the CSV to the Recycle Bin and
empty the bin. The file holds your passwords in plain text. If you want the same login in
two Spaces, import the file into each.

**Export:** Passwords › **Export CSV…** (or Settings) asks for Windows Hello, warns that the
file isn't encrypted, then saves `name,url,username,password,note` (the note holds an
`otpauth://` link for logins with an authenticator code), which any password manager can
import. One Space's profile or all of them.

**Authenticator (2FA) codes:** click 🔢 on a login and paste the setup key the site shows
when you turn on two-step sign-in (the letters next to its QR code), or an `otpauth://`
link. On that site's code box, Quasar then offers the current 6-digit code. Click 🔢 again
to copy the code (after Windows Hello); right-click it to change or remove the key.

**Breached passwords:** Passwords › Password checkup › **Check for passwords found in data
breaches** uses Have I Been Pwned. Only the first 5 characters of each password's SHA-1
hash leave this PC; the reply lists every leaked hash starting with them (padded so its
size gives nothing away), and the match is made here. Logins found get a red flag.

**Using them:** click into a login field and Quasar shows the saved accounts for that site.
Pick one to fill it in. Quasar never fills passwords without your click, only offers
accounts saved for that exact site, and only those saved in the Space you're in. When you
sign in somewhere new, the sidebar asks **Save / Never**.

**Security:**
- Stored in `%APPDATA%\Quasar\passwords.bin`, encrypted with your Windows account (DPAPI).
- Showing or copying a password asks for Windows Hello (PIN or fingerprint), and stays
  unlocked for 5 minutes.
- Copied passwords are wiped from the clipboard after 30 seconds.
- Quasar's sidebar never receives passwords or authenticator keys. Only the page you're
  signing in to does, after you pick an account (and only the current code, not the key).
- Exporting needs Windows Hello first.

## Good to know

- **This isn't Chrome.** Google account sync and saved Chrome passwords aren't available
  here, and not every Chrome extension works (see Chrome extensions below).
- **Welcome tour:** a short tour runs the first time Quasar starts on a new install
  (Settings › Show the welcome tour brings it back).
- **Continue where you left off** (Settings › Tabs): open tabs stay when Quasar closes and
  come back next time (asleep until you click them; split views too) until auto-archive
  takes them. Off by default, in which case open tabs close and go to the Archive.
- **Pinned tab moved on:** when a pinned tab has gone to another page, the sidebar shows
  "Pinned title / page now" with a ↺ button that takes it back to its pinned address.
  Right-click › Make This Page the Pinned Address keeps the new page instead.
- **Tab previews:** hover over a tab in the sidebar for a moment to see a picture of it
  (taken while it was on screen; kept in memory only, never for private windows). Turn
  off in Settings › Tabs.
- **Sidebar on the right:** Settings › Sidebar. The top bar then runs the full width and
  the sidebar toggle stays in it.
- **Now playing:** when a tab you're not looking at plays sound or video, a card at the
  bottom of the sidebar shows what it is (with the song title and artist when the site
  provides them) and has play/pause, previous/next and mute. Next uses the site's own
  "next track" when it has one (YouTube's next button otherwise). Click the card to go to
  the tab.
- **Keyboard shortcuts:** Ctrl+/ lists them all. In Library › Keyboard shortcuts, click
  Change and press the keys you want (Ctrl or Alt plus a key, or an F-key). A key that's
  already used moves to the new command (Quasar says which). Ctrl+C/V/X/A/Z/Y, Ctrl+1–9
  and Esc can't be taken over. A few commands (Next/Previous Space, Play/pause, Next
  track, Translate…) have no key until you give them one.
- **USB, serial, HID and Bluetooth devices** (WebUSB, Web Serial, WebHID, Web Bluetooth),
  for firmware flashers, microcontroller IDEs and hardware dashboards: when a site asks,
  Quasar shows a chooser listing the matching devices (it updates as you plug things in);
  the site gets only the one you pick. Picks are remembered per site and Profile (forget
  them in Library › Site settings), and in private windows only until the window closes.
  Bluetooth pairing asks for confirmation or a PIN when the device needs one.
- **Payment cards:** save cards in Settings › Saved passwords › Payment cards (or choose
  Save card when Quasar offers after you pay on a site). Clicking a card-number field on a
  secure page lists your cards by brand and last four digits; picking one asks for
  Windows Hello, then fills number, name and expiry and puts the cursor in the security
  code box. The security code (CVC) is never saved. Cards are encrypted with your
  passwords and stay on this PC (not in backups or sync). Card fields inside another
  site's frame (some payment providers draw their own fields) can't be filled.
- **Updates:** Quasar installs Electron security updates by itself (see "Updates" below).
  You can still update by hand with `npm install --save-dev electron@latest`; Quasar
  notices and uses that version if it's newer.
- **Google sign-in and robot checks:** Google may show "unusual traffic" checks or
  refuse sign-in in browsers it doesn't recognise. Quasar identifies itself the same way
  Chrome does, but this can still happen, especially on a new profile. If it does, try the
  padlock › Tell This Site I'm Using › Google Chrome (or Edge) on that site.
- **Downloads** go to your Downloads folder. While something downloads (and for a minute
  after), a download button with a progress ring sits next to the address; it opens
  Library › Downloads (Ctrl+J), where you can pause, resume, open or show each file.
  PDFs open in Quasar's built-in PDF viewer instead of downloading.
- **Site permissions** (camera, microphone, location, notifications) are asked once per
  site, separately in each Space, and remembered after restarting. Change them from the
  icon at the left of the address pill, or in **Library › Site settings**.
- **Library** (Ctrl+H history, Ctrl+J downloads): browse and search this Space's
  history and delete single entries; see downloads with progress, pause, resume,
  cancel, retry, open and show in folder (the list is kept between restarts); and
  review every site's permissions and zoom level.
- **Windows:** Ctrl+N opens another window, Ctrl+Shift+W closes one. Tabs belong to
  Spaces, not windows (like Arc): clicking a tab another window is showing moves it
  over, and closing one of several windows keeps its tabs. Drag a tab out of the
  sidebar and drop it on the page area or outside the window to give it its own window
  (drop it on another Quasar window to move it there), or right-click it › Move to New
  Window. Closing the last window quits Quasar.
- **Quitting:** Ctrl+Shift+Q (or Settings › Quit Quasar) closes every window at once, and
  they all come back next time, each on its Space and in the same place. Closing windows
  one by one brings back just the last one (Windows' "Close all windows" counts as
  closing them together).
- **Open tabs close when Quasar closes** (unless "Continue where you left off" is on), in
  every Space, including ones no window was showing. Pinned tabs and Favorites stay.
  Closed tabs go to the Archive (the box icon at the bottom of the sidebar), so you can
  still get one back.
- **Unfinished downloads** are paused when Quasar closes and their partial file is kept.
  Next time Quasar offers to resume them (or use Resume in Ctrl+J), and they carry on from
  where they stopped, as long as the website supports resuming; otherwise use Retry.
- **Private windows** (Ctrl+Shift+N) use a temporary Space: no history, cookies,
  site data, permissions, zoom or downloads list are kept after the window closes.
- **Sound:** tabs playing audio show a speaker in the sidebar; click it (or right-click
  the tab) to mute.
- **Split view:** up to 4 tabs side by side. Right-click a tab › Split View with Current
  Tab, right-click a link › Open Link in Split View, or Ctrl+Shift+= to pick what opens
  beside the current tab. Click a pane to make it the active one (it gets a ring); drag
  the handle between panes to resize. A split view is one row in the sidebar; right-click
  it to pin it, separate it, or close panes. Pinned split views reopen side by side.
- **Folders for pinned tabs:** "+ Folder" on the line under the pinned tabs (or the
  command bar). Drag pinned tabs, today's tabs or other folders onto a folder; click it to
  open or close it; double-click to rename; right-click for more (Move To, Delete Folder
  keeps its tabs).
- **Peek:** Shift+click a link (or right-click › Open Link in Peek) to preview it over
  the current page. Links from pinned tabs and Favorites to another site open in Peek too,
  so the pinned page stays put. Esc or clicking outside closes it; "Open as tab" keeps it.
- **Boosts** (Library › Boosts, or the site icon › Boost this site): your own CSS for a
  site, applied every time it loads; edits show instantly. Optional JavaScript runs in its
  own isolated world on each load.
- **Air Traffic Control** (Library › Air Traffic Control, or the site icon › Always open
  this site in): links to a site open in the Space you choose: from other apps, links that
  open a new tab, and addresses typed in the command bar.
- **Command bar extras:** type a sum (`12*7.5`, `15% of 80`, `2^10`, `sqrt(2)`) and Enter
  copies the answer; archived tabs show up (Enter restores); open tabs, pinned tabs and
  Favorites from other Spaces show under "Other Spaces" (choosing one switches Space).
- **Picture-in-picture:** switch away from a tab with a playing video and it floats in a
  small window; come back and it docks again. Turn off in Settings › Video.
- **Ad and tracker blocking** (on by default; Settings › Privacy and security): uses the
  EasyList and EasyPrivacy lists (about 98,000 network rules), refreshed every few days.
  The 🛡 badge next to the address shows how many were blocked on the page; click it to
  allow ads on a site that breaks (that turns off everything below for the site too).
  - **Ad boxes are hidden** using EasyList's element-hiding rules (about 30,000), applied
    before the page draws, plus Quasar's own rules for YouTube's feed, search and sidebar ads.
  - **YouTube:** Quasar removes the ad entries from YouTube's player and page data before
    YouTube's code sees them, so pre-roll and mid-roll ads, feed ads and promoted results
    don't appear.
  - **Video ad skipper:** if an ad still plays (YouTube changes things now and then, or
    another site's player: Google IMA, video.js, JW Player), Quasar mutes it, plays it at
    16× / jumps to its end and presses Skip, then restores your sound and speed.
  - **Twitch** stitches ads into the stream itself, so they can't be removed; Quasar mutes
    them and shows "Ad muted by Quasar" instead.
  - YouTube sometimes fights ad blockers (warning pop-ups, slower loading). If a site
    misbehaves, allow ads on it from the 🛡 badge.
- **Dangerous-site warnings:** sites on public malware and phishing lists (URLhaus via
  urlhaus-filter, OpenPhish, Phishing Army) get a red "Dangerous / Deceptive site ahead"
  page, and downloads from them are stopped. The lists are downloaded and checked on this
  PC — the sites you visit are never sent anywhere. (This isn't Google Safe Browsing, which
  needs a Google key and sends lookups to Google; the lists are smaller.) "Visit anyway"
  lasts until Quasar closes.
- **Always-HTTPS** (on by default): `http://` addresses are tried over HTTPS first. If a
  site has no secure version you get a "doesn't support a secure connection" page with
  "Continue (not secure)", remembered until Quasar closes. Local addresses (IPs, `localhost`,
  `.local`, single-word names, explicit ports) are left alone.
- **Strong passwords:** on sign-up and change-password forms, clicking the new-password box
  offers "Use a strong password" (18 random characters), filling it and its confirm box;
  right-click a password box › Suggest Strong Password works anywhere. A strength meter
  shows while you type a new password. The Passwords window has a **checkup** that flags
  weak passwords and ones used on more than one site.
- **Address autofill:** save addresses in Settings › Saved passwords › Addresses (or choose
  Save when Quasar offers after you submit an address form). Clicking into an address form on
  a secure site offers your saved addresses; nothing is filled until you pick one. They're
  stored encrypted with your passwords, separately per Space.
- **Chrome extensions** (Library › Extensions, or the puzzle button): paste a Chrome Web
  Store link (or ID), install a `.crx`, load an unpacked folder, or import the extensions
  installed in Arc. They run in every Space (not private windows) unless you untick a Space
  under the extension in Library › Extensions, which keeps that extension out of it (Spaces
  on one Profile share a browser session, so the tick boxes are per Profile). Their buttons
  and popups appear next to the address bar, and their right-click items in page menus. Quasar uses
  [electron-chrome-extensions](https://github.com/samuelmaddock/electron-browser-shell) for
  `chrome.tabs`, `chrome.windows`, toolbar buttons and `chrome.contextMenus` on top of what
  Electron supports. Not every extension works: anything relying on APIs Electron lacks
  (`declarativeNetRequest` — how most Manifest V3 ad blockers work — side panels, offscreen
  documents, `chrome.identity`, new-tab overrides…) won't. Quasar checks an extension before
  installing it and, if it needs any of those, says which and asks first; the Extensions
  list shows the same warning. Some complex ones (Dark Reader, in testing) install and run
  their background part but don't take effect. Web Store extensions are checked for
  updates daily.
- **Backup & sync** (Library › Backup & sync):
  - *Back up* to a `.archbackup` file: Spaces, pinned tabs and folders, Favorites,
    settings, Boosts, Air Traffic Control, site permissions and zoom, and optionally
    history and passwords/addresses. With a passphrase it's encrypted (scrypt +
    AES-256-GCM); passwords are never written unencrypted.
  - *Restore* Quasar backups or Arc+Chrome extension backups, either adding to what's there or
    replacing it.
  - *Automatic backups* once a day to `Documents\Quasar Backups` (last 10 kept; these don't
    include passwords).
  - *Sync between PCs* through a folder OneDrive/Dropbox/Google Drive keep in step: each PC
    writes its own encrypted file there with the same passphrase, and merges the others'
    changes (newest change wins per item; deletions carry over) every 5 minutes, at start
    and when Quasar closes. There's no Quasar server; the folder service only ever sees
    encrypted files.
  - *Tabs on your other PCs:* each PC also writes the tabs it has open. They're listed in
    Library › Backup & sync and found by the command bar (under "On your other PCs");
    choosing one opens it here. They're never merged into this PC's own tabs.
- **Reader mode** (📖 in the address pill when a page is an article, F9, or right-click):
  the article alone, using Mozilla's Readability (the engine of Firefox's Reader View),
  with text size, serif/sans, light/sepia/dark, width and **Listen** (read aloud with
  Windows' voices).
- **Translation:** a 文 button appears when a page is in another language (right-click ›
  Translate Page works on any page; select text › Translate for a phrase). Translation
  runs **on this PC** with Bergamot, the engine behind Firefox Translations: the page and
  its address go nowhere, so it works on pages you're signed in to, and the text is
  replaced where it is (the page keeps working). The first time for a pair of languages,
  Quasar downloads its model (about 20–40 MB, from Mozilla's public model store, checked
  against its SHA-256) into `%APPDATA%\Quasar\translation-models`. After you translate a
  page, the next pages on that site in the same language are translated too, until you
  click Show original. Languages: Bulgarian, Czech, Dutch, English, Estonian, Farsi,
  French, German, Icelandic, Italian, Norwegian, Polish, Portuguese, Russian, Spanish and
  Ukrainian (other pairs go through English). If a page doesn't say its language, Quasar
  asks. For other languages Quasar offers Google Translate instead (it asks first, since the
  address goes to Google, and it can't do signed-in pages); Settings › Translation can
  make Google the default. The target language is your Windows language (`translateTo`).
- **Tab sleeping:** background tabs you haven't looked at for 30 minutes (Settings ›
  Tab sleeping: Never, 5 min … 4 hours) unload to free memory. They stay in the sidebar,
  faded, and reload at the same scroll position when clicked. Tabs playing sound, in
  picture-in-picture, with unsaved work, or with DevTools open stay awake. Right-click a
  tab › Sleep Tab, or "Put Other Tabs to Sleep", to do it now.
- **Crashed pages** show a "This page crashed" page with **Reload** (and Close tab)
  instead of a blank tab; a tab that crashed in the background shows it when you switch
  to it. A page that stops responding offers **Wait** or **Stop page**.
- **Which version am I on?** Settings › Updates starts with a card showing your exact Quasar
  version, whether it's an installed, zip or source copy, the latest version and when it was
  last checked (with an "Up to date" / "Update available" badge), plus the Electron, Chromium,
  Node.js and Windows versions. **Copy version info** puts all of it on the clipboard, for
  bug reports.
- **Updates (installed with Quasar-Setup.exe):** Quasar updates itself as a whole. About
  30 seconds after it starts, and every 4 hours, it checks the GitHub repo's Releases for a
  newer version, downloads it in the background (checked against the SHA-512 in the
  release's `latest.yml`), and installs it when you close Quasar, or right away with
  **Restart to update**. Each release brings its own Electron and packages, so the engine
  and component updaters below are only used by copies run from source or the zip. Turn
  off "Download Quasar updates automatically" in Settings › Updates to be asked first.
  To publish a version, see `tools\publish-quasar.ps1` and `PUBLISHING.md` in the project folder.
- **Engine updates (source and zip copies):** Quasar keeps its engine (Electron, which brings Chromium's security fixes)
  up to date by itself. Twice a day it checks for a newer Electron in the same major
  version, downloads the official build from Electron's GitHub releases, checks it
  against the published SHA-256 list, and test-starts Quasar on it in the background.
  Only if that works do Quasar's shortcuts switch to it; it's used from the next start
  (or "Restart now"). The engine lives in `%APPDATA%\Quasar\engine\` (about 350 MB each;
  the current and previous one are kept), and Settings › Updates can go back to the
  previous one. A new major version is offered, not installed by itself, because it can
  change how things work. `node_modules\electron` is left alone, so `npm start` still
  uses whatever npm installed.
- **Component updates** (Library › Updates): the packages Quasar is built from
  (electron-chrome-extensions, Mozilla Readability, Bergamot) are checked against the npm
  registry once a day, and Quasar says when there's an update. "Update now" downloads them,
  checks each against the registry's SHA-512 checksum, keeps the old copy, and test-starts
  Quasar with the new ones in the background; if that fails the old ones go straight back.
  New versions run from the next start, and "Go back to the previous versions" undoes it.
  Only versions within the ranges in `package.json` are installed (a new major version is
  just mentioned). Quasar's own code isn't published anywhere it could update from, so it
  changes only when you replace the folder (or `git pull`, if you keep it in git).
- **Screenshots** (Ctrl+Shift+2, or right-click › Take Screenshot): drag over the page for
  an area, or choose Visible area (Enter) or Full page (F). The picture is copied and saved
  to Downloads (it's listed in Ctrl+J). Full pages are cut at 16,000 px tall.
- **Zoom** (Ctrl +/−/0 or Ctrl + mouse wheel) is remembered per site. When a page
  isn't at 100% the level shows next to the address; click it for options.
- **Page tools:** Ctrl+P print (pick "Microsoft Print to PDF" to make a PDF, or use
  "Save as PDF…" from the right-click menu or command bar), Ctrl+U view source,
  Ctrl+Shift+S save page (Ctrl+S stays the sidebar toggle), F11 full screen.
- **Default browser:** Settings › Make Quasar my default browser registers Quasar with
  Windows and opens Settings › Default apps, where you choose Quasar (Windows doesn't let
  apps make themselves the default). After that, links and .html files from other apps
  open in Quasar.
- **Site info:** the padlock (or "Not secure") at the left of the address pill shows
  whether the connection is secure, the site's certificate and its permissions.
- **Forget a site** (padlock › 🧹 Forget *site*…): after one confirmation, Quasar removes
  everything it kept about the site and all its subdomains in this profile: cookies and
  logins, site storage, cached files, history (and the text kept for history search),
  archived and recently closed tabs, its entries in the downloads list (the files stay),
  permissions, device access, zoom and certificate choices. Its open tabs reload as if
  you'd never been there, and that reload isn't recorded either. Your pinned tabs,
  Favorites, saved passwords, Read Later, notes and your settings for the site (Boosts,
  dark mode, Air Traffic Control) stay. Other sites and other profiles aren't touched.
  **Forget This Site When I Close It** (same menu) does this by itself when the site's last
  tab in that profile closes, like Brave.
- **Downloads** carry Windows' "from the internet" mark (Mark of the Web), so SmartScreen
  checks programs you run and Office opens documents in Protected View.
- **Certificate errors** show a "Your connection isn't private" page. Under **Advanced**
  you can proceed anyway; that choice lasts until you restart Quasar, and the site shows
  "Not secure" meanwhile.
- **Sign-in pop-ups** (sites or proxies that ask for a username and password) open a
  small Quasar sign-in box.
- **Unsaved work:** closing a tab, Little Quasar, or the window asks "Leave site?" when
  a page has unsaved changes, including pages in open Little Quasar windows when the
  main window closes. Auto-archive skips those tabs instead of asking.

## More features

**Privacy**
- **Cookie banners** (Settings › Privacy, on by default): the EasyList Cookie List hides
  banners and blocks the scripts that show them, and DuckDuckGo's open-source autoconsent
  finds the consent tool on a page and chooses "reject" / "only necessary" for you.
  Allowing ads on a site (🛡 badge) turns this off there too.
- **Fingerprinting protection** (on by default): canvas drawings, audio processing and text
  measurements get tiny changes, the same on every page of one site (so it works) but
  different between sites and between Quasar sessions, so trackers can't match your visits
  up. Pages are also told 8 processor cores and 8 GB of memory, like many PCs. It covers
  the page itself, not its iframes or workers.
- **Free VPN** (the **VPN** button in the top bar, Settings › Privacy, or the command bar),
  like Opera's: one click sends the Space's pages (its whole profile) through Cloudflare
  WARP, free with no data limit. The button turns blue; click it to see the address and
  location sites now see, reconnect, turn it off, or open a private window with VPN.
  The first time, Quasar offers to install WARP (Cloudflare's installer, a 57 MB download;
  Windows asks for permission). Quasar uses WARP's proxy mode, so only Quasar's pages go
  through it, not the rest of the PC. WARP hides your IP address, but you can't choose a
  country: sites still see roughly your region. If WARP stops, pages in that Space don't
  load rather than going out without the VPN. WebRTC is kept behind it too.
- **Proxy or Tor per Profile** (Space editor › Connection): Windows' proxy settings
  (default), direct, your own proxy (`socks5://host:port`, `host:port`…), or Tor. Tor needs
  Tor Browser (port 9150) or the Tor service (9050) running; if it isn't, pages in that
  profile don't load rather than going out directly. WebRTC is kept behind the proxy. The
  command bar's **New private window with Tor** gives a private window that goes through
  Tor. (Tor Browser also hides much more than the network address; Quasar doesn't match that.)
- **Passkeys:** sites' "Sign in with a passkey" works through Windows Hello (Windows keeps
  the passkeys, not Quasar).
- **Clean links** (on by default): `utm_…`, `fbclid`, `gclid`, `msclkid` and similar
  tracking parameters are taken off addresses before the page loads, and forwarding pages
  (Google's and Facebook's link redirects, YouTube's, Reddit's, Outlook Safe Links…) are
  skipped.
- **Global Privacy Control** (on by default): every request says "don't sell or share my
  data" (`Sec-GPC: 1`), which some US states treat as a legal opt-out.
- **Lock a Space with Windows Hello** (right-click a Space, or the Space editor): once you've
  been away (Windows locked, the PC slept, or Quasar in the background for 5 minutes; change it
  in Settings) the Space shows a lock screen until Windows Hello says it's you. Other Spaces
  stay a Ctrl+1–9 away, and a locked Space's tabs don't show up in other Spaces' searches.
  Settings can lock private windows the same way. "Lock now" is in Settings and the
  command bar.
- **Tell a site you're using Chrome, Edge or Firefox** (padlock › Tell This Site I'm Using):
  for sites that refuse browsers they don't know. It changes what that site sees in the
  request headers and in its scripts.

**Pages**
- **PDFs** open in the built-in PDF viewer (Chromium's: zoom, search, print, download; it
  can't highlight, fill forms or sign like Edge's).
- **Zap** (right-click › Hide Things on This Page, or the command bar): click anything to
  hide it; Esc or Done when finished. It's saved as a "Zapped on <site>" Boost, so it stays
  hidden; undo in Library › Boosts.
- **Dark mode for a site** (right-click › Dark Mode for This Site): Quasar inverts the page's
  colours (pictures and video stay as they are) on every page of that site. Pages that are
  already dark are left alone. **Dark mode for every site:** Settings › General › Make every
  site dark (or the command bar) does this everywhere; then the same right-click item turns
  one site back to normal.
- **Copy Text from Image** (right-click an image): Windows' own text recognition, on this PC.
- **Search with an image** (right-click an image › Search Image with Google Lens, or with
  Bing): opens the results in a new tab. The image's address is sent to Google or Bing, so
  images that only exist inside the page can't be searched (the item is greyed out).
- **Define** (select a word › right-click › Define “word”): its meanings, with examples, in
  a card. English definitions come from the free Dictionary API (only the word is sent);
  a word it doesn't know opens a "define …" search in Peek.
- **Middle-click auto-scroll** (on by default; Settings › General): click the mouse wheel on a
  page and move the mouse; it scrolls that way, faster the further you move. Click again or
  press Esc to stop, or hold the wheel down while moving and let go. (Electron doesn't have
  this, so Quasar adds it.)
- **QR code for the page** (right-click, or the command bar): to open it on your phone.
- **Mouse gestures** (on by default; Settings): hold the right button and draw: ← back,
  → forward, ↓ new tab, ↓→ close tab, ↑↓ reload, ↑ top of page, ↓↑ bottom, ←→ reopen closed tab.
- **Copy Link to Highlight** (select text › right-click): a link that opens the page scrolled
  to that text, highlighted.
- **Read aloud** (right-click › Read Page Aloud, Ctrl+Shift+U, or select text › Read Selection
  Aloud): Windows' voices read it; pause and stop are at the bottom of the sidebar.
- **Live captions** (command bar or Settings): starts Windows 11's Live Captions, subtitles for
  anything playing, made on this PC.
- **Mark up screenshots:** after a screenshot, **✎ Mark up** opens it with a pen,
  highlighter, boxes, arrows and blur (for personal details), then Copy or Save.
- **Videos for offline** (right-click a video › Save Video to Watch Offline, or the command
  bar): the file is saved on this PC and listed under Read Later › Saved videos. Sites that
  stream video in small pieces (YouTube, Netflix, most big video sites) can't be saved this way.
- **Settings › Pages:** default zoom for every site (sites you zoom keep their own), a minimum
  font size, and "Ask where to save each download".

**Sidebar and tabs**
- **Live Folders** (command bar › New Live Folder): paste an RSS/Atom feed, a site (Quasar
  finds its feed), or `github.com/owner/repo` (pull requests) / `…/issues`. The pinned folder
  fills itself and updates every 30 minutes; new items are bold with a count on the folder.
  Right-click it to refresh or mark everything read. GitHub allows 60 anonymous requests
  an hour.
- **Notes** (the note icon at the bottom of the sidebar): a scratchpad for each Space.
  Select text on a page › right-click › Add to Notes keeps the page's address with it.
- **Read Later** (bookmark icon, Ctrl+Shift+D, or right-click): save pages without pinning
  them; opening one marks it read.
- **Compact mode** (Ctrl+Shift+L, or Settings): the sidebar and top bar hide; touching the
  window's edge brings them back until the mouse leaves them.
- **Sites as sidebar panels:** the **+** under the tabs keeps the current site in a panel
  beside every page (WhatsApp, Discord, a calendar, music). Its icon opens and closes it;
  right-click for width, reload, or remove. It stays signed in as in the Space it was added from.
- **Split view grid:** with 3 or 4 panes, right-click the split › Arrange as Grid.
- **Tidy tabs** (command bar): tabs from the same site go together and exact duplicates close.
- **Folders for today's tabs** (right-click a tab › Add to New Folder / Move to Folder, or
  drag a tab onto a folder): folders, and folders inside them (two levels). Double-click to
  rename; right-click a folder to nest, ungroup or close its tabs.
- **Unread counts:** pinned tabs and Favorites show the number in their title ("(3) Inbox").
- **Find in all tabs** (Ctrl+Shift+F): searches the text of every open tab in this Space and
  jumps to the match.
- **Tab sleeping per Space** (Space editor): e.g. 2 hours for Work, 5 minutes for Fun, or
  never. Padlock › Never Put This Site to Sleep keeps chat apps and dashboards live.
- **Install a site as an app** (command bar › Install this site as an app): a Start menu
  (and optionally desktop) shortcut with the site's icon opens it in its own window with
  its own taskbar button, no sidebar. Links to other sites open in Quasar. Right-click inside
  it › Uninstall This App.

**Command bar and the rest**
- **Completing the address:** type `yo` and the bar fills in `youtube.com` (the added part
  is selected), so Enter goes straight there; keep typing to replace it, or Backspace to
  remove it. It uses the sites you visit most in this Space (history, open and pinned tabs,
  Favorites), and completes page addresses too once you type a `/`.
- **Search suggestions** (on by default; Settings › General): as you type, your search
  engine's suggestions appear under the search line ("weather tom…" → "weather
  tomorrow"). This sends what you type to that engine (Google, Bing, DuckDuckGo or Brave),
  without your cookies. Never in private windows.
- **Search shortcuts:** a keyword and a space: `w cats` (Wikipedia), `yt lofi` (YouTube),
  `gh`, `r`, `maps`, `a`, `imdb`, `so`, `npm`, `mdn`, `g`, `b`, `d`. Sites that describe their
  own search are added as you visit them (keyword = the site's name). Add, change or remove
  them in Settings › Search shortcuts.
- **Task manager** (Shift+Esc): memory and CPU for each tab and Quasar's own processes; put a
  tab to sleep or end it. Settings › Memory limit (like Opera GX): over the limit, the tabs
  you used least recently go to sleep.
- **Command chains:** command bar › Record a command chain, run some commands (from the bar
  or with their shortcuts), then Stop recording. Run it from the command bar, or give it its
  own shortcut in Settings › Command chains (where you can also build one step by step).
- **Converters:** `10 km in miles`, `72 f to c`, `3 cups in ml`, `1 gb to mb`,
  `100 usd in eur` (European Central Bank rates, fetched once a day; nothing you type is
  sent), `time in tokyo`, `3pm london in new york`. Enter copies the answer.
- **Battery saver** (on by default): on battery, background tabs sleep after 5 minutes,
  silent background videos pause and tab previews aren't captured.
- **Take a break** (Settings, or the command bar): hides every tab behind a timer and
  mutes them for 5–60 minutes. "End break now" ends it early.

**Keyboard and screen readers**
- **F6** moves the keyboard from the page to the sidebar, then the top bar, then back
  (Shift+F6 the other way). In the sidebar the arrow keys move between tabs, Enter opens
  one, and the menu key opens its right-click menu; in the top bar ← → move between buttons.
- **F7** turns on caret browsing: a text cursor on the page that the arrow keys move (Shift
  selects, Ctrl jumps by word, Enter opens a link under it).
- Every sidebar and top-bar button has a name for Narrator, tabs say whether they're current,
  asleep or have unread items, and messages at the bottom of the sidebar are read out.
  (Checked with the accessibility tree, not yet with Narrator itself.)

**History**
- **Find pages by what was on them** (Settings › History, off by default): the command bar
  searches the text of pages you visited ("Found in pages you visited"). It runs only on
  this PC: up to 4,000 characters per page are kept in `%APPDATA%\Quasar\history-text`;
  turning it off or clearing history deletes them.

Quasar has no AI features and needs no API keys.

## Files

| Path | What it does |
|---|---|
| `src/main.js` | App start-up |
| `src/shell.js` | The browser's core: start-up, the state sent to the window UI, and the IPC entry point. The rest of the `Shell` class is split by area into `src/shell/` and mixed in |
| `src/shell/*.js` | `windows`, `profiles` (sessions, Profiles, permissions), `downloads` (and zoom), `pages` (web views, right-click menu, page tools), `tabs` (opening, closing, Ctrl+Tab, sleeping, tab menu), `layout` (where pages go, previews), `split`, `peek` (and screenshots), `pinned` (and Favorites), `spaces`, `warnings` (crash, dangerous-site, offline, certificate pages; site info), `reader` (and translation), `rules` (Boosts, Air Traffic Control), `media` (now playing, picture-in-picture), `command` (command bar), `little`, `keyboard`, `library`, `autofill` (passwords, addresses, cards), `arc`; shared constants and helpers in `common.js` |
| `src/shell/tools.js`, `collections.js`, `workspace.js`, `apps.js`, `pagetext.js` | Zap, site dark mode, text from images, QR, gestures · Live Folders, notes, Read Later · compact mode, panels, tidy, break, battery saver · site apps · page text (for reading aloud) and history search by page text |
| `src/shell/migrate.js`, `privacy.js`, `everyday.js`, `power.js` | Importing from other browsers, bookmarks files, password export · breach check, forget on close, Windows Hello locks, authenticator codes, browser identity per site · search shortcuts, highlight links, read aloud, live captions, unread counts, find in all tabs · task manager and memory limit, command chains, sleeping per Space, folders for today's tabs, screenshot mark-up, offline videos |
| `src/shell/vpn.js` | The free VPN: sets up Cloudflare WARP's local proxy and routes a profile through it |
| `src/shell/omnibox.js` | The command bar as an address bar: completing addresses as you type, and search suggestions |
| `src/browser-import.js`, `src/totp.js` | Reading other browsers' bookmarks and history, bookmarks HTML files · authenticator codes |
| `ui/taskmgr.*`, `ui/markup.*` | The task manager and screenshot mark-up windows |
| `src/convert.js` | Command bar unit, currency and time-zone converters |
| `src/shortcuts.js` | The list of keyboard commands and their default keys |
| `src/devices.js` | USB / serial / HID / Bluetooth device choosers |
| `src/mt.js`, `ui/mt.html`, `ui/mt-engine.js` | On-device translation (Bergamot) and its model store |
| `src/components.js` | Updates for the npm packages Quasar is built from |
| `src/app-update.js` | Self-updates for installed copies (electron-updater, from GitHub Releases) |
| `src/passwords.js` | Encrypted vault: passwords, addresses, cards; CSV import |
| `src/page-preload.js` | In-page autofill and save prompts, ad hiding, now-playing reports |
| `src/arc-import.js` | Reads Arc's Spaces, Favorites and history |
| `src/store.js` | Saving and loading `state.json`; colour presets; search engines |
| `src/preload.js` | Safe bridge between Quasar's own UI and the main process |
| `ui/` | The sidebar/top bar (`index.html`, `app.js`, `style.css`), command bar, Little Quasar |
