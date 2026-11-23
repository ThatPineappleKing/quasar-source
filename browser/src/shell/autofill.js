// Saved passwords, addresses and cards: autofill in pages and the Passwords window.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { clipboard, dialog, shell: eShell } = require('electron');
const { originOf, siteKey, generatePassword } = require('../passwords');
const { uid, hostOf } = require('./common');

class AutofillPart {
  // ---------------------------------------------------------- passwords
  registerPage(wc, tab) {
    this.pageTabs.set(wc.id, tab);
    this.webrtcPolicy(wc);
    wc.once('destroyed', () => { if (this.pageTabs.get(wc.id) === tab) this.pageTabs.delete(wc.id); });
  }

  // Who is asking? Use the real frame URL from Electron, never what the page says.
  pwSender(e) {
    const tab = this.pageTabs.get(e.sender.id);
    if (!tab || !e.senderFrame || e.senderFrame !== e.sender.mainFrame) return null;
    const origin = originOf(e.senderFrame.url);
    if (!origin) return null;
    return { origin, profile: tab.profile || 'Default' };
  }

  pwInvoke(e, op, arg) {
    const s = this.pwSender(e);
    if (!s) return null;
    if (op === 'list') return this.vault.forSite(s.profile, s.origin).map(x => ({ id: x.id, username: x.username }));
    if (op === 'fill') {
      const x = this.vault.get(arg);
      if (!x || x.profile !== s.profile || siteKey(x.origin) !== siteKey(s.origin)) return null;
      return { username: x.username, password: x.password };
    }
    if (op === 'generate') return generatePassword();
    // Saved addresses of this Space: a short list first; the details only for the one picked.
    if (op === 'addr:list') {
      return this.vault.addresses(s.profile).map(a => ({ id: a.id, label: a.label, name: a.name,
        line: [a.street, a.city, a.postal].filter(Boolean).join(', ') }));
    }
    if (op === 'addr:fill') {
      const a = this.vault.getAddress(arg);
      if (!a || a.profile !== s.profile) return null;
      const { id, profile, createdAt, updatedAt, label, ...fields } = a;
      return fields;
    }
    // Payment cards: the list shows only brand and last four digits; the full number
    // goes to the page only after Windows Hello (PIN / fingerprint / face).
    if (op === 'card:list') {
      if (!/^https:/i.test(s.origin) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/i.test(s.origin)) return [];   // never on insecure pages
      return this.vault.cards(s.profile).map(c => this.vault.cardSummary(c));
    }
    if (op === 'card:fill') return this.cardFill(s, arg);
    if (op === 'otp:list' || op === 'otp:fill') return this.otpInvoke(s, op, arg);
    return null;
  }

  async cardFill(s, id) {
    const c = this.vault.getCard(id);
    if (!c || c.profile !== s.profile) return null;
    if (!(await this.verifyUser(`Quasar wants to fill your card ending in ${c.number.slice(-4)} on ${hostOf(s.origin)}.`))) return null;
    return { number: c.number, name: c.name, month: c.month, year: c.year };
  }

  // A page submitted a card form: offer to save the card (never its security code).
  cardCandidate(e, data) {
    const s = this.pwSender(e);
    if (!s || !data || typeof data !== 'object' || this.privateSpaces.has(this.pageTabs.get(e.sender.id)?.spaceId)) return;
    const { luhn } = require('../passwords');
    const number = String(data.number || '').replace(/\D/g, '');
    if (!luhn(number) || !this.vault.available || this.vault.findCard(s.profile, number)) return;
    const id = uid();
    this.pendingCards ||= new Map();
    this.pendingCards.set(id, { profile: s.profile, fields: { number, name: String(data.name || '').slice(0, 120), month: data.month, year: data.year } });
    setTimeout(() => this.pendingCards?.delete(id), 3 * 60 * 1000);
    this.toast(`Save this card for autofill? •••• ${number.slice(-4)} (the security code is never saved)`, null,
      [{ label: 'Save card', act: ['card:save', id] }, { label: 'Not now', act: ['card:skip', id] }]);
  }

