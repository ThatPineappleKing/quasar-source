// Quasar's password vault.
// Stored in %APPDATA%\Quasar\passwords.bin, encrypted with Electron safeStorage,
// which on Windows uses DPAPI: only your Windows account on this PC can decrypt it.
// Passwords never go to Quasar's sidebar UI; web pages only receive a password when
// you pick an account in the autofill list, and only for the site it was saved for.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');

const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

// Treat https://www.example.com and https://example.com as the same site.
function siteKey(origin) {
  try {
    const u = new URL(origin);
    return `${u.protocol}//${u.hostname.replace(/^www\./, '')}${u.port ? ':' + u.port : ''}`;
  } catch { return null; }
}

function originOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(u.hostname))) return null;
    return u.origin;
  } catch { return null; }
}

// RFC 4180-style CSV parser (quoted fields, "" escapes, newlines in quotes).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

// A strong random password: 18 characters from letters, digits and symbols,
// at least one of each, without look-alikes (l/I/1, O/0).
function generatePassword(length = 18) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789', '-_!@#$%*+=?'];
  const all = sets.join('');
  const out = sets.map(s => s[crypto.randomInt(s.length)]);
  while (out.length < length) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

// 0 (very weak) … 4 (very strong), same idea as the meter shown on web pages.
const COMMON = new Set(('123456 123456789 12345678 password qwerty 123123 111111 1234567890 1234567 qwerty123 000000 abc123 password1 iloveyou ' +
  'admin welcome monkey dragon letmein football baseball sunshine princess login master hello freedom whatever trustno1 passw0rd').split(' '));
function strength(pw) {
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(Math.max(pool, 2));
  if (COMMON.has(pw.toLowerCase())) bits = 0;
  if (/(.)\1{2,}/.test(pw)) bits -= 15;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(pw)) bits -= 15;
  return bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
}

const ADDRESS_KEYS = ['label', 'name', 'org', 'street', 'line2', 'city', 'region', 'postal', 'country', 'phone', 'email'];

