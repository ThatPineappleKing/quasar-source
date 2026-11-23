// Picture-in-picture and the sidebar's now-playing controls.
// Part of the Shell class (src/shell.js): these methods are mixed into Shell.prototype,
// so `this` is the Shell and every other part's methods are available on it.
const { session, screen } = require('electron');
const { hostOf } = require('./common');

class MediaPart {
  // ---------------------------------------------------- picture-in-picture
  // Switching away from a tab with a playing video floats the video; coming back docks it.
  autoPip(tab, force = false) {
    if (this.st.settings.autoPip === false && !force) return;
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed() || this.isCertPage(wc.getURL())) return;
    const code = `(() => {
      if (document.pictureInPictureElement) return 'already';
      if (!document.pictureInPictureEnabled) return 'off';
      const vids = [...document.querySelectorAll('video')].filter(v => !v.paused && !v.ended && v.readyState > 2 && v.videoWidth > 0 && !v.disablePictureInPicture);
      if (!vids.length) return 'none';
      vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
      return vids[0].requestPictureInPicture().then(() => 'pip', e => 'err: ' + e.message);
    })()`;
    wc.executeJavaScriptInIsolatedWorld(1003, [{ code }], true).then(r => { if (r === 'pip' || r === 'already') tab.pip = true; tab.pipResult = r; }).catch(() => {});
  }

  endPip(tab) {
    tab.pip = false;
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.executeJavaScriptInIsolatedWorld(1003, [{ code: 'document.pictureInPictureElement ? document.exitPictureInPicture().then(() => "out") : "none"' }], true).catch(() => {});
  }

  // ------------------------------------------------- now playing (sidebar)
  onMedia(wc, s) {
    const tab = this.pageTabs.get(wc.id);
    if (!tab || !s || typeof s !== 'object') return;
    const str = (v, n) => String(v || '').slice(0, n);
    tab.media = { has: !!s.has, playing: !!s.playing, video: !!s.video, title: str(s.title, 200), artist: str(s.artist, 200),
      art: /^(https?|data):/.test(String(s.art || '')) ? str(s.art, 4096) : '', actions: str(s.actions, 200).split(',').filter(Boolean), at: Date.now() };
    this.push();
  }

  // The tab the sidebar's media card is about: something playing (or paused a moment
  // ago) that isn't on screen in this window. Private windows only see their own.
  mediaTab() {
    const W = this.cur;
    const onScreen = new Set(W?.attached || []);
    const mine = t => (W?.private ? t.spaceId === W.spaceId : !this.privateSpaces.has(t.spaceId));
    const cands = [...this.tabs.values()].filter(t => mine(t) && !onScreen.has(t.id) && t.view && !t.sleeping && !t.crashed &&
      (t.audible || t.media?.playing || (t.media?.has && Date.now() - (t.media.at || 0) < 30 * 60e3)));
    cands.sort((a, b) => ((b.audible || b.media?.playing) ? 1 : 0) - ((a.audible || a.media?.playing) ? 1 : 0) || (b.media?.at || 0) - (a.media?.at || 0));
    return cands[0] || null;
  }

  mediaViewModel() {
    const t = this.mediaTab();
    if (!t) return null;
    const m = t.media || {};
    const sp = this.spaceById(t.spaceId);
    return { tabId: t.id, title: m.title || t.title || hostOf(t.url), sub: m.artist || `${hostOf(t.url)}${sp && sp.id !== this.curSpaceId ? ' · ' + `${sp.emoji || ''} ${sp.name}`.trim() : ''}`,
      art: m.art || '', favicon: t.favicon, playing: !!(m.playing || (t.audible && !m.has)), muted: !!t.muted,
      canNext: (m.actions || []).includes('nexttrack') || /(^|\.)youtube\.com$/.test(hostOf(t.url)), canPrev: (m.actions || []).includes('previoustrack') || !!m.has };
  }

  // Play/pause, next or previous for the media card's tab (or a given one). Uses the
  // page's own media-session buttons when it has them, else the <video>/<audio> itself.
  async mediaAct(op, tabId = null) {
    const t = tabId ? this.tabs.get(tabId) : this.mediaTab() || this.active;
    const wc = t?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    if (op === 'mute') return this.toggleMute(t.id);
    if (op === 'show') return this.show(t.id);
    const code = `(() => {
      const h = (window.__archMedia && window.__archMedia.handlers) || {};
      const call = a => { if (typeof h[a] === 'function') { try { h[a]({ action: a }); return true; } catch (e) {} } return false; };
      const els = [...document.querySelectorAll('video, audio')];
      const playing = els.find(m => !m.paused && !m.ended);
      const op = ${JSON.stringify(op)};
      if (op === 'toggle') {
        if (playing) { if (call('pause')) return 'session'; playing.pause(); return 'paused'; }
        if (call('play')) return 'session';
        const m = els.find(x => x.currentTime > 0 && !x.ended) || els[0];
        if (m) { m.play(); return 'played'; }
        return 'none';
      }
      if (op === 'next') {
        if (call('nexttrack')) return 'session';
        const b = document.querySelector('.ytp-next-button'); if (b) { b.click(); return 'button'; }
        return 'none';
      }
      if (op === 'prev') {
        if (call('previoustrack')) return 'session';
        const m = playing || els[0]; if (m) { m.currentTime = 0; return 'restart'; }
        return 'none';
      }
      return 'none';
    })()`;
    try { return await wc.executeJavaScript(code, true); } catch { return 'error'; }
  }

  toggleMute(tabId = this.activeTabId) {
    const tab = this.tabs.get(tabId);
    const wc = tab?.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    tab.muted = !wc.isAudioMuted();
    wc.setAudioMuted(tab.muted);
    this.push();
  }
}

module.exports = MediaPart;
