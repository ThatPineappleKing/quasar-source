// Clock styles for the focus screen (shown when no tab is open). Used by the
// window (app.js) and by the style picker in Settings. Every style is sized in
// em, so the same markup works full size and as a small preview.
(() => {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  // Hours, minutes, seconds and AM/PM for a time, following the 24-hour setting.
  function parts(now, o) {
    const H = now.getHours();
    const h = o.h24 ? H : (H % 12 || 12);
    const loc = now.toLocaleTimeString([], { hour: 'numeric', hour12: true });
    const ap = o.h24 ? '' : (loc.match(/[AaPp]\.?\s?[Mm]\.?/)?.[0] || (H < 12 ? 'AM' : 'PM'));
    return { H, h, m: now.getMinutes(), s: now.getSeconds(), ap };
  }
  const ampm = p => (p.ap ? `<span class="fc-ampm">${esc(p.ap)}</span>` : '');

  // Seven-segment digits (segments a to g).
  const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
  const seg = d => d === ':' ? '<span class="s7c"><i></i><i></i></span>'
    : `<span class="s7">${'abcdefg'.split('').map(x => `<i class="${x}${SEG[d].includes(x) ? ' on' : ''}"></i>`).join('')}</span>`;

  // 5 by 7 dot font.
  const DOT = {
    0: '01110100011001110101110011000101110', 1: '00100011000010000100001000010001110',
    2: '01110100010000100010001000100011111', 3: '11111000100010000010000011000101110',
    4: '00010001100101010010111110001000010', 5: '11111100001111000001000011000101110',
    6: '00110010001000011110100011000101110', 7: '11111000010001000100010000100001000',
    8: '01110100011000101110100011000101110', 9: '01110100011000101111000010001001100',
  };
  const dot = d => d === ':' ? '<span class="dm dm-c"><i></i><i></i><i class="on"></i><i></i><i class="on"></i><i></i><i></i></span>'
    : `<span class="dm">${DOT[d].split('').map(b => (b === '1' ? '<i class="on"></i>' : '<i></i>')).join('')}</span>`;

  // The time in words, like a word clock.
  const NUM = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen',
    'fourteen', 'quarter', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const num = n => (n <= 20 ? NUM[n] : 'twenty-' + NUM[n - 20]);
  function words(p) {
    const { H, m } = p;
    const next = m > 30;
    const hr24 = (H + (next ? 1 : 0)) % 24;
    const hr = NUM[hr24 % 12 || 12];
    if (m === 0 && H === 0) return 'It’s <b>midnight</b>';
    if (m === 0 && H === 12) return 'It’s <b>noon</b>';
    const n = next ? 60 - m : m;
    const unit = n === 15 || n % 5 === 0 ? '' : n === 1 ? ' minute' : ' minutes';
    const head = m === 0 ? `${hr} o’clock` : m === 30 ? `half past ${hr}` : `${num(n)}${unit} ${next ? 'to' : 'past'} ${hr}`;
    const when = hr24 < 5 || hr24 >= 21 ? 'at night' : hr24 < 12 ? 'in the morning' : hr24 < 17 ? 'in the afternoon' : 'in the evening';
    return `It’s <b>${head}</b><br>${when}`;
  }

  // Flip cards: a hidden copy sizes the card; two halves show the number. When
  // it changes, the old top half falls and the new bottom half drops into place.
  // Hours have no leading zero in 12-hour time; AM/PM sits in the hours card's corner.
  const flipVals = (p, o) => [o.h24 ? pad(p.h) : String(p.h), pad(p.m), o.sec && pad(p.s)].filter(Boolean);
  const card = (v, ap) => `<span class="fl" data-v="${v}"><span class="fl-s">${v}</span><span class="fl-h fl-t">${v}</span><span class="fl-h fl-b">${v}</span>${ap ? `<span class="fl-ap">${esc(ap)}</span>` : ''}</span>`;
  function flipTo(c, v) {
    const old = c.dataset.v;
    if (old === v) return;
    // A flip still running: finish it at once.
    for (const f of c.querySelectorAll('.fl-ft, .fl-fb')) f.remove();
    c.dataset.v = v;
    c.querySelector('.fl-s').textContent = v;
    c.querySelector('.fl-t').textContent = v;
    const bot = c.querySelector('.fl-b');
    bot.textContent = old;
    const ft = document.createElement('span'); ft.className = 'fl-h fl-ft'; ft.textContent = old;
    const fb = document.createElement('span'); fb.className = 'fl-h fl-fb'; fb.textContent = v;
    c.append(ft, fb);
    const done = () => { if (c.dataset.v === v) bot.textContent = v; ft.remove(); fb.remove(); };
    fb.addEventListener('animationend', done, { once: true });
    setTimeout(done, 1500);   // if the clock was hidden mid-flip
  }

  const STYLES = {
    thin: { name: 'Thin', html: (p, o) => `${o.h24 ? pad(p.h) : p.h}:${pad(p.m)}${o.sec ? ':' + pad(p.s) : ''}${ampm(p)}` },
    bold: { name: 'Bold', html: (p, o) => `${o.h24 ? pad(p.h) : p.h}:${pad(p.m)}${o.sec ? ':' + pad(p.s) : ''}${ampm(p)}` },
    flip: { name: 'Flip', html: (p, o) => flipVals(p, o).map((v, i) => card(v, i === 0 && p.ap)).join('') },
    stack: { name: 'Stacked', html: (p, o) => `<b>${pad(p.h)}</b><b>${pad(p.m)}</b>${o.sec ? `<small>${pad(p.s)}</small>` : ''}${p.ap ? `<small>${esc(p.ap)}</small>` : ''}` },
    led: { name: 'Digital', html: (p, o) => `<span class="led-box">${[...`${pad(p.h)}:${pad(p.m)}${o.sec ? ':' + pad(p.s) : ''}`].map(seg).join('')}${p.ap ? `<span class="led-ap">${esc(p.ap)}</span>` : ''}</span>` },
    nixie: { name: 'Nixie', html: (p, o) => [pad(p.h), pad(p.m), o.sec && pad(p.s)].filter(Boolean).map(x => [...x].map(d => `<span class="nx"><b>${d}</b></span>`).join('')).join('<em>·</em>') + (p.ap ? `<span class="nx-ap">${esc(p.ap)}</span>` : '') },
    dots: { name: 'Dot matrix', html: (p, o) => `<span class="dm-box">${[...`${pad(p.h)}:${pad(p.m)}${o.sec ? ':' + pad(p.s) : ''}`].map(dot).join('')}${p.ap ? `<span class="dm-ap">${esc(p.ap)}</span>` : ''}</span>` },
    words: { name: 'Words', html: p => words(p) },
  };

  window.ArchClocks = {
    styles: Object.keys(STYLES).map(id => ({ id, name: STYLES[id].name })),
    valid: id => Object.prototype.hasOwnProperty.call(STYLES, id),
    // Markup for the time, sized relative to the element it goes in. o: { h24, sec }.
    html(style, now, o = {}) {
      const id = STYLES[style] ? style : 'thin';
      return `<span class="clk clk-${id}">${STYLES[id].html(parts(now, o), o)}</span>`;
    },
    // Show the time in el, animating what changed where the style has an animation.
    update(el, style, now, o = {}) {
      const id = STYLES[style] ? style : 'thin';
      if (id === 'flip') {
        const p = parts(now, o), vals = flipVals(p, o);
        const root = el.firstElementChild;
        const cards = root?.classList.contains('clk-flip') ? [...root.querySelectorAll(':scope > .fl')] : [];
        const ap = root?.querySelector('.fl-ap')?.textContent || '';
        if (cards.length === vals.length && ap === p.ap) { cards.forEach((c, i) => flipTo(c, vals[i])); return; }
      }
      const html = this.html(id, now, o);
      if (el.innerHTML !== html) el.innerHTML = html;
    },
  };
})();
