// Authenticator (two-factor) codes: RFC 6238 time-based one-time passwords, the
// 6-digit codes apps like Google Authenticator show. The secret is the text (or QR
// code) a site gives you when you turn on two-factor sign-in.
const crypto = require('crypto');

function base32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = String(s || '').toUpperCase().replace(/[\s=-]/g, '');
  if (!clean || /[^A-Z2-7]/.test(clean)) return null;
  let bits = 0, val = 0;
  const out = [];
  for (const c of clean) {
    val = (val << 5) | A.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

// "otpauth://totp/Site:me@x.com?secret=…&digits=6&period=30&algorithm=SHA1" or a bare secret.
function parse(text) {
  const t = String(text || '').trim();
  let o = { secret: t, digits: 6, period: 30, algorithm: 'SHA1' };
  if (/^otpauth:\/\//i.test(t)) {
    let u;
    try { u = new URL(t); } catch { return null; }
    if (u.hostname.toLowerCase() !== 'totp') return null;   // counter-based (hotp) codes aren't supported
    const q = u.searchParams;
    o = { secret: q.get('secret') || '', digits: Number(q.get('digits')) || 6, period: Number(q.get('period')) || 30,
      algorithm: (q.get('algorithm') || 'SHA1').toUpperCase(), issuer: q.get('issuer') || decodeURIComponent(u.pathname.slice(1)).split(':')[0] || '' };
  }
  o.secret = o.secret.toUpperCase().replace(/[\s=-]/g, '');
  if (!base32(o.secret) || base32(o.secret).length < 10) return null;
  if (![6, 7, 8].includes(o.digits)) o.digits = 6;
  if (!(o.period >= 10 && o.period <= 300)) o.period = 30;
  if (!['SHA1', 'SHA256', 'SHA512'].includes(o.algorithm)) o.algorithm = 'SHA1';
  return o;
}

function code(o, now = Date.now()) {
  const key = base32(o.secret);
  if (!key) return null;
  const counter = Math.floor(now / 1000 / o.period);
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = crypto.createHmac(o.algorithm.toLowerCase(), key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const bin = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(bin % 10 ** o.digits).padStart(o.digits, '0');
}

// Seconds until the code changes.
const left = (o, now = Date.now()) => o.period - Math.floor(now / 1000) % o.period;

function uri(o, label = '') {
  return `otpauth://totp/${encodeURIComponent(label || o.issuer || 'Quasar')}?secret=${o.secret}&digits=${o.digits}&period=${o.period}&algorithm=${o.algorithm}${o.issuer ? '&issuer=' + encodeURIComponent(o.issuer) : ''}`;
}

module.exports = { parse, code, left, uri, base32 };
