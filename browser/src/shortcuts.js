// Keyboard shortcuts: the commands, their default keys, and how a key press is
// turned into a combination like "Ctrl+Shift+T". People can change them in
// Settings › Keyboard shortcuts (stored in st.settings.shortcuts).

const SHORTCUTS = [
  // Tabs and windows
  { id: 'command', group: 'Tabs and windows', label: 'Command bar (new tab)', keys: ['Ctrl+T'] },
  { id: 'url', group: 'Tabs and windows', label: 'Edit the address', keys: ['Ctrl+L'] },
  { id: 'close-tab', group: 'Tabs and windows', label: 'Close tab', keys: ['Ctrl+W'] },
  { id: 'reopen-tab', group: 'Tabs and windows', label: 'Reopen closed tab', keys: ['Ctrl+Shift+T'] },
  { id: 'next-tab', group: 'Tabs and windows', label: 'Last used tab (hold Ctrl, press again to go further back)', keys: ['Ctrl+Tab'] },
  { id: 'prev-tab', group: 'Tabs and windows', label: 'Last used tab, other direction', keys: ['Ctrl+Shift+Tab'] },
  { id: 'tab-down', group: 'Tabs and windows', label: 'Next tab in the sidebar', keys: ['Ctrl+Alt+Down'] },
  { id: 'tab-up', group: 'Tabs and windows', label: 'Previous tab in the sidebar', keys: ['Ctrl+Alt+Up'] },
  { id: 'pin', group: 'Tabs and windows', label: 'Pin / unpin tab', keys: ['Ctrl+D'] },
  { id: 'split', group: 'Tabs and windows', label: 'Split view: add a tab beside this one', keys: ['Ctrl+Shift+='] },
  { id: 'toggle-sidebar', group: 'Tabs and windows', label: 'Show / hide the sidebar', keys: ['Ctrl+S'] },
  { id: 'next-space', group: 'Tabs and windows', label: 'Next Space', keys: [] },
  { id: 'prev-space', group: 'Tabs and windows', label: 'Previous Space', keys: [] },
  { id: 'new-window', group: 'Tabs and windows', label: 'New window', keys: ['Ctrl+N'] },
  { id: 'private-window', group: 'Tabs and windows', label: 'New private window', keys: ['Ctrl+Shift+N'] },
  { id: 'little', group: 'Tabs and windows', label: 'Little Quasar window', keys: ['Ctrl+Alt+N'] },
  { id: 'close-window', group: 'Tabs and windows', label: 'Close window', keys: ['Ctrl+Shift+W'] },
  { id: 'quit', group: 'Tabs and windows', label: 'Quit Quasar (all windows)', keys: ['Ctrl+Shift+Q'] },
  { id: 'shortcuts', group: 'Tabs and windows', label: 'This list of shortcuts', keys: ['Ctrl+/'] },
  // The page
  { id: 'back', group: 'The page', label: 'Back', keys: ['Alt+Left'] },
  { id: 'forward', group: 'The page', label: 'Forward', keys: ['Alt+Right'] },
  { id: 'reload', group: 'The page', label: 'Reload', keys: ['Ctrl+R', 'F5'] },
  { id: 'hard-reload', group: 'The page', label: 'Reload without the cache', keys: ['Ctrl+Shift+R'] },
  { id: 'find', group: 'The page', label: 'Find on page', keys: ['Ctrl+F'] },
  { id: 'zoom-in', group: 'The page', label: 'Zoom in', keys: ['Ctrl+='] },
  { id: 'zoom-out', group: 'The page', label: 'Zoom out', keys: ['Ctrl+-'] },
  { id: 'zoom-reset', group: 'The page', label: 'Reset zoom', keys: ['Ctrl+0'] },
  { id: 'copy-url', group: 'The page', label: 'Copy the address', keys: ['Ctrl+Shift+C'] },
  { id: 'reader', group: 'The page', label: 'Reader mode', keys: ['F9'] },
  { id: 'translate', group: 'The page', label: 'Translate page', keys: [] },
  { id: 'fullscreen', group: 'The page', label: 'Full screen', keys: ['F11'] },
  { id: 'screenshot', group: 'The page', label: 'Screenshot', keys: ['Ctrl+Shift+2'] },
  { id: 'print', group: 'The page', label: 'Print', keys: ['Ctrl+P'] },
  { id: 'save-page', group: 'The page', label: 'Save page as', keys: ['Ctrl+Shift+S'] },
  { id: 'view-source', group: 'The page', label: 'View page source', keys: ['Ctrl+U'] },
  { id: 'devtools', group: 'The page', label: 'Developer tools', keys: ['F12', 'Ctrl+Shift+I'] },
  { id: 'read-later', group: 'The page', label: 'Save to Read Later', keys: ['Ctrl+Shift+D'] },
  { id: 'zap', group: 'The page', label: 'Hide things on the page (Zap)', keys: [] },
  { id: 'dark', group: 'The page', label: 'Dark mode for this site', keys: [] },
  { id: 'qr', group: 'The page', label: 'QR code for this page', keys: [] },
  { id: 'compact', group: 'Tabs and windows', label: 'Compact mode (hide the sidebar and top bar)', keys: ['Ctrl+Shift+L'] },
  { id: 'notes', group: 'Tabs and windows', label: 'Notes for this Space', keys: [] },
  { id: 'tidy', group: 'Tabs and windows', label: 'Tidy today’s tabs', keys: [] },
  { id: 'break', group: 'Tabs and windows', label: 'Take a break (15 minutes)', keys: [] },
  { id: 'find-tabs', group: 'Tabs and windows', label: 'Find text in all open tabs', keys: ['Ctrl+Shift+F'] },
  { id: 'task-manager', group: 'Tabs and windows', label: 'Task manager', keys: ['Shift+Esc'] },
  { id: 'lock-now', group: 'Tabs and windows', label: 'Lock Spaces now (Windows Hello)', keys: [] },
  { id: 'focus-cycle', group: 'Accessibility', label: 'Move focus: page › sidebar › top bar', keys: ['F6'] },
  { id: 'focus-back', group: 'Accessibility', label: 'Move focus the other way', keys: ['Shift+F6'] },
  { id: 'caret', group: 'Accessibility', label: 'Caret browsing (arrow keys move through the text)', keys: ['F7'] },
  { id: 'read-aloud', group: 'The page', label: 'Read the page aloud', keys: ['Ctrl+Shift+U'] },
  // Sound and video
  { id: 'mute', group: 'Sound and video', label: 'Mute / unmute tab', keys: [] },
  { id: 'play-pause', group: 'Sound and video', label: 'Play / pause what’s playing', keys: [] },
  { id: 'media-next', group: 'Sound and video', label: 'Next track', keys: [] },
  { id: 'speed-up', group: 'Sound and video', label: 'Video faster (1.25×, 1.5×, 2×…)', keys: [] },
  { id: 'speed-down', group: 'Sound and video', label: 'Video slower', keys: [] },
  { id: 'speed-normal', group: 'Sound and video', label: 'Video at normal speed', keys: [] },
  // Library
  { id: 'history', group: 'Library', label: 'History', keys: ['Ctrl+H'] },
  { id: 'downloads', group: 'Library', label: 'Downloads', keys: ['Ctrl+J'] },
  { id: 'passwords', group: 'Library', label: 'Passwords', keys: [] },
  { id: 'extensions', group: 'Library', label: 'Extensions', keys: [] },
  { id: 'sleep-others', group: 'Library', label: 'Put background tabs to sleep', keys: [] },
  { id: 'clear-data', group: 'Library', label: 'Clear browsing data', keys: ['Ctrl+Shift+Delete'] },
  { id: 'reopen-window', group: 'Tabs and windows', label: 'Reopen closed window', keys: [] },
];

