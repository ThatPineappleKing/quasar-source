// Quasar reader mode. The main process passes the article (from Mozilla Readability)
// to window.archReaderShow(); buttons that need the browser replace the #hash.
(() => {
  const $ = id => document.getElementById(id);
  let prefs = { size: 20, font: 'serif', theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light', width: 680 };
  try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('archReader') || '{}') }; } catch { /* defaults */ }
  const save = () => { try { localStorage.setItem('archReader', JSON.stringify(prefs)); } catch { /* ignore */ } };
  function apply() {
    document.body.className = `t-${prefs.theme} f-${prefs.font}`;
    document.documentElement.style.setProperty('--size', prefs.size + 'px');
    document.documentElement.style.setProperty('--width', prefs.width + 'px');
    document.querySelectorAll('[data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === prefs.theme));
  }
  apply();

  // Only harmless markup from the article: no scripts, frames, forms, styles or event handlers.
  const DROP = 'script,style,link,meta,iframe,frame,frameset,object,embed,form,input,button,select,textarea,noscript,template,base';
  const KEEP_ATTR = new Set(['href', 'src', 'srcset', 'alt', 'title', 'colspan', 'rowspan', 'width', 'height', 'datetime', 'cite', 'lang', 'dir', 'sizes', 'poster', 'controls', 'start', 'type']);
  function clean(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll(DROP).forEach(n => n.remove());
    for (const el of tpl.content.querySelectorAll('*')) {
      for (const a of [...el.attributes]) {
        const v = a.value.trim().toLowerCase();
        if (!KEEP_ATTR.has(a.name) || ((a.name === 'href' || a.name === 'src') && /^(javascript|vbscript|data:text)/.test(v))) el.removeAttribute(a.name);
      }
      if (el.tagName === 'A') el.setAttribute('rel', 'noopener');
      if (el.tagName === 'IMG') el.setAttribute('loading', 'lazy');
    }
    return tpl.content;
  }

  let art = null;
  window.archReaderShow = data => {
    art = data;
    document.title = data.title || 'Reader';
    $('site').textContent = data.siteName || data.host || '';
    $('title').textContent = data.title || '';
    const mins = Math.max(1, Math.round((data.length || 0) / 1200));
    $('meta').textContent = [data.byline, data.published ? new Date(data.published).toLocaleDateString() : '', `${mins} min read`].filter(Boolean).join(' · ');
    $('article').replaceChildren(clean(data.content || ''));
    if (data.lang) document.documentElement.lang = data.lang;
    if (data.dir) $('page').dir = data.dir;
    $('orig').href = data.url;
  };

  $('exit').onclick = () => location.replace('#exit');
  $('orig').onclick = e => { e.preventDefault(); location.replace('#exit'); };
  $('translate').onclick = () => location.replace('#translate');
  $('smaller').onclick = () => { prefs.size = Math.max(14, prefs.size - 2); apply(); save(); };
  $('bigger').onclick = () => { prefs.size = Math.min(32, prefs.size + 2); apply(); save(); };
  $('font').onclick = () => { prefs.font = prefs.font === 'serif' ? 'sans' : 'serif'; apply(); save(); };
  $('width').onclick = () => { prefs.width = prefs.width >= 860 ? 560 : prefs.width + 150; apply(); save(); };
  document.querySelectorAll('[data-theme]').forEach(b => { b.onclick = () => { prefs.theme = b.dataset.theme; apply(); save(); }; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') location.replace('#exit'); });

  // Read aloud with Windows' built-in voices (speechSynthesis), paragraph by paragraph.
  let speaking = false;
  function stopSpeaking() {
    speaking = false;
    speechSynthesis.cancel();
    document.querySelectorAll('.speaking').forEach(n => n.classList.remove('speaking'));
    $('listen').textContent = 'Listen';
    $('listen').classList.remove('on');
  }
  $('listen').onclick = () => {
    if (speaking) return stopSpeaking();
    const blocks = [...$('article').querySelectorAll('p, h2, h3, h4, li, blockquote')].filter(n => n.textContent.trim().length > 1);
    if (!blocks.length) return;
    speaking = true;
    $('listen').textContent = 'Stop';
    $('listen').classList.add('on');
    const lang = document.documentElement.lang || navigator.language;
    const voice = speechSynthesis.getVoices().find(v => v.lang && lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    let i = 0;
    const next = () => {
      document.querySelectorAll('.speaking').forEach(n => n.classList.remove('speaking'));
      if (!speaking || i >= blocks.length) return stopSpeaking();
      const el = blocks[i++];
      el.classList.add('speaking');
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const u = new SpeechSynthesisUtterance(el.textContent.trim());
      if (voice) u.voice = voice;
      u.onend = next;
      u.onerror = next;
      speechSynthesis.speak(u);
    };
    next();
  };
  addEventListener('pagehide', stopSpeaking);
})();
