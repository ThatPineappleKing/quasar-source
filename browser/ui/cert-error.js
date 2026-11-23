// Quasar's certificate warning page. Buttons tell the browser what to do by
// replacing the #hash (no new history entry); the main process listens for it.
const $ = id => document.getElementById(id);
const q = new URLSearchParams(location.search);
const host = q.get('host') || 'this site';
const error = (q.get('error') || 'ERR_CERT_INVALID').toUpperCase();
const canProceed = q.get('p') === '1';

const WHY = {
  ERR_CERT_AUTHORITY_INVALID: 'its security certificate isn’t trusted by your computer. This may be caused by a misconfiguration or an attacker intercepting your connection.',
  ERR_CERT_COMMON_NAME_INVALID: 'its security certificate is for a different site. This may be caused by a misconfiguration or an attacker intercepting your connection.',
  ERR_CERT_DATE_INVALID: 'its security certificate has expired or isn’t valid yet. Check that your computer’s clock is right.',
  ERR_CERT_REVOKED: 'its security certificate has been revoked by the organization that issued it.',
  ERR_CERT_WEAK_SIGNATURE_ALGORITHM: 'its security certificate is signed with a weak algorithm.',
  ERR_CERT_WEAK_KEY: 'its security certificate uses a weak key.',
  ERR_CERT_SYMANTEC_LEGACY: 'its security certificate comes from an authority that’s no longer trusted.',
};

document.title = 'Privacy error';
$('host').textContent = host;
$('code').textContent = 'NET::' + error;
$('why').textContent = `This server couldn’t prove that it’s ${host}; ${WHY[error] || 'its security certificate has a problem.'}`;
$('proceed').textContent = `Proceed to ${host} (unsafe)`;
$('proceedRow').hidden = !canProceed;
$('noProceed').hidden = canProceed;

$('advanced').addEventListener('click', () => {
  const open = $('more').hidden;
  $('more').hidden = !open;
  $('advanced').setAttribute('aria-expanded', String(open));
  $('advanced').textContent = open ? 'Hide advanced' : 'Advanced';
});
$('back').addEventListener('click', () => location.replace('#back'));
$('proceed').addEventListener('click', () => location.replace('#proceed'));
