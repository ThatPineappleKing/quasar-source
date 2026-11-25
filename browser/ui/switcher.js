// Ctrl+Tab switcher: draws the tabs being cycled, the current one highlighted.
(() => {
  const row = document.getElementById('row');
  const safeImg = u => (/^(https?:|data:image\/)/.test(String(u || '')) ? String(u) : '');
  window.arch.on('switcher:show', ({ items, i }) => {
    row.replaceChildren(...items.map((t, n) => {
      const el = document.createElement('div');
      el.className = 't' + (n === i ? ' on' : '');
      const pic = document.createElement('div');
      pic.className = 'pic';
      const thumb = safeImg(t.thumb), fav = safeImg(t.favicon);
      if (thumb) pic.style.backgroundImage = `url("${thumb.replace(/"/g, '%22')}")`;
      else if (fav) { const f = document.createElement('img'); f.className = 'fav'; f.src = fav; pic.append(f); }
      const name = document.createElement('div');
      name.className = 'name';
      if (fav) { const f = document.createElement('img'); f.src = fav; name.append(f); }
      const span = document.createElement('span');
      span.textContent = t.title;
      name.append(span);
      const host = document.createElement('div');
      host.className = 'host';
      host.textContent = t.host || '';
      el.append(pic, name, host);
      return el;
    }));
    row.children[i]?.scrollIntoView({ inline: 'center' });
  });
})();