// Card numbers: the Luhn check digit catches typos, and the first digits tell the brand.
function luhn(n) {
  n = String(n || '').replace(/\D/g, '');
  if (n.length < 12 || n.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < n.length; i++) {
    let d = Number(n[n.length - 1 - i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}
function cardBrand(n) {
  n = String(n || '');
  if (/^4/.test(n)) return 'Visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(n)) return 'Mastercard';
  if (/^3[47]/.test(n)) return 'American Express';
  if (/^(6011|65|64[4-9])/.test(n)) return 'Discover';
  if (/^35(2[89]|[3-8])/.test(n)) return 'JCB';
  if (/^3(0[0-5]|[68])/.test(n)) return 'Diners Club';
  if (/^62/.test(n)) return 'UnionPay';
  if (/^(5018|5020|5038|6304|6759|676[1-3])/.test(n)) return 'Maestro';
  return 'Card';
}

class Vault {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'passwords.bin');
    this.data = { entries: [], never: [], addresses: [], cards: [] };
    this.load();
  }

  // ---- saved addresses (same encrypted file; kept per Space like passwords)
  addresses(profile) { return this.data.addresses.filter(a => !profile || a.profile === profile); }
  getAddress(id) { return this.data.addresses.find(a => a.id === id) || null; }
  saveAddress(profile, fields, id = null) {
    const clean = {};
    for (const k of ADDRESS_KEYS) clean[k] = String(fields?.[k] || '').trim().slice(0, 300);
    if (!clean.name && (fields?.given || fields?.family)) clean.name = [fields.given, fields.family].filter(Boolean).join(' ').trim();
    const hit = id ? this.getAddress(id) : null;
    if (hit) Object.assign(hit, clean, { updatedAt: Date.now() });
    else this.data.addresses.push({ id: uid(), profile, ...clean, createdAt: Date.now(), updatedAt: Date.now() });
    this.save();
    return hit?.id || this.data.addresses[this.data.addresses.length - 1].id;
  }
  removeAddress(id) { this.data.addresses = this.data.addresses.filter(a => a.id !== id); this.save(); }
  // Same street + postcode in this Space = the same address.
  findAddress(profile, f) {
    const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return this.data.addresses.find(a => a.profile === profile && norm(a.street) === norm(f.street) && norm(a.postal) === norm(f.postal)) || null;
  }

  // ---- payment cards (same encrypted file; per Profile). The security code (CVC) is never kept.
  cards(profile) { return this.data.cards.filter(c => !profile || c.profile === profile); }
  getCard(id) { return this.data.cards.find(c => c.id === id) || null; }
  saveCard(profile, f, id = null) {
    const number = String(f?.number || '').replace(/\D/g, '');
    if (!luhn(number)) throw new Error('That card number doesn’t look right.');
    const month = Math.max(0, Math.min(12, parseInt(f.month, 10) || 0));
    let year = parseInt(f.year, 10) || 0;
    if (year && year < 100) year += 2000;
    const clean = { number, name: String(f.name || '').trim().slice(0, 120), month, year, nickname: String(f.nickname || '').trim().slice(0, 60) };
    const hit = (id && this.getCard(id)) || this.data.cards.find(c => c.profile === profile && c.number === number);
    if (hit) Object.assign(hit, clean, { updatedAt: Date.now() });
    else this.data.cards.push({ id: uid(), profile, ...clean, createdAt: Date.now(), updatedAt: Date.now() });
    this.save();
    return (hit || this.data.cards[this.data.cards.length - 1]).id;
  }
  removeCard(id) { this.data.cards = this.data.cards.filter(c => c.id !== id); this.save(); }
  findCard(profile, number) { const n = String(number || '').replace(/\D/g, ''); return this.data.cards.find(c => c.profile === profile && c.number === n) || null; }
  // What can be shown without unlocking: brand, last four digits, expiry, name.
  cardSummary(c) { return { id: c.id, profile: c.profile, brand: cardBrand(c.number), last4: c.number.slice(-4), month: c.month, year: c.year, name: c.name, nickname: c.nickname }; }

  // Password checkup: which saved passwords are weak or used on more than one site.
  // (one profile's passwords, compared only with each other)
  checkup(profile = null) {
    const list = this.data.entries.filter(e => !profile || e.profile === profile);
    const byPw = new Map();
    for (const e of list) { const k = e.password; byPw.set(k, (byPw.get(k) || new Set()).add(siteKey(e.origin))); }
    const out = {};
    for (const e of list) out[e.id] = { weak: strength(e.password) <= 1, reused: (byPw.get(e.password)?.size || 1) - 1 };
    return out;
  }

  get available() { return safeStorage.isEncryptionAvailable(); }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      this.data = JSON.parse(safeStorage.decryptString(fs.readFileSync(this.file)));
      this.data.entries ||= []; this.data.never ||= []; this.data.addresses ||= []; this.data.cards ||= [];
    } catch {
      // Can't decrypt (e.g. copied from another PC/user). Keep the file, start fresh.
      fs.renameSync(this.file, this.file.replace(/\.bin$/, `.unreadable-${Date.now()}.bin`));
      this.data = { entries: [], never: [], addresses: [], cards: [] };
    }
  }

  save() {
    if (!this.available) throw new Error('Windows encryption is not available, so passwords cannot be saved.');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', safeStorage.encryptString(JSON.stringify(this.data)));
    fs.renameSync(this.file + '.tmp', this.file);
  }

  forSite(profile, origin) {
    const k = siteKey(origin);
    return this.data.entries.filter(e => e.profile === profile && siteKey(e.origin) === k);
  }

  get(id) { return this.data.entries.find(e => e.id === id) || null; }

  // Summary without passwords, for lists.
  summaries() {
    return this.data.entries.map(({ password, otp, ...rest }) => ({ ...rest, hasOtp: !!otp }))
      .sort((a, b) => a.origin.localeCompare(b.origin) || a.username.localeCompare(b.username));
  }

  upsert({ profile, origin, username, password }) {
    const k = siteKey(origin);
    const now = Date.now();
    const hit = this.data.entries.find(e => e.profile === profile && siteKey(e.origin) === k && e.username === username);
    if (hit) {
      if (hit.password === password) return 'unchanged';
      hit.password = password; hit.updatedAt = now;
      this.save();
      return 'updated';
    }
    this.data.entries.push({ id: uid(), profile, origin, username, password, createdAt: now, updatedAt: now });
    this.save();
    return 'added';
  }

  remove(id) {
    this.data.entries = this.data.entries.filter(e => e.id !== id);
    this.save();
  }

  // Authenticator secret for a login (text from the site, or an otpauth:// link). '' removes it.
  setOtp(id, text) {
    const e = this.get(id);
    if (!e) throw new Error('That login is gone.');
    if (!String(text || '').trim()) { delete e.otp; this.save(); return null; }
    const o = require('./totp').parse(text);
    if (!o) throw new Error('That doesn’t look like an authenticator key. Copy the “setup key” (letters A–Z and 2–7) the site shows next to its QR code, or an otpauth:// link.');
    e.otp = { secret: o.secret, digits: o.digits, period: o.period, algorithm: o.algorithm };
    e.updatedAt = Date.now();
    this.save();
    return e.otp;
  }

  otpCode(id) {
    const e = this.get(id);
    if (!e?.otp) return null;
    const t = require('./totp');
    return { code: t.code(e.otp), left: t.left(e.otp) };
  }

  isNever(profile, origin) {
    const k = siteKey(origin);
    return this.data.never.some(n => n.profile === profile && n.site === k);
  }

  addNever(profile, origin) {
    if (!this.isNever(profile, origin)) { this.data.never.push({ profile, site: siteKey(origin) }); this.save(); }
  }

  removeNever(profile, site) {
    this.data.never = this.data.never.filter(n => !(n.profile === profile && n.site === site));
    this.save();
  }

  // Chrome/Arc export format: name,url,username,password,note
  importCsv(text, profile) {
    const rows = parseCsv(text);
    if (!rows.length) return { added: 0, updated: 0, skipped: 0 };
    const head = rows[0].map(h => h.trim().toLowerCase());
    const col = n => head.indexOf(n);
    // Chrome/Edge/Brave/Opera: name,url,username,password,note · Firefox: url,username,password,…
    // Bitwarden: login_uri,login_username,login_password,login_totp · 1Password: url,username,password,otpauth
    const pick = (...names) => names.map(col).find(i => i >= 0) ?? -1;
    const iu = pick('url', 'login_uri', 'website', 'web site'), iun = pick('username', 'login_username', 'user name', 'login'), ip = pick('password', 'login_password');
    const iotp = pick('totp', 'otpauth', 'login_totp', 'one-time password'), inote = pick('note', 'notes');
    if (iu < 0 || ip < 0) throw new Error('This doesn’t look like a browser password export (no "url" and "password" columns).');
    const totp = require('./totp');
    const otpOf = r => { const raw = (iotp >= 0 && r[iotp]) || (inote >= 0 && /^otpauth:\/\//i.test(r[inote] || '') ? r[inote] : ''); const o = raw ? totp.parse(raw) : null; return o ? { secret: o.secret, digits: o.digits, period: o.period, algorithm: o.algorithm } : null; };
    let added = 0, updated = 0, skipped = 0;
    const now = Date.now();
    for (const r of rows.slice(1)) {
      const origin = originOf(r[iu] || '');
      const password = r[ip] || '';
      const username = iun >= 0 ? (r[iun] || '') : '';
      if (!origin || !password) { skipped++; continue; }
      const k = siteKey(origin);
      const hit = this.data.entries.find(e => e.profile === profile && siteKey(e.origin) === k && e.username === username);
      const otp = otpOf(r);
      if (hit) {
        const newOtp = otp && JSON.stringify(otp) !== JSON.stringify(hit.otp);
        if (hit.password !== password || newOtp) { hit.password = password; if (otp) hit.otp = otp; hit.updatedAt = now; updated++; } else skipped++;
      } else { this.data.entries.push({ id: uid(), profile, origin, username, password, ...(otp ? { otp } : {}), createdAt: now, updatedAt: now }); added++; }
    }
    this.save();
    return { added, updated, skipped };
  }
}

module.exports = { Vault, originOf, siteKey, parseCsv, generatePassword, strength, luhn, cardBrand };
