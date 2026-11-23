// Quasar's "Can't reach this page" page, shown when a page fails to load
// (no internet, site down, address not found...). Buttons tell the browser
// what to do by replacing the #hash; the main process listens for it.
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const host = q.get('host') || 'this site';
const error = q.get('error') || '';
const code = Number(q.get('code')) || 0;

// Net error codes: https://source.chromium.org/chromium/chromium/src/+/main:net/base/net_error_list.h
const offline = code === -106 || !navigator.onLine;
const KIND = {
  '-105': ['This site can’t be found', `Quasar couldn’t find the address for ${host}.`, ['Check the address for typos', 'Check your internet connection']],
  '-137': ['This site can’t be found', `Quasar couldn’t find the address for ${host}.`, ['Check the address for typos', 'Check your internet connection']],
  '-102': ['This site can’t be reached', `${host} refused to connect.`, ['The site may be down — try again in a little while']],
  '-118': ['This site can’t be reached', `${host} took too long to respond.`, ['Check your internet connection', 'The site may be busy — try again']],
  '-7': ['This site can’t be reached', `${host} took too long to respond.`, ['Check your internet connection', 'The site may be busy — try again']],
};
// arch://drift opens this page straight into the game, with no error to show.
const driftOnly = q.get('game') === '1';
const [title, msg, tips] = driftOnly
  ? ['Space Drift', 'Quasar’s offline game — play it any time at arch://drift.', []]
  : offline
  ?['You’re offline', `Quasar can’t load ${host} because there’s no internet connection.`, ['Check your Wi-Fi or network cable', 'Turn off airplane mode']]
  : KIND[String(code)] || ['This site can’t be reached', `Something went wrong while loading ${host}.`, ['Check your internet connection', 'Try again in a little while']];

document.title = title;
$('title').textContent = title;
$('msg').textContent = msg;
for (const t of tips) { const li = document.createElement('li'); li.textContent = t; $('tips').append(li); }
$('code').textContent = driftOnly ? '' : error ? error.replace(/^net::/, '') : (code ? `Error ${code}` : '');
if (driftOnly) {
  $('retry').parentElement.hidden = true;        // no Try again / Go back: nothing failed
  $('icon').setAttribute('hidden', '');          // an <svg> has no .hidden property
  $('tips').hidden = true;
  $('play-label').textContent = 'Play Space Drift';
}

$('retry').addEventListener('click', () => location.replace('#retry'));
$('back').addEventListener('click', () => location.replace('#back'));
// ------------------------------------------------------------ Space Drift
const showBest = b => { $('best').textContent = b > 0 ? `Best: ${b.toLocaleString('en-US')} ms` : ''; };
showBest(SpaceDrift.bestScore());
let game = null;
const playing = () => !$('game').hidden;

function openGame() {
  $('game').hidden = false;
  document.activeElement?.blur();                 // so Space doesn't press a button behind the game
  game ||= new SpaceDrift($('game-canvas'), { onBest: showBest, onMode: showMode });
  showMode(game.mode);
  game.start();
}
function showMode(mode) {
  $('mode-classic').setAttribute('aria-pressed', String(mode === 'classic'));
  $('mode-zen').setAttribute('aria-pressed', String(mode === 'zen'));
}
// Switching mode mid-run pauses first, then starts the other mode fresh.
function switchMode(mode) {
  if (!game) return;
  mode ||= game.mode === 'zen' ? 'classic' : 'zen';
  if (game.state === 'play') game.togglePause();
  game.setMode(mode);
  document.activeElement?.blur();                 // so Space flies instead of pressing the button
}
$('mode-classic').addEventListener('click', () => switchMode('classic'));
$('mode-zen').addEventListener('click', () => switchMode('zen'));
function closeGame() {
  game?.stop();
  $('game').hidden = true;
  $('play').focus();
}

$('play').addEventListener('click', openGame);
$('game-close').addEventListener('click', closeGame);
$('signal-go').addEventListener('click', () => location.replace('#retry'));

const FLY = new Set([' ', 'ArrowUp', 'w', 'W']);
document.addEventListener('keydown', e => {
  if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); return location.replace('#retry'); }
  if (!playing()) return;
  if (e.key === 'Escape') { e.preventDefault(); return closeGame(); }
  if (e.key === 'p' || e.key === 'P') { e.preventDefault(); return game.togglePause(); }
  if ((e.key === 'z' || e.key === 'Z') && !e.ctrlKey && !e.repeat) { e.preventDefault(); return switchMode(); }
  if (FLY.has(e.key)) { e.preventDefault(); if (!e.repeat) game.press(); }
});
document.addEventListener('keyup', e => { if (playing() && FLY.has(e.key)) { e.preventDefault(); game.release(); } });
$('game-canvas').addEventListener('pointerdown', e => { e.preventDefault(); game.press(); });
addEventListener('pointerup', () => game?.release());
addEventListener('pointercancel', () => game?.release());
addEventListener('blur', () => { if (playing()) { game.release(); if (game.state === 'play') game.togglePause(); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing() && game.state === 'play') game.togglePause(); });

if (driftOnly) openGame();

// Connection is back: reload the page on its own, unless a game is going —
// then say so and let the player finish their run. (arch://drift has no page to go back to.)
window.addEventListener('online', () => {
  if (driftOnly) return;
  if (playing()) $('signal').hidden = false;
  else location.replace('#retry');
});
