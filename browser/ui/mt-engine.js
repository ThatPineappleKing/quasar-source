// Runs inside Quasar's hidden translation window (src/mt.js). Bergamot's
// BatchTranslator, with models coming from Quasar's own arch-mt://models/ store
// (downloaded once and checked there) instead of the internet.
import { TranslatorBacking, BatchTranslator } from './bergamot/translator.js';

class ArchBacking extends TranslatorBacking {
  async loadModelRegistery() {
    const reg = await (await fetch('arch-mt://models/registry.json')).json();
    return Object.entries(reg).map(([key, files]) => ({
      from: key.slice(0, 2), to: key.slice(2, 4),
      files: Object.fromEntries(Object.entries(files).map(([part, f]) => [part, f && f.name ? { ...f, name: `arch-mt://models/${key}/${f.name}` } : f])),
    }));
  }

  // The main process already checked the SHA-256 of every model file.
  async fetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(await res.text() || `couldn't load ${url}`);
    return res.arrayBuffer();
  }
}

const options = { workers: Math.min(2, Math.max(1, (navigator.hardwareConcurrency || 2) >> 1)), batchSize: 16, downloadTimeout: 0, cacheSize: 2000, useNativeIntGemm: false };
const translator = new BatchTranslator(options, new ArchBacking(options));

// [text] -> [translation | null]
window.archTranslate = async ({ from, to, texts, html }) => Promise.all(texts.map(text =>
  translator.translate({ from, to, text, html: !!html }).then(r => r.target.text, () => null)));
