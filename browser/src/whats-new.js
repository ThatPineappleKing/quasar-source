// "What's new": shown once, on the first start after Quasar was updated to a new version.
//
// Add an entry for each release you publish, keyed by the version in package.json.
// `items` are short lines shown as a list. If a version has no entry here, the
// release notes from GitHub (the -Notes of publish-quasar.ps1) are shown instead.
const { app } = require('electron');

const NOTES = {
  // `items` can also hold { section, items } groups, shown under their own heading.
  '1.7.1': {
    title: 'What’s new in Quasar 1.7.1',
    items: [
      { section: 'Top bar', items: [
        'Pin site tools to the top bar: click the lock left of the address › Pin to Top Bar…, and tick up to 6 tools (Forget this site, Never sleep, Mute this site, ad blocking, pop-ups, reset zoom, Boost and more). They become one-click buttons; switches light up when on. Right-click one to move or unpin it.',
        'Right-click the address for Paste and Go, Edit Address, Copy Address (Ctrl+Shift+C), Share, Cast and a QR code.',
        'Back and Forward lists: right-click or hold Back or Forward to jump to any earlier or later page.',
      ] },
      { section: 'Fixes', items: [
        'Google sign-in works again. Google’s sign-in page refused Quasar; now only that page sees Quasar as Firefox. Gmail, YouTube and the rest of Google are unchanged.',
        'Copying the site address works again, from the address’s right-click menu or Ctrl+Shift+C.',
      ] },
      { section: 'Tabs and windows', items: [
        'Ctrl+Tab switcher with pictures: Ctrl+Tab goes to the tab you used last. Keep holding Ctrl and press Tab again to go further back, with a preview of each tab.',
        'Close several tabs at once: right-click a tab › Close Other Tabs or Close Tabs Below, or close every tab in a folder. Undo brings the whole batch back.',
        'Reopen a closed window from a tab’s right-click menu or the command bar.',
        'Your tabs come back after a crash or a Windows restart.',
        'Drag links and files onto Quasar to open them: links, images, PDFs and saved web pages.',
        'Swipe with two fingers on a page to go back or forward, or on the sidebar to switch Space.',
        'Pinned tabs and Favorites show their site icons even before you open them, offline and after a restart.',
      ] },
      { section: 'Sharing, media and sites', items: [
        'Share a page through Windows’ share panel (Nearby Share, Mail, Phone Link and others).',
        'Cast to a Miracast TV or wireless display.',
        'Pop-up blocker: pop-ups a page opens without a click are blocked. Click the icon in the address bar to allow one, or always allow them for that site.',
        'Per-site settings for sound and automatic downloads.',
        'Quick menu for selected text: Copy, Search and Translate. Prices and measurements also show a converted value (“$40” ≈ €37).',
        'Video speed from 0.5× to 3×, from the page’s right-click menu.',
        'An Autoplay setting stops videos playing with sound until you click.',
        'Media keys on your keyboard control the tab that’s playing.',
        'Links to other apps (email, Teams, Zoom…) ask before opening. Email links can open in Gmail, Outlook.com or Yahoo Mail instead.',
      ] },
      { section: 'Downloads', items: [
        'The download button now sits at the top left of the sidebar, like Arc, with a progress ring. Click it for your last 3 downloads, with buttons to open, show in folder, pause or retry.',
      ] },
      { section: 'Privacy and passwords', items: [
        'On a PC without Windows Hello, Quasar asks for your Windows password before showing saved passwords. Windows checks it; Quasar never sees it.',
        'Copied passwords and codes stay out of clipboard history (Win+V) and aren’t synced to your other devices.',
        'Each profile’s passwords stay with that profile: you see and manage them only from a Space on that profile.',
        'The eye shows a password only while you hold it down.',
        'Private windows never offer to save passwords or addresses.',
        'A username and password inside an address (user:pass@site) are used to sign in but never saved.',
        'New option to delete cookies and site data when Quasar closes (Settings › Privacy).',
        'Quieter notification requests: be asked each time, see a small notice, or never be asked.',
      ] },
      { section: 'Performance', items: [
        'Network limit (Settings › Performance) caps Quasar’s download and upload speed so games and calls stay smooth.',
      ] },
    ],
  },
  '1.6.1': {
    title: 'What’s new in Quasar 1.6.1',
    items: [
      'Fixed the bottom of the sidebar to be more consistent with Arc: smaller, lighter icons, evenly spaced however many Spaces you have.',
    ],
  },
  '1.6.0': {
    title: 'What’s new in Quasar 1.6',
    items: [
      { section: 'Glass', items: [
        'A new Glass look: pick it in Settings › Appearance › Style presets. Whatever is behind Quasar (other apps, your desktop) shows through the sidebar, top bar and empty tab area. Web pages stay solid.',
        'Choose how see-through it is, and turn on “Blur what’s behind the window” for a frosted look.',
        'Glass applies to new windows, or after you restart Quasar.',
        'While blur is on, screenshots and screen sharing can see through Quasar.',
      ] },
      { section: 'A cleaner design', items: [
        'Quasar’s design has been reworked to feel more hand-made: simple outline icons instead of emoji, neutral shadows, tidier corners and text sizes, and clearer wording throughout.',
      ] },
    ],
  },
  '1.5.3': {
    title: 'What’s new in Quasar 1.5.3',
    items: [
      'Improved RAM and CPU usage: pages load faster and each tab uses less memory, because Quasar’s ad and cookie-banner blocking now does much less work per page.',
      'Fixed: the new tab command bar (and other pop-ups) didn’t match your theme. They now take their colours from your Space.',
      'Fixed: the words on the buttons under Settings › Updates weren’t lined up properly.',
    ],
  },
  '1.5.2': {
    title: 'What’s new in Quasar 1.5.2',
    items: [
      'Improved efficiency: Quasar now uses noticeably less memory, so it runs lighter alongside your other apps.',
    ],
  },
  '1.5.1': {
    title: 'What’s new in Quasar 1.5.1',
    items: [
      'Fixes for the new customisation options from 1.5:',
      'Hidden top bar and sidebar: they now come back reliably when you point at the edge of the window, even when the window isn’t maximised. They hide again if you don’t use them.',
      'Messages (like “Theme applied”) now show in the top bar when the sidebar has no room for them, instead of pushing the page aside.',
      'Start page shortcuts show the site’s own icon when Quasar already knows it. Quasar no longer asks each site for its icon. Image links for icons can now be longer.',
      'The Notes widget no longer loses what you were typing when another widget updates.',
      'If the weather can’t find your town, you can type another one right on the start page.',
      'Bing’s picture of the day changes on your own date. If it can’t download, Quasar waits a bit before trying again.',
      'Home button and “page of my choice”: an address that doesn’t work now shows a message instead of being quietly ignored.',
      'Style presets always give the same look, whatever preset you used before.',
      'Changing the start page’s background, tile size, columns or greeting no longer switches its layout to “Custom”.',
      'Undoing an imported theme now puts the Space’s colours back too, and keeps changes you made afterwards.',
    ],
  },
  '1.5.0': {
    title: 'What’s new in Quasar 1.5',
    items: [
      'Quasar now lets you change almost everything about how it looks. Open Settings to try it.',
      { section: 'Top bar', items: [
        'Show, hide or move each button, including the new Home, New tab, Profile and Little Quasar buttons.',
        'Choose a compact, normal or tall height.',
        'The address bar can show just the domain, the full address, or the page title.',
        'It can hide until you point at the top edge of the window, so pages get more room.',
        'Give it its own colour, with a slider for how strong the colour is.',
        'Right-click the top bar for quick options.',
      ] },
      { section: 'Sidebar', items: [
        'Put it on the left, the right or the top. On top, your tabs sit in a strip, and the Space editor and notes open as a side panel.',
        'Adjust its width, or switch to icons only. It widens by itself while you’re editing something.',
        'It can hide until you point at the edge of the window.',
        'Turn sections on or off: Favorites, pinned tabs, folders, and the new Recent downloads and Recent history lists.',
        'Tabs can show their icon, their title or both, with three row spacings.',
        'New tabs can go at the top or the bottom of the list.',
        'Right-click a folder › Change Icon… to give it an emoji.',
      ] },
      { section: 'New tab and start page', items: [
        'Choose what Ctrl+T opens: the command bar, the start page or a page of your choice.',
        'Pick from three layouts: Minimal, Focus and Dashboard.',
        'Add widgets: clock, date, greeting (by time of day, with your name, or your own message), weather, to-do list, notes and recently closed tabs.',
        'Add, remove and drag shortcut tiles into order, with emoji or image icons. Set how many columns there are and choose from three sizes.',
        'Put the search box at the top, middle or bottom, or hide it. It can use its own search engine.',
        'Choose a background: a colour, a gradient, Bing’s picture of the day, one of the built-in photos, or your own photo.',
      ] },
      { section: 'Everywhere', items: [
        'Style presets, plus a colour preset for each Space.',
        'Choose an accent colour, font and text size.',
        'Sliders for corner roundness, blur and window transparency.',
        'Export your theme to share it, or import one. Quasar asks before changing a Space’s colours, and you can undo it.',
      ] },
    ],
  },
  '1.4.1': {
    title: 'What’s new in Quasar 1.4.1',
    items: [
      'Version viewer in Settings: open Settings › Updates to see exactly which Quasar you’re on, the latest version and when Quasar last checked, with an “Up to date” or “Update available” badge. It also lists the Electron, Chromium, Node.js and Windows versions, and “Copy version info” puts it all on the clipboard for bug reports.',
      'Updated logo: Quasar has a new icon on the taskbar, Start menu, desktop shortcut and windows.',
      'The new logo shows up straight away: Windows used to keep showing the old icon, especially on pinned taskbar buttons. Quasar now makes sure Windows picks up the new one.',
    ],
  },
  '1.4.0': {
    title: 'What’s new in Quasar 1.4',
    items: [
      'Improved efficiency: Quasar runs smoother and lighter.',
      'Address bar completion: start typing and Quasar finishes the address from sites you’ve visited (“yo” → youtube.com), and suggests searches as you type. You can turn search suggestions off in Settings › General.',
      'Middle-click auto-scroll: click the mouse wheel on a page, then move the mouse up or down to scroll. Click again to stop.',
      'Dark mode for every site: turn it on in Settings › General or the command bar (Ctrl+T, “Make every site dark”). Right-click a page › Dark Mode for This Site to switch one site back.',
      'Image search: right-click any image › Search Image with Google Lens (or Bing) to find where it’s from or what’s in it.',
      'Look up words: select a word, right-click › Define to see its meaning without leaving the page.',
    ],
  },
  // TEST DATA from the update tests (1.3.2, 1.3.3).
  '1.3.3': {
    title: 'Quasar was updated',
    items: ['This is a full test update.'],
  },
  '1.3.2': {
    title: 'Quasar was updated',
    items: [
      'TEST: this window shows that the update installed correctly.',
      'TEST: an “Update” button now appears in the top bar whenever a new version is out.',
      'TEST: Quasar checks for updates every time it starts.',
      'TEST: if you can read this, tell whoever sent you Quasar that the update worked.',
    ],
  },
};

const cmp = (a, b) => {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
};

// What to show at this start, or null. Records the running version either way.
// `st` is Quasar's saved state. Brand-new installs (welcome tour not seen yet) show nothing.
function takePending(st, releaseNotes) {
  const now = app.getVersion();
  // Copies from before this feature never saved a version; if they've already been used
  // (tour done), this start is the first one after an update.
  const prev = st.lastVersion || (st.settings?.toured ? '0.0.0' : null);
  st.lastVersion = now;
  if (!prev || cmp(now, prev) <= 0) return null;
  if (process.env.ARCH_USER_DATA && !process.env.ARCH_WHATS_NEW) return null;   // test profiles
  const n = NOTES[now];
  if (n) return { version: now, title: n.title || `What’s new in Quasar ${now}`, items: n.items || [], from: prev === '0.0.0' ? null : prev };
  if (releaseNotes) return { version: now, title: `Quasar was updated to ${now}`, items: [releaseNotes], from: prev === '0.0.0' ? null : prev };
  return null;
}

module.exports = { takePending, NOTES };
