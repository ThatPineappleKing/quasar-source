const $ = id => document.getElementById(id);
let sent = false;
const send = data => { if (sent) return; sent = true; window.archDialog.reply(data); };

window.archDialog.onInit(info => {
  $('sub').textContent = info.isProxy
    ? `The proxy ${info.host} requires a username and password.`
    : `${info.origin || info.host} requires a username and password.`;
  if (info.realm) { $('realm').textContent = `“${info.realm}”`; $('realm').hidden = false; }
  $('warn').hidden = !info.insecure;
  $('user').focus();
});

$('form').addEventListener('submit', e => {
  e.preventDefault();
  send({ username: $('user').value, password: $('pass').value });
});
$('cancel').addEventListener('click', () => send(null));
document.addEventListener('keydown', e => { if (e.key === 'Escape') send(null); });
