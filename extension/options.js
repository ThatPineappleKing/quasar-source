import { getState, update, uid } from './shared/store.js';
import { applySpaceTheme, spaceVars } from './shared/theme.js';
import { spaceEditor } from './shared/editor.js';

const $ = id => document.getElementById(id);
let st;

async function render() {
  st = await getState();
  applySpaceTheme(document.documentElement, st.spaces.find(s => s.id === st.lastSpaceId) || st.spaces[0]);
  renderSpaces();
  renderAtc();
  renderBoosts();
  $('archiveAfter').value = String(st.settings.archiveAfterHours);
}

// --------------------------------------------------------------- spaces
function renderSpaces() {
  $('spaces').replaceChildren(...st.spaces.map((s, i) => {
    const card = document.createElement('div');
    card.className = 'space-card';
    const preview = document.createElement('div');
    preview.className = 'preview';
    const paint = sp => {
      const v = spaceVars(sp);
      preview.style.background = v['--bg'];
      preview.style.setProperty('--g', (sp.grain ?? .35) * .6);
    };
    paint(s);
    const order = document.createElement('div');
    order.className = 'order';
    order.innerHTML = `${i > 0 ? '<button data-d="-1" title="Move left">‹</button>' : ''}${i < st.spaces.length - 1 ? '<button data-d="1" title="Move right">›</button>' : ''}`;
    order.onclick = e => { const d = Number(e.target.dataset.d); if (d) move(s.id, d); };
    const ed = spaceEditor(s, async patch => {
      paint({ ...s, ...patch });
      await update(x => { Object.assign(x.spaces.find(y => y.id === s.id), patch); return x; });
    }, {
      onDelete: st.spaces.length > 1 ? async () => {
        if (!confirm(`Delete "${s.name}"? Its tabs move to your first Space.`)) return;
        await update(x => {
          x.spaces = x.spaces.filter(y => y.id !== s.id);
          x.settings.atc = x.settings.atc.filter(r => r.spaceId !== s.id);
          return x;
        });
        render();
      } : null,
    });
    card.append(preview, order, ed);
    return card;
  }));
}

async function move(id, d) {
  await update(x => {
    const i = x.spaces.findIndex(s => s.id === id);
    const [sp] = x.spaces.splice(i, 1);
    x.spaces.splice(i + d, 0, sp);
    return x;
  });
  render();
}

$('addSpace').onclick = async () => {
  await update(x => {
    x.spaces.push({ id: uid(), name: `Space ${x.spaces.length + 1}`, emoji: '✨', colors: ['#A8E6CF', '#C9F2E3', '#E8F7C8'], grain: 0.35, pinned: [] });
    return x;
  });
  render();
};

// -------------------------------------------------------------- archive
$('archiveAfter').onchange = e => update(x => { x.settings.archiveAfterHours = Number(e.target.value); return x; });

// --------------------------------------------------- Air Traffic Control
function renderAtc() {
  $('atc').replaceChildren(...st.settings.atc.map(r => {
    const row = document.createElement('div');
    row.className = 'rule';
    row.innerHTML = `<input type="text" placeholder="e.g. github.com" aria-label="Site">
      <span style="align-self:center">→</span>
      <select aria-label="Space"></select>
      <button class="del" title="Remove" aria-label="Remove">✕</button>`;
    const [inp, sel] = [row.querySelector('input'), row.querySelector('select')];
    inp.value = r.pattern;
    for (const s of st.spaces) sel.add(new Option(`${s.emoji || ''} ${s.name}`.trim(), s.id, false, s.id === r.spaceId));
    const save = () => update(x => {
      const rr = x.settings.atc.find(y => y.id === r.id);
      rr.pattern = inp.value.trim(); rr.spaceId = sel.value;
      return x;
    });
    inp.onchange = save; sel.onchange = save;
    row.querySelector('.del').onclick = async () => {
      await update(x => { x.settings.atc = x.settings.atc.filter(y => y.id !== r.id); return x; });
      render();
    };
    return row;
  }));
}
$('addAtc').onclick = async () => {
  await update(x => { x.settings.atc.push({ id: uid(), pattern: '', spaceId: x.spaces[0].id }); return x; });
  await render();
  $('atc').lastElementChild?.querySelector('input')?.focus();
};

// ---------------------------------------------------------------- boosts
function renderBoosts() {
  $('boosts').replaceChildren(...st.settings.boosts.map(b => {
    const row = document.createElement('div');
    row.className = 'rule boost';
    row.innerHTML = `<input type="text" placeholder="Site, e.g. youtube.com" aria-label="Site">
      <label class="toggle"><input type="checkbox"> On</label>
      <button class="del" title="Remove" aria-label="Remove">✕</button>
      <textarea placeholder="CSS, e.g.  #comments { display: none !important; }" aria-label="CSS"></textarea>`;
    const [dom, on, css] = [row.querySelector('input[type=text]'), row.querySelector('input[type=checkbox]'), row.querySelector('textarea')];
    dom.value = b.domain; on.checked = b.enabled; css.value = b.css;
    const save = () => update(x => {
      Object.assign(x.settings.boosts.find(y => y.id === b.id), { domain: dom.value.trim(), enabled: on.checked, css: css.value });
      return x;
    });
    dom.onchange = save; on.onchange = save; css.onchange = save;
    row.querySelector('.del').onclick = async () => {
      await update(x => { x.settings.boosts = x.settings.boosts.filter(y => y.id !== b.id); return x; });
      render();
    };
    return row;
  }));
}
$('addBoost').onclick = async () => {
  await update(x => { x.settings.boosts.push({ id: uid(), domain: '', css: '', enabled: true }); return x; });
  await render();
  $('boosts').lastElementChild?.querySelector('input')?.focus();
};

// ---------------------------------------------------------------- backup
$('export').onclick = async () => {
  const data = await getState();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'arc-chrome-backup.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('import').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.spaces) || !data.spaces.length) throw new Error('No Spaces in file');
    if (!confirm('Replace your current Spaces and settings with this backup?')) return;
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
    render();
  } catch (err) {
    alert('Could not import: ' + err.message);
  } finally {
    e.target.value = '';
  }
};

// Re-render when something else (the sidebar) changes state, unless the
// user is typing here.
chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local' && !document.activeElement?.matches('input, textarea, select')) render();
});

render();