const CODE_KEYS = {
  Equal: '=', Minus: '-', Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-', NumpadDivide: '/', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter',
  Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', Backspace: 'Backspace', Delete: 'Delete',
  Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Esc',
};

// A key name from Electron's input event or a DOM KeyboardEvent ({ key, code }).
function keyName(key, code) {
  key = String(key || ''); code = String(code || '');
  if (/^[a-z]$/i.test(key)) return key.toUpperCase();       // letters follow the keyboard layout
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^(Digit|Numpad)\d$/.test(code)) return code.slice(-1);
  if (/^F\d{1,2}$/.test(code)) return code;
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(key)) return '';
  return key.length === 1 ? key.toUpperCase() : key;
}

// Electron before-input-event input -> "Ctrl+Shift+T".
function comboOf(input) {
  const k = keyName(input.key, input.code);
  if (!k) return '';
  return [(input.control || input.meta) && 'Ctrl', input.alt && 'Alt', input.shift && 'Shift', k].filter(Boolean).join('+');
}

// Tidy a typed or recorded combination into the same form.
function normalizeCombo(s) {
  const parts = String(s || '').split('+').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return '';
  let key = parts.pop();
  const mods = new Set(parts.map(p => p.toLowerCase()));
  if (key === '') return '';
  if (/^[a-z]$/i.test(key)) key = key.toUpperCase();
  if (/^esc(ape)?$/i.test(key)) key = 'Esc';
  if (/^f\d{1,2}$/i.test(key)) key = key.toUpperCase();
  if (/^arrow/i.test(key)) key = key.slice(5);
  return [(mods.has('ctrl') || mods.has('control') || mods.has('cmd')) && 'Ctrl', mods.has('alt') && 'Alt', mods.has('shift') && 'Shift', key].filter(Boolean).join('+');
}

// Combinations Quasar won't take over (text editing and the fixed keys).
function reservedCombo(k) {
  if (/^(Ctrl\+)?(C|V|X|A|Z|Y)$/.test(k) && k.startsWith('Ctrl+')) return `${k} is used for copy, paste and editing text.`;
  if (/^Ctrl\+[1-9]$/.test(k)) return `${k} switches Spaces or tabs (Settings › General).`;
  if (k === 'Esc') return 'Esc is used to close things.';
  if (!/^(Ctrl|Alt)\+/.test(k) && !/^(Shift\+)?F\d{1,2}$/.test(k)) return 'Use Ctrl or Alt with the key (or an F-key), so typing on pages still works.';
  return null;
}

module.exports = { SHORTCUTS, comboOf, keyName, normalizeCombo, reservedCombo };
