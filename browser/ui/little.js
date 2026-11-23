(() => {
  const $ = id => document.getElementById(id);
  const act = (n, ...a) => window.arch.act(n, ...a);
  window.arch.on('little:state', s => {
    ArchTheme.apply(document.documentElement, s);
    if (document.activeElement !== $('url')) $('url').value = s.url || '';
    document.title = s.title || 'Little Quasar';
  });
  window.arch.on('little:focus-url', () => $('url').focus());
  $('form').onsubmit = e => { e.preventDefault(); const v = $('url').value.trim(); if (v) act('go', v); };
  $('back').onclick = () => act('back');
  $('openMain').onclick = () => act('open-main');
  $('close').onclick = () => act('close');
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.activeElement !== $('url')) act('close'); });
})();