  cardSavePending(id) {
    const p = this.pendingCards?.get(id);
    if (!p) return;
    this.pendingCards.delete(id);
    try { this.vault.saveCard(p.profile, p.fields); this.toast('Card saved. Manage cards in Settings › Saved passwords.'); }
    catch (err) { this.toast(err.message); }
  }

  // A page submitted an address form: offer to save it (unless it's saved already).
  addrCandidate(e, data) {
    const s = this.pwSender(e);
    if (!s || !data || typeof data !== 'object') return;
    const f = {};
    for (const k of ['name', 'given', 'family', 'org', 'street', 'line2', 'city', 'region', 'postal', 'country', 'phone', 'email']) {
      if (typeof data[k] === 'string' && data[k].trim()) f[k] = data[k].trim().slice(0, 300);
    }
    if (Object.keys(f).length < 3 || !(f.street || f.postal)) return;
    if (!this.vault.available || this.vault.findAddress(s.profile, f)) return;
    const id = uid();
    this.pendingAddrs ||= new Map();
    this.pendingAddrs.set(id, { profile: s.profile, fields: f });
    setTimeout(() => this.pendingAddrs.delete(id), 3 * 60 * 1000);
    const line = [f.street, f.city, f.postal].filter(Boolean).join(', ');
    this.toast(`Save this address for autofill? ${line}`, null, [{ label: 'Save', act: ['addr:save', id] }, { label: 'Not now', act: ['addr:skip', id] }]);
  }

  addrSavePending(id) {
    const p = this.pendingAddrs?.get(id);
    if (!p) return;
    this.pendingAddrs.delete(id);
    try { this.vault.saveAddress(p.profile, p.fields); this.toast('Address saved. Manage addresses in Settings › Saved passwords.'); }
    catch (err) { this.toast(err.message); }
  }

  pwCandidate(e, data) {
    const s = this.pwSender(e);
    const username = typeof data?.username === 'string' ? data.username.slice(0, 256) : '';
    const password = typeof data?.password === 'string' ? data.password : '';
    if (!s || !password || password.length > 512 || this.vault.isNever(s.profile, s.origin)) return;
    const same = this.vault.forSite(s.profile, s.origin).find(x => x.username === username);
    if (same && same.password === password) return;
    const id = uid();
    this.pendingSaves.set(id, { ...s, username, password });
    setTimeout(() => this.pendingSaves.delete(id), 3 * 60 * 1000);
    const site = hostOf(s.origin);
    this.toast(same ? `Update saved password for ${username} on ${site}?` : `Save password${username ? ` for ${username}` : ''} on ${site}?`, null,
      [{ label: same ? 'Update' : 'Save', act: ['pw:save', id] }, { label: 'Never', act: ['pw:never', id] }]);
  }

  pwSavePending(id, never = false) {
    const p = this.pendingSaves.get(id);
    if (!p) return;
    this.pendingSaves.delete(id);
    try {
      if (never) { this.vault.addNever(p.profile, p.origin); this.toast(`Quasar won't offer to save passwords on ${hostOf(p.origin)}`); }
      else { this.vault.upsert(p); this.toast(`Password saved for ${hostOf(p.origin)}`); }
    } catch (err) { this.toast(err.message); }
  }

