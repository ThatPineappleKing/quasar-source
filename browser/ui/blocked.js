// Quasar's warning page: a site on a malware/phishing list, or a site that has no
// secure (HTTPS) version while Always-HTTPS is on. Buttons replace the #hash; the
// main process acts on it (and only for a page it actually blocked).
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const kind = q.get('kind') || 'phishing';
const host = q.get('host') || 'this site';

const TEXT = {
  phishing: {
    title: 'Deceptive site ahead',
    msg: `${host} is on a list of phishing sites. Attackers there may try to trick you into giving away passwords, card numbers or other personal information.`,
    why: 'Quasar checks every site you open against public lists of phishing sites (OpenPhish, Phishing Army), downloaded to this PC. The address you visit is never sent anywhere.',
    proceed: `I understand the risk — visit ${host}`,
  },
  malware: {
    title: 'Dangerous site ahead',
    msg: `${host} is on a list of sites that spread malware. It could try to install harmful programs that steal or delete your information.`,
    why: 'Quasar checks every site you open against the URLhaus list of malware sites (abuse.ch, via urlhaus-filter), downloaded to this PC. The address you visit is never sent anywhere.',
    proceed: `I understand the risk — visit ${host}`,
  },
  https: {
    title: 'This site doesn’t support a secure connection',
    msg: `Quasar tried to open ${host} over HTTPS, but it didn’t work. If you continue, the connection won’t be encrypted: anyone on your network could see or change what you send and receive.`,
    why: 'Always-HTTPS is on (Settings › Privacy and security). You can continue on an unencrypted connection to this site until Quasar closes.',
    proceed: `Continue to ${host} (not secure)`,
  },
};
const t = TEXT[kind] || TEXT.phishing;
document.body.classList.toggle('danger', kind !== 'https');
document.title = t.title;
$('title').textContent = t.title;
$('msg').textContent = t.msg;
$('extra').textContent = kind === 'https' ? '' : 'Quasar stopped the page from loading.';
$('why').textContent = t.why;
$('proceed').textContent = t.proceed;
$('details').addEventListener('click', () => {
  const open = $('more').hidden;
  $('more').hidden = !open;
  $('details').setAttribute('aria-expanded', String(open));
});
$('back').addEventListener('click', () => location.replace('#back'));
$('proceed').addEventListener('click', () => location.replace('#proceed'));
