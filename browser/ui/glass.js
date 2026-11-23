// Glass blur backdrop page (ui/glass.html). Main says which screen to capture; Quasar's
// own windows and this one are left out of the capture, so it shows only what's behind.
(() => {
  const v = document.getElementById('v');
  let stream = null, cur = null;
  const stop = () => {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null; v.srcObject = null; v.hidden = true;
  };
  window.arch.on('ui:glass', async g => {
    if (g?.blur) document.documentElement.style.setProperty('--blur', g.blur + 'px');
    if (!g?.on || !g.id) { cur = null; return stop(); }
    if (cur === g.id && stream) return;
    stop();
    cur = g.id;
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: {
        chromeMediaSource: 'desktop', chromeMediaSourceId: g.id, maxWidth: 1280, maxHeight: 800, maxFrameRate: 60 } } });
      if (cur !== g.id) { for (const t of s.getTracks()) t.stop(); return; }
      stream = s; v.srcObject = s; v.hidden = false; v.play().catch(() => {});
    } catch { /* capture refused: the glass stays clear */ }
  });
  // Hidden (Quasar minimised): no need to capture.
  document.addEventListener('visibilitychange', () => { if (stream) for (const t of stream.getVideoTracks()) t.enabled = !document.hidden; });
})();
