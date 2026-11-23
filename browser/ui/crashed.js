// Quasar's "This page crashed" page. Buttons tell the browser what to do by
// replacing the #hash (no new history entry); the main process listens for it.
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const host = q.get('host') || 'This page';
const reason = q.get('reason') || 'crashed';
const n = Number(q.get('n')) || 1;

const WHY = {
  oom: ['This page ran out of memory', `${host} used more memory than was available. Closing other tabs can help.`],
  killed: ['This page was stopped', `${host} stopped responding and was stopped.`],
  'launch-failed': ['This page couldn’t start', `Quasar couldn’t start the process for ${host}.`],
  'integrity-failure': ['This page couldn’t start', `Quasar couldn’t start the process for ${host} (a security check failed).`],
  'abnormal-exit': ['This page crashed', `Something went wrong while showing ${host}.`],
  crashed: ['This page crashed', `Something went wrong while showing ${host}.`],
};
const [title, msg] = WHY[reason] || WHY.crashed;
document.title = title;
$('title').textContent = title;
$('msg').textContent = msg + ' Your other tabs are fine.';
$('again').hidden = n < 2;
$('code').textContent = 'Reason: ' + reason;
$('reload').addEventListener('click', () => location.replace('#reload'));
$('close').addEventListener('click', () => location.replace('#close'));
document.addEventListener('keydown', e => { if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) { e.preventDefault(); location.replace('#reload'); } });
