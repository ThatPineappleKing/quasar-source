// Space theme editor used by both the sidebar and the settings page.
// Mirrors Arc's Space editor: name, icon, gradient colours (up to 3),
// grain amount, plus one-click presets.

import { PRESETS } from './store.js';

export function spaceEditor(space, onChange, { onDelete } = {}) {
  const el = document.createElement('div');
  el.className = 'space-editor';
  el.innerHTML = `
    <div class="se-row">
      <input class="se-emoji" maxlength="4" aria-label="Space icon">
      <input class="se-name" placeholder="Space name" aria-label="Space name">
    </div>
    <div class="se-label">Gradient</div>
    <div class="se-colors"></div>
    <div class="se-label">Grain <span class="se-grain-val"></span></div>
    <input class="se-grain" type="range" min="0" max="1" step="0.05" aria-label="Grain">
    <div class="se-label">Presets</div>
    <div class="se-presets"></div>
    ${onDelete ? '<button class="se-delete" type="button">Delete Space</button>' : ''}
  `;
  const emoji = el.querySelector('.se-emoji');
  const name = el.querySelector('.se-name');
  const colors = el.querySelector('.se-colors');
  const grain = el.querySelector('.se-grain');
  const grainVal = el.querySelector('.se-grain-val');

  emoji.value = space.emoji || '';
  name.value = space.name;
  grain.value = space.grain ?? 0.35;
  grainVal.textContent = Math.round(grain.value * 100) + '%';

  const emit = () => onChange({
    emoji: emoji.value.trim(),
    name: name.value.trim() || 'Untitled',
    colors: [...colors.querySelectorAll('input')].map(i => i.value),
    grain: Number(grain.value),
  });

  function renderColors(list) {
    colors.innerHTML = '';
    list.forEach((c, i) => {
      const wrap = document.createElement('label');
      wrap.className = 'se-swatch';
      wrap.style.background = c;
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.value = c;
      inp.setAttribute('aria-label', `Colour ${i + 1}`);
      inp.addEventListener('input', () => { wrap.style.background = inp.value; emit(); });
      wrap.append(inp);
      colors.append(wrap);
    });
    if (list.length < 3) {
      const add = document.createElement('button');
      add.type = 'button'; add.className = 'se-add'; add.textContent = '+';
      add.title = 'Add colour';
      add.onclick = () => { renderColors([...list, list[list.length - 1]]); emit(); };
      colors.append(add);
    }
    if (list.length > 1) {
      const rm = document.createElement('button');
      rm.type = 'button'; rm.className = 'se-add'; rm.textContent = '−';
      rm.title = 'Remove colour';
      rm.onclick = () => { renderColors(list.slice(0, -1)); emit(); };
      colors.append(rm);
    }
  }
  renderColors(space.colors);

  for (const p of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'se-preset';
    b.title = p.name;
    b.style.background = `linear-gradient(135deg, ${p.colors.join(', ')})`;
    b.onclick = () => { renderColors([...p.colors]); emit(); };
    el.querySelector('.se-presets').append(b);
  }

  emoji.addEventListener('change', emit);
  name.addEventListener('change', emit);
  grain.addEventListener('input', () => { grainVal.textContent = Math.round(grain.value * 100) + '%'; emit(); });
  if (onDelete) el.querySelector('.se-delete').onclick = onDelete;
  return el;
}