  // Windows Hello (PIN / fingerprint / face) before showing or copying passwords.
  async verifyUser(reason = 'Quasar wants to show your saved passwords.') {
    if (Date.now() < this.verifiedUntil) return true;
    if (process.env.ARCH_USER_DATA && typeof global.__archVerify === 'function') return !!(await global.__archVerify(reason));   // tests only
    const ask = String(reason).replace(/'/g, '’').slice(0, 200);
    const script = [
      'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
      "$g = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
      'function Await($op, $t) { $task = $g.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }',
      '[Windows.Security.Credentials.UI.UserConsentVerifier, Windows.Security.Credentials.UI, ContentType=WindowsRuntime] | Out-Null',
      '$a = Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability])',
      "if ($a -ne 'Available') { Write-Output \"Unavailable:$a\"; exit }",
      `Write-Output (Await ([Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${ask}')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult]))`,
    ].join('; ');
    const out = await new Promise(res => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: true, timeout: 120000 }, (err, stdout) => res(String(stdout || '').trim())));
    let ok = out === 'Verified';
    if (!ok && (out.startsWith('Unavailable') || !out)) {
      const { response } = await dialog.showMessageBox(this.win, {
        type: 'warning', buttons: ['Continue', 'Cancel'], defaultId: 1, cancelId: 1,
        message: 'Windows Hello isn’t set up on this PC.',
        detail: `${reason}\n\nArch normally asks for your Windows PIN or fingerprint first. Set up Windows Hello in Settings › Accounts › Sign-in options for that extra protection.`,
      });
      ok = response === 0;
    }
    if (ok) this.verifiedUntil = Date.now() + 5 * 60 * 1000;
    return ok;
  }

  // Passwords open inside the main window's page area, like the Library.
  openPasswords() {
    if (this.pwWin && !this.pwWin.isDestroyed() && this.pwWin.W === this.cur) { this.pwWin.focus(); return; }
    if (this.pwWin) this.pwWin.close();
    this.pwWin = this.openInApp('passwords', 'passwords.html');
  }

  async pwAct(name, args) {
    const v = this.vault;
    switch (name) {
      case 'pwm:close': return this.closeInApp(this.pwWin?.W);
      case 'pwm:list': {
        // Passwords belong to a Profile (its partition), shared by that Profile's Spaces.
        const spaces = this.st.profiles.filter(p => this.spacesOnProfile(p.id).length).map(p => {
          const on = this.spacesOnProfile(p.id).map(s => `${s.emoji || ''} ${s.name}`.trim());
          return { key: p.partition, name: on.length === 1 && on[0].endsWith(p.name) ? on[0] : `${p.name} (${on.join(', ')})` };
        });
        // Checkup flags (weak / used on other sites) without sending any password to this window.
        const check = v.checkup();
        const entries = v.summaries().map(e => ({ ...e, weak: !!check[e.id]?.weak, reused: check[e.id]?.reused || 0, breached: this.breaches?.counts?.[e.id] || 0 }));
        return { entries, never: v.data.never, spaces, current: this.space.partition, space: { colors: this.space.colors, grain: this.space.grain },
          verified: Date.now() < this.verifiedUntil, available: v.available, addresses: v.addresses(), cards: v.cards().map(c => v.cardSummary(c)) };
      }
      case 'pwm:saveCard': {
        const c = args[0] || {};
        const profile = this.st.spaces.some(s => s.partition === c.profile) ? c.profile : this.space.partition;
        const existing = typeof c.id === 'string' && c.id ? v.getCard(c.id) : null;
        // Editing a card without retyping its number keeps the saved number.
        const number = String(c.number || '').replace(/\D/g, '') || existing?.number || '';
        try { return { id: v.saveCard(profile, { ...c, number }, existing?.id || null) }; } catch (err) { return { error: err.message }; }
      }
      case 'pwm:deleteCard': {
        const c = v.getCard(String(args[0] || ''));
        if (!c) return false;
        const { response } = await dialog.showMessageBox(this.win, { type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true,
          message: `Delete the saved card ending in ${c.number.slice(-4)}?` });
        if (response !== 0) return false;
        v.removeCard(c.id);
        return true;
      }
      case 'pwm:revealCard': {
        const c = v.getCard(String(args[0] || ''));
        if (!c || !(await this.verifyUser(`Quasar wants to show your card ending in ${c.number.slice(-4)}.`))) return null;
        return c.number.replace(/(\d{4})(?=\d)/g, '$1 ');
      }
      case 'pwm:saveAddress': {
        const a = args[0] || {};
        const profile = this.st.spaces.some(s => s.partition === a.profile) ? a.profile : this.space.partition;
        return v.saveAddress(profile, a, typeof a.id === 'string' && a.id ? a.id : null);
      }
      case 'pwm:deleteAddress': v.removeAddress(String(args[0] || '')); return true;
      case 'pwm:reveal': {
        if (!(await this.verifyUser())) return null;
        return v.get(args[0])?.password ?? null;
      }
      case 'pwm:copy': {
        if (!(await this.verifyUser())) return false;
        const pw = v.get(args[0])?.password;
        if (!pw) return false;
        clipboard.writeText(pw);
        // Don't leave it on the clipboard. (readText is a promise in newer Electron.)
        setTimeout(() => { Promise.resolve(clipboard.readText()).then(t => { if (t === pw) clipboard.clear(); }).catch(() => {}); }, 30000);
        return true;
      }
      case 'pwm:copyUser': { const e = v.get(args[0]); if (e) clipboard.writeText(e.username); return true; }
      case 'pwm:delete': {
        const e = v.get(args[0]);
        if (!e) return false;
        const { response } = await dialog.showMessageBox(this.win, {
          type: 'warning', buttons: ['Delete', 'Cancel'], defaultId: 1, cancelId: 1,
          message: `Delete the saved password for ${e.username || '(no username)'} on ${hostOf(e.origin)}?`,
        });
        if (response !== 0) return false;
        v.remove(e.id);
        return true;
      }
      case 'pwm:removeNever': v.removeNever(args[0], args[1]); return true;
      case 'pwm:import': return this.importPasswordCsv(String(args[0] || this.space.partition));
      case 'pwm:export': return this.exportPasswords();
      case 'pwm:breach': return this.breachCheck();
      case 'pwm:otpSet': try { v.setOtp(String(args[0] || ''), String(args[1] || '')); return { ok: true }; } catch (err) { return { error: err.message }; }
      case 'pwm:otpCode': {
        if (!(await this.verifyUser('Quasar wants to show an authenticator code.'))) return null;
        return v.otpCode(String(args[0] || ''));
      }
      case 'pwm:otpCopy': {
        if (!(await this.verifyUser('Quasar wants to copy an authenticator code.'))) return false;
        const c = v.otpCode(String(args[0] || ''));
        if (!c) return false;
        clipboard.writeText(c.code);
        setTimeout(() => { Promise.resolve(clipboard.readText()).then(t => { if (t === c.code) clipboard.clear(); }).catch(() => {}); }, 60000);
        return true;
      }
    }
  }

  async importPasswordCsv(partition) {
    const sp = this.st.spaces.find(s => s.partition === partition);
    if (!sp) return null;
    const label = `${sp.emoji || ''} ${sp.name}`.trim();
    const r = await dialog.showOpenDialog(this.win, {
      title: `Import passwords into the “${sp.name}” Space`,
      filters: [{ name: 'Password export (CSV)', extensions: ['csv'] }], properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    let res;
    try { res = this.vault.importCsv(fs.readFileSync(file, 'utf8'), partition); } catch (err) {
      await dialog.showMessageBox(this.win, { type: 'error', message: 'Couldn’t import that file.', detail: err.message });
      return null;
    }
    const { response } = await dialog.showMessageBox(this.win, {
      type: 'info', buttons: ['Move file to Recycle Bin', 'Keep file'], defaultId: 0, cancelId: 1,
      message: `Imported into ${label}: ${res.added} new, ${res.updated} updated, ${res.skipped} skipped.`,
      detail: `${path.basename(file)} holds your passwords as plain text. It's safest to delete it now (then empty the Recycle Bin).`,
    });
    if (response === 0) { try { await eShell.trashItem(file); } catch { /* ignore */ } }
    return res;
  }
}

module.exports = AutofillPart;
