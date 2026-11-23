// Space Drift: Quasar's offline game.
// Your page is adrift. Hold to push the comet ("the Ping") upward, let go to
// drift down, and thread it through floating tabs for as long as you can.
// Score is distance ("ms of latency survived"). Best score is kept locally.
//
// Look: plain black-and-white pixel art, like the classic no-internet games.
// Everything is drawn on a small low-resolution canvas and scaled up with
// whole-number pixels, so edges stay crisp. Light or dark follows the system.
(() => {
  'use strict';

  const H = 600;                       // logical world height; width follows the window's shape
  const R = 9;                         // comet radius (world units)
  const BEST_KEY = 'arch.spaceDrift.best';
  const MODE_KEY = 'arch.spaceDrift.mode';
  const LEVELS = ['DIAL-UP', 'DSL', 'CABLE', 'FIBER', 'LIGHT SPEED'];   // a new one every 1,000 ms
  const UNLOCK = { spinner: 150, packets: 1000, popup: 1500, hole: 3000 }; // by score
  const ZEN_SPEED = 230;
  const PIXEL_ROWS = 280;              // roughly how many art pixels tall the game is

  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const darkMode = matchMedia('(prefers-color-scheme: dark)');
  const PALETTE = {
    light: { bg: '#f7f7f7', fg: '#4d4d4d', mid: '#c2c2c2' },
    dark:  { bg: '#181818', fg: '#d9d9d9', mid: '#5a5a5a' },
  };

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pad = (n, w = 5) => String(Math.floor(n)).padStart(w, '0');

  const store = {
    get() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } },
    set(v) { try { localStorage.setItem(BEST_KEY, String(Math.floor(v))); } catch { /* storage off: best lasts this visit */ } },
    mode() { try { return localStorage.getItem(MODE_KEY) === 'zen' ? 'zen' : 'classic'; } catch { return 'classic'; } },
    setMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* ignore */ } },
  };

  // ------------------------------------------------------------ pixel font
  // 3x5 glyphs, row by row.
  const FONT = {
    A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110',
    E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101',
    I: '111010010010111', J: '001001001101010', K: '101101110101101', L: '100100100100111',
    M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100',
    Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101',
    Y: '101101010010010', Z: '111001010100111',
    0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
    4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010',
    8: '111101111101111', 9: '111101111001110',
    ':': '000010000010000', '.': '000000000000010', '!': '010010010000010', '+': '000010111010000',
    '-': '000000111000000', '/': '001001010100100', ',': '000000000010100', "'": '010010000000000',
    '?': '110001010000010', '(': '010100100100010', ')': '010001001001010', ' ': '000000000000000',
  };
  const textWidth = (s, k) => s.length * 4 * k - k;

  // ---------------------------------------------------------------- sprites
  // '#' = ink, 'o' = paper (punches a hole), '+' = light grey, '.' = nothing.
  const SPR = {
    comet: [
      '..#####..',
      '.#######.',
      '##oo#####',
      '##o######',
      '#########',
      '#########',
      '#########',
      '.#######.',
      '..#####..',
    ],
    bars: [
      '......#',
      '......#',
      '....#.#',
      '....#.#',
      '..#.#.#',
      '..#.#.#',
      '#.#.#.#',
    ],
    star: [
      '...#...',
      '..###..',
      '#######',
      '.#####.',
      '..###..',
      '.##.##.',
      '.#...#.',
    ],
    shield: [
      '.#####.',
      '#######',
      '##ooo##',
      '##o####',
      '##ooo##',
      '.#####.',
      '..###..',
      '...#...',
    ],
    packetA: ['####', '#o##', '####', '####'],
    packetB: ['####', '####', '##o#', '####'],
    retry: [
      '...#####...',
      '..#.....#..',
      '.#.......#.',
      '.#.......#.',
      '.#.....#####',
      '.#......###.',
      '..#......#..',
      '...#####....',
    ],
  };

  class SpaceDrift {
    constructor(canvas, { onBest, onMode } = {}) {
      this.cv = canvas;
      this.cx = canvas.getContext('2d');
      this.buf = document.createElement('canvas');       // the low-res pixel canvas
      this.bx = this.buf.getContext('2d');
      // Classic: one hit ends the run. Zen: nothing can hit you — just drift and collect.
      this.mode = store.mode();
      this.onMode = onMode || (() => {});
      this.onBest = onBest || (() => {});
      this.best = store.get();
      this.held = false;
      this.running = false;
      this.stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * H, z: rand(0.15, 1), big: Math.random() < 0.12 }));
      this.clouds = Array.from({ length: 4 }, () => ({ x: Math.random(), y: rand(40, H - 120), w: rand(60, 110) }));
      this.reset();
      this.state = 'ready';
      this.frame = this.frame.bind(this);
      this.resize = this.resize.bind(this);
    }

    reset() {
      this.y = H / 2; this.vy = 0;
      this.dist = 0; this.bonus = 0; this.time = 0;
      this.speed = 270;
      this.obs = []; this.items = []; this.parts = []; this.trail = [];
      this.untilNext = 380; this.untilPacket = 3;
      this.lastGapY = H / 2;
      this.meter = 0; this.boost = 0; this.shield = false; this.grace = 0;
      this.level = 0; this.toast = null; this.shake = 0;
      this.newBest = false;
      this.collected = 0;
      this.scroll = 0;
    }

    get zen() { return this.mode === 'zen'; }
    get score() { return this.dist / 10 + this.bonus; }

    // Switch modes from the start, pause or "Signal lost" screens (never mid-run).
    setMode(mode) {
      mode = mode === 'zen' ? 'zen' : 'classic';
      if (mode === this.mode || this.state === 'play') return false;
      this.mode = mode;
      store.setMode(mode);
      this.reset();
      this.state = 'ready';
      this.onMode(mode);
      return true;
    }

    // ------------------------------------------------------------ lifecycle
    start() {
      if (this.running) return;
      this.running = true;
      addEventListener('resize', this.resize);
      this.resize();
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
    stop() {
      this.running = false;
      cancelAnimationFrame(this.raf);
      removeEventListener('resize', this.resize);
      this.held = false;
      if (this.state === 'play') this.state = 'paused';
    }
    resize() {
      const dpr = devicePixelRatio || 1;
      const cw = Math.round((this.cv.clientWidth || 800) * dpr), ch = Math.round((this.cv.clientHeight || 600) * dpr);
      this.cv.width = cw; this.cv.height = ch;
      this.P = Math.max(1, Math.round(ch / PIXEL_ROWS));  // screen pixels per art pixel (whole number)
      this.bw = Math.ceil(cw / this.P); this.bh = Math.ceil(ch / this.P);
      this.buf.width = this.bw; this.buf.height = this.bh;
      this.s = this.bh / H;                                // world units -> art pixels
      this.W = this.bw / this.s;                           // logical width
      this.px = clamp(this.W * 0.22, 110, 260);            // comet's fixed x
    }

    // ------------------------------------------------------------- controls
    press() {
      if (this.state === 'ready' || this.state === 'paused') this.state = 'play';
      else if (this.state === 'over') { if (performance.now() - this.overAt > 450) { this.reset(); this.state = 'play'; } else return; }
      this.held = true;
    }
    release() { this.held = false; }
    togglePause() {
      if (this.state === 'play') { this.state = 'paused'; this.held = false; }
      else if (this.state === 'paused') this.state = 'play';
    }

    // ----------------------------------------------------------------- loop
    frame(now) {
      if (!this.running) return;
      const dt = Math.min(1 / 30, (now - this.last) / 1000);
      this.last = now;
      this.clock = now / 1000;
      if (this.state === 'play') this.update(dt);
      else this.idle(dt);
      this.draw();
      this.raf = requestAnimationFrame(this.frame);
    }

    idle(dt) {
      if (this.state === 'ready') { this.time += dt; this.y = H / 2 + Math.sin(this.time * 2) * 14; }
      this.stepParticles(dt);
      for (const s of this.stars) { s.x -= dt * 0.006 * s.z; if (s.x < 0) s.x += 1; }
    }

    update(dt) {
      this.time += dt;
      const d = this.zen ? 0 : clamp(this.dist / 60000, 0, 1);
      const boostMul = this.boost > 0 ? 1.35 : 1;
      this.speed = this.zen ? ZEN_SPEED : Math.min(640, 270 + this.time * 5.5);
      const v = this.speed * boostMul;
      this.dist += v * dt;
      this.scroll += v * dt;

      // Comet: hold to climb, let go to drift down.
      this.vy += (this.held ? -1500 : 950) * dt;
      for (const o of this.obs) {                   // 404 holes pull you in
        if (o.type !== 'hole') continue;
        const dx = o.x - this.px, dy = o.y - this.y, dd = Math.hypot(dx, dy);
        if (dd < o.pull && dd > 1) this.vy += (dy / dd) * 1300 * (1 - dd / o.pull) * dt;
      }
      this.vy = clamp(this.vy, -430, 480);
      this.y += this.vy * dt;
      if (this.y < R) { this.y = R; this.vy = Math.max(0, this.vy); }
      if (this.y > H - R) { this.y = H - R; this.vy = Math.min(0, this.vy); }

      this.trail.push({ x: this.px, y: this.y });
      if (this.trail.length > 18) this.trail.shift();
      for (const t of this.trail) t.x -= v * dt;

      this.boost = Math.max(0, this.boost - dt);
      this.grace = Math.max(0, this.grace - dt);
      this.shake = Math.max(0, this.shake - dt);

      // Spawning, spaced by distance so it stays fair as speed rises.
      this.untilNext -= v * dt;
      if (this.untilNext <= 0) this.spawn(d);
      if (!this.zen && this.score >= UNLOCK.packets) {
        this.untilPacket -= dt;
        if (this.untilPacket <= 0) {
          this.untilPacket = rand(1.6, 3.2) - d;
          this.obs.push({ type: 'packet', x: rand(this.W * 0.55, this.W + 80), y: -16, vx: -rand(40, 120), vy: rand(150, 210), s: 11, spin: 0 });
        }
      }

      // Move the world.
      for (const o of this.obs) {
        o.x -= v * dt;
        if (o.type === 'spinner') o.rot += dt * 3;
        if (o.type === 'packet') { o.x += o.vx * dt; o.y += o.vy * dt; o.spin += dt * 5; }
        if (o.type === 'popup' && o.warn > 0) o.warn -= dt;
        if (o.type === 'hole') o.rot += dt;
      }
      for (const it of this.items) { it.x -= v * dt; it.t += dt; }
      this.obs = this.obs.filter(o => o.x > -200 && !(o.type === 'packet' && o.y > H + 40) && !o.dead);
      this.items = this.items.filter(it => it.x > -40 && !it.taken);

      // Background drifts by slower than the foreground.
      for (const s of this.stars) { s.x -= (v * dt * s.z * 0.3) / this.W; if (s.x < 0) { s.x += 1; s.y = Math.random() * H; } }
      for (const c of this.clouds) { c.x -= (v * dt * 0.12) / this.W; if (c.x < -0.2) { c.x = 1.1; c.y = rand(40, H - 120); c.w = rand(60, 110); } }

      this.collide();
      this.stepParticles(dt);

      // Milestones: a faster connection every 1,000 ms (Zen just keeps drifting).
      if (!this.zen) {
        const lvl = Math.min(LEVELS.length - 1, Math.floor(this.score / 1000));
        if (lvl > this.level) { this.level = lvl; this.toast = { text: `${lvl * 1000} - ${LEVELS[lvl]}`, t: 2.4 }; }
      }
      if (this.toast && (this.toast.t -= dt) <= 0) this.toast = null;
    }

    spawn(d) {
      const s = this.score, x = this.W + 70;
      // Zen keeps the scenery (tabs and spinners) but spaces it out, with no pop-ups or 404 holes.
      const pool = ['wall', 'wall', 'wall'];
      if (this.zen || s >= UNLOCK.spinner) pool.push('spinner', 'spinner');
      if (!this.zen && s >= UNLOCK.popup) pool.push('popup');
      if (!this.zen && s >= UNLOCK.hole) pool.push('hole');
      const kind = pool[Math.floor(Math.random() * pool.length)];
      let gapAfter = this.zen ? rand(520, 680) : lerp(470, 330, d);

      if (kind === 'wall') {
        const gap = lerp(235, 150, d);
        // Never ask for a jump bigger than you can make before you get there.
        const reach = 230;
        const cy = clamp(this.lastGapY + rand(-reach, reach), gap / 2 + 36, H - gap / 2 - 36);
        this.lastGapY = cy;
        this.obs.push({ type: 'wall', x, w: 62, top: cy - gap / 2, bot: cy + gap / 2, seed: Math.floor(Math.random() * 1000) });
        if (Math.random() < (this.zen ? 0.7 : 0.35)) this.items.push({ type: 'bar', x: x + 31, y: cy, t: 0 });
      } else if (kind === 'spinner') {
        const y = rand(120, H - 120);
        this.lastGapY = y < H / 2 ? y + 150 : y - 150;
        this.obs.push({ type: 'spinner', x, y, r: 54, th: 12, rot: 0 });
        gapAfter *= 0.9;
      } else if (kind === 'popup') {
        // Pops up on screen ahead of you, blinking first; never right on your line.
        let y;
        do { y = rand(70, H - 70); } while (Math.abs(y - this.y) < 110);
        this.obs.push({ type: 'popup', x: this.W * rand(0.62, 0.78), y, w: 128, h: 84, warn: 0.75 });
      } else {
        const y = rand(150, H - 150);
        this.obs.push({ type: 'hole', x: x + 40, y, r: 24, pull: 170, rot: 0 });
        gapAfter *= 1.15;
      }

      // Something to collect in the space between obstacles.
      const mid = x + gapAfter / 2, roll = Math.random();
      const my = clamp(this.lastGapY + rand(-90, 90), 60, H - 60);
      if (this.zen) {
        // Zen: more to collect, laid out in gentle arcs; no shields (nothing to block).
        if (roll < 0.12) this.items.push({ type: 'star', x: mid, y: my, t: 0 });
        else if (roll < 0.8) {
          const n = 3 + Math.floor(Math.random() * 3), dy = rand(-30, 30);
          for (let i = 0; i < n; i++) this.items.push({ type: 'bar', x: mid + (i - (n - 1) / 2) * 44, y: clamp(my + dy * Math.sin(i / (n - 1 || 1) * Math.PI), 50, H - 50), t: i * 0.3 });
        }
      } else if (roll < 0.05 && !this.shield) this.items.push({ type: 'shield', x: mid, y: my, t: 0 });
      else if (roll < 0.09) this.items.push({ type: 'star', x: mid, y: my, t: 0 });
      else if (roll < 0.42) this.items.push({ type: 'bar', x: mid, y: my, t: 0 });

      this.untilNext = gapAfter;
    }

    // ------------------------------------------------------------ collisions
    hits(o) {
      const x = this.px, y = this.y;
      switch (o.type) {
        case 'wall': {
          if (x + R < o.x || x - R > o.x + o.w) return false;
          const nx = clamp(x, o.x, o.x + o.w);
          if (y - R < o.top) return Math.hypot(x - nx, y - clamp(y, 0, o.top)) < R;
          if (y + R > o.bot) return Math.hypot(x - nx, y - clamp(y, o.bot, H)) < R;
          return false;
        }
        case 'spinner': return Math.abs(Math.hypot(x - o.x, y - o.y) - o.r) < o.th / 2 + R - 2;
        case 'popup': {
          if (o.warn > 0) return false;
          const nx = clamp(x, o.x - o.w / 2, o.x + o.w / 2), ny = clamp(y, o.y - o.h / 2, o.y + o.h / 2);
          return Math.hypot(x - nx, y - ny) < R - 1;
        }
        case 'hole': return Math.hypot(x - o.x, y - o.y) < o.r + R - 4;
        case 'packet': return Math.abs(x - o.x) < o.s / 2 + R - 2 && Math.abs(y - o.y) < o.s / 2 + R - 2;
      }
      return false;
    }

    collide() {
      for (const it of this.items) {
        if (Math.hypot(it.x - this.px, it.y - this.y) > R + 14) continue;
        it.taken = true;
        this.collected++;
        if (it.type === 'bar') {
          this.bonus += 10;
          if (this.boost <= 0 && ++this.meter >= 5) { this.meter = 0; this.boost = 4; this.toast = { text: 'BOOST!', t: 1.2 }; }
        } else if (it.type === 'shield') { this.shield = true; this.toast = { text: 'SHIELD READY', t: 1.4 }; }
        else { this.bonus += 250; this.toast = { text: '+250', t: 1.2 }; }
        this.puff(it.x, it.y, 6, 1);
      }
      if (this.zen) return;                         // Zen: you drift straight through everything
      for (const o of this.obs) {
        if (!this.hits(o)) continue;
        if (this.boost > 0 || this.grace > 0) {
          if (this.boost > 0 && o.type !== 'wall' && o.type !== 'hole') { o.dead = true; this.puff(o.x, o.y, 12, 1.6); }
          continue;
        }
        if (this.shield) {
          this.shield = false; this.grace = 1.1;
          if (o.type !== 'wall') o.dead = true;
          this.puff(this.px, this.y, 12, 1.6); this.shake = 0.2;
          continue;
        }
        return this.crash();
      }
    }

    crash() {
      this.state = 'over';
      this.overAt = performance.now();
      this.held = false;
      this.shake = 0.35;
      this.puff(this.px, this.y, reduceMotion.matches ? 8 : 26, 2.6);
      if (this.score > this.best) { this.best = Math.floor(this.score); this.newBest = true; store.set(this.best); this.onBest(this.best); }
    }

    // -------------------------------------------------------------- particles
    puff(x, y, n, power) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = rand(30, 140) * power;
        this.parts.push({ x, y, vx: Math.cos(a) * sp - 60, vy: Math.sin(a) * sp, life: rand(0.3, 0.8), big: Math.random() < 0.35 });
      }
    }
    stepParticles(dt) {
      for (const p of this.parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; p.life -= dt; }
      this.parts = this.parts.filter(p => p.life > 0);
    }

    // ================================================================= draw
    // Pixel helpers: everything below works in art pixels on the small canvas.
    X(v) { return Math.round(v * this.s); }
    rect(x, y, w, h, color) { this.bx.fillStyle = color; this.bx.fillRect(x, y, w, h); }
    box(x, y, w, h, color) {          // 1px outline
      this.rect(x, y, w, 1, color); this.rect(x, y + h - 1, w, 1, color);
      this.rect(x, y, 1, h, color); this.rect(x + w - 1, y, 1, h, color);
    }
    disc(cx, cy, r, color) {          // filled pixel circle
      for (let dy = -r; dy <= r; dy++) {
        const w = Math.floor(Math.sqrt(r * r - dy * dy));
        this.rect(cx - w, cy + dy, 2 * w + 1, 1, color);
      }
    }
    sprite(art, cx, cy, ink, invert = false, k = 1) {
      const h = art.length, w = art[0].length, x0 = cx - ((w * k) >> 1), y0 = cy - ((h * k) >> 1);
      for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
        let ch = art[r][c];
        if (invert) ch = ch === '#' ? 'o' : ch === 'o' ? '#' : ch;
        const color = ch === '#' ? ink : ch === 'o' ? this.pal.bg : ch === '+' ? this.pal.mid : null;
        if (color) this.rect(x0 + c * k, y0 + r * k, k, k, color);
      }
    }
    text(str, x, y, k, color, align = 'left') {
      str = String(str).toUpperCase();
      const w = textWidth(str, k);
      if (align === 'center') x -= w >> 1; else if (align === 'right') x -= w;
      for (const ch of str) {
        const g = FONT[ch] || FONT[' '];
        for (let i = 0; i < 15; i++) if (g[i] === '1') this.rect(x + (i % 3) * k, y + Math.floor(i / 3) * k, k, k, color);
        x += 4 * k;
      }
      return w;
    }
    label(str, x, y, k, color, align = 'left') {   // text on a paper-coloured backing so it reads over anything
      const w = textWidth(String(str), k);
      const lx = align === 'center' ? x - (w >> 1) : align === 'right' ? x - w : x;
      this.rect(lx - k * 2, y - k * 2, w + k * 4, 5 * k + k * 4, this.pal.bg);
      this.text(str, x, y, k, color, align);
    }

    draw() {
      this.pal = darkMode.matches ? PALETTE.dark : PALETTE.light;
      const { bg, fg, mid } = this.pal, bw = this.bw, bh = this.bh;
      this.tick = Math.floor((this.clock || 0) * 8);   // for 2-frame pixel animations

      this.rect(0, 0, bw, bh, bg);

      // Background: single-pixel stars, a few "+" stars, and outlined data clouds.
      for (const s of this.stars) {
        const x = Math.round(s.x * bw), y = this.X(s.y);
        if (s.big) { this.rect(x - 1, y, 3, 1, mid); this.rect(x, y - 1, 1, 3, mid); }
        else this.rect(x, y, 1, 1, mid);
      }
      for (const c of this.clouds) this.drawCloud(Math.round(c.x * bw), this.X(c.y), this.X(c.w));

      // Dotted rails along the top and bottom edge, scrolling with you.
      const off = Math.floor(this.X(this.scroll)) % 6;
      for (let x = -off; x < bw; x += 6) { this.rect(x, 1, 3, 1, mid); this.rect(x, bh - 2, 3, 1, mid); }

      // In Zen the scenery is drawn in light grey, so it reads as harmless.
      const ink = this.zen ? mid : fg;
      for (const o of this.obs) this.drawObstacle(o, ink);
      for (const it of this.items) this.drawItem(it);
      this.drawTrail();
      for (const p of this.parts) { const z = p.big ? 2 : 1; this.rect(this.X(p.x), this.X(p.y), z, z, p.life > 0.25 ? fg : mid); }
      if (this.state !== 'over') this.drawComet();
      this.drawHud();

      // Blow the pixel canvas up to the screen with whole-number pixels.
      const c = this.cx, P = this.P;
      c.imageSmoothingEnabled = false;
      c.fillStyle = bg; c.fillRect(0, 0, this.cv.width, this.cv.height);
      let sx = 0, sy = 0;
      if (this.shake > 0 && !reduceMotion.matches) { sx = Math.round(rand(-2, 2)) * P; sy = Math.round(rand(-2, 2)) * P; }
      c.drawImage(this.buf, sx, sy, bw * P, bh * P);
    }

    drawCloud(x, y, w) {
      // A little outlined speech bubble drifting by.
      const h = Math.max(7, Math.round(w * 0.32)), mid = this.pal.mid;
      this.rect(x + 2, y, w - 4, 1, mid); this.rect(x + 2, y + h - 1, w - 4, 1, mid);
      this.rect(x, y + 2, 1, h - 4, mid); this.rect(x + w - 1, y + 2, 1, h - 4, mid);
      this.rect(x + 1, y + 1, 1, 1, mid); this.rect(x + w - 2, y + 1, 1, 1, mid);
      this.rect(x + 1, y + h - 2, 1, 1, mid); this.rect(x + w - 2, y + h - 2, 1, 1, mid);
      this.rect(x + 5, y + h, 1, 2, mid); this.rect(x + 6, y + h + 1, 1, 1, mid);   // tail
    }

    drawTab(x, y, w, h, ink, edge) {
      const { bg } = this.pal;
      this.rect(x, y, w, h, bg);
      // Rounded-corner outline.
      this.rect(x + 1, y, w - 2, 1, ink); this.rect(x + 1, y + h - 1, w - 2, 1, ink);
      this.rect(x, y + 1, 1, h - 2, ink); this.rect(x + w - 1, y + 1, 1, h - 2, ink);
      if (h >= 8) {
        const my = y + (h >> 1) - 1;
        this.rect(x + 3, my, 3, 3, ink);                       // favicon
        this.rect(x + 8, my + 1, Math.max(0, w - 15), 1, ink);  // title
        this.rect(x + w - 5, my, 1, 1, ink); this.rect(x + w - 3, my, 1, 1, ink);   // tiny ×
        this.rect(x + w - 4, my + 1, 1, 1, ink);
        this.rect(x + w - 5, my + 2, 1, 1, ink); this.rect(x + w - 3, my + 2, 1, 1, ink);
      }
      if (edge === 'bottom') this.rect(x, y + h - 2, w, 2, ink);
      if (edge === 'top') this.rect(x, y, w, 2, ink);
    }

    drawObstacle(o, ink) {
      const { bg, mid } = this.pal;
      if (o.type === 'wall') {
        // A stack of floating browser tabs, with a thick edge on each side of the gap.
        const x = this.X(o.x), w = Math.max(10, this.X(o.x + o.w) - x), th = Math.max(9, this.X(40));
        const top = this.X(o.top), bot = this.X(o.bot);
        for (let y = top - th, i = 0; y > -th; y -= th, i++) this.drawTab(x, y, w, th, ink, i === 0 ? 'bottom' : null);
        for (let y = bot, i = 0; y < this.bh; y += th, i++) this.drawTab(x, y, w, th, ink, i === 0 ? 'top' : null);
      } else if (o.type === 'spinner') {
        // A loading spinner: a ring of dots with a dark head that steps round.
        const cx = this.X(o.x), cy = this.X(o.y), r = this.X(o.r), n = 16;
        const head = Math.floor(o.rot / (Math.PI * 2 / n)) % n;
        for (let i = 0; i < n; i++) {
          const a = i * Math.PI * 2 / n, x = cx + Math.round(Math.cos(a) * r), y = cy + Math.round(Math.sin(a) * r);
          const behind = (head - i + n) % n;
          const color = this.zen ? mid : behind < 5 ? ink : mid;
          this.rect(x - 2, y - 2, 4, 4, color);
        }
      } else if (o.type === 'popup') {
        const w = this.X(o.w), h = this.X(o.h), x = this.X(o.x) - (w >> 1), y = this.X(o.y) - (h >> 1);
        if (o.warn > 0) {
          // Fair warning: a blinking dashed outline before it becomes solid.
          if (this.tick % 2 === 0) {
            for (let i = 0; i < w; i += 4) { this.rect(x + i, y, 2, 1, ink); this.rect(x + i, y + h - 1, 2, 1, ink); }
            for (let i = 0; i < h; i += 4) { this.rect(x, y + i, 1, 2, ink); this.rect(x + w - 1, y + i, 1, 2, ink); }
          }
          return;
        }
        this.rect(x, y, w, h, bg); this.box(x, y, w, h, ink);
        this.rect(x, y, w, 7, ink);                                   // title bar
        this.text('X', x + w - 6, y + 1, 1, bg);
        this.text('POP-UP', x + 3, y + 1, 1, bg);
        this.rect(x + 5, y + 13, w - 10, 1, ink); this.rect(x + 5, y + 18, w - 22, 1, ink);
        this.box(x + w - 22, y + h - 11, 17, 7, ink);                 // "OK" button
        this.text('OK', x + w - 17, y + h - 10, 1, ink);
      } else if (o.type === 'hole') {
        // A 404 hole: a solid dark well with dotted rings that pull you in.
        const cx = this.X(o.x), cy = this.X(o.y), r = this.X(o.r);
        for (let k = 1; k <= 3; k++) {
          const rr = r + k * 8, n = 10 + k * 4;
          for (let i = 0; i < n; i++) {
            const a = i * Math.PI * 2 / n + o.rot * (k % 2 ? 1 : -1);
            this.rect(cx + Math.round(Math.cos(a) * rr), cy + Math.round(Math.sin(a) * rr), 1, 1, mid);
          }
        }
        this.disc(cx, cy, r, ink);
        this.text('404', cx, cy - 2, 1, bg, 'center');
      } else if (o.type === 'packet') {
        this.sprite(this.tick % 2 ? SPR.packetA : SPR.packetB, this.X(o.x), this.X(o.y), ink);
      }
    }

    drawItem(it) {
      const fg = this.pal.fg, x = this.X(it.x), y = this.X(it.y) + Math.round(Math.sin(it.t * 4) * 1.5);
      this.sprite(it.type === 'bar' ? SPR.bars : it.type === 'shield' ? SPR.shield : SPR.star, x, y, fg);
    }

    drawTrail() {
      const { fg, mid } = this.pal;
      // Pixel exhaust: every other point, shrinking and fading toward grey.
      for (let i = this.trail.length - 1, k = 0; i >= 0; i -= 2, k++) {
        const t = this.trail[i], f = i / this.trail.length;
        const z = f > 0.66 ? 3 : f > 0.33 ? 2 : 1;
        if ((k + this.tick) % 5 === 0) continue;                    // a little flicker
        this.rect(this.X(t.x) - (z >> 1) - 3, this.X(t.y) - (z >> 1), z, z, f > 0.5 ? fg : mid);
      }
    }

    drawComet() {
      const { fg } = this.pal, x = this.X(this.px), y = this.X(this.y);
      if (this.grace > 0 && Math.floor(this.grace * 12) % 2 === 0) return;   // blink after a shield hit
      if (this.boost > 0) {
        // Boost: speed lines behind, and the comet drawn hollow.
        for (let i = 0; i < 3; i++) {
          const len = 6 + ((this.tick + i * 3) % 4) * 3;
          this.rect(x - 8 - len, y - 3 + i * 3, len, 1, fg);
        }
        this.sprite(SPR.comet, x, y, fg, true);
        this.box(x - 4, y - 4, 9, 9, fg);
      } else this.sprite(SPR.comet, x, y, fg);
      if (this.shield) {
        const n = 12, r = 8;
        for (let i = 0; i < n; i++) {
          if ((i + this.tick) % 2) continue;
          const a = i * Math.PI * 2 / n;
          this.rect(x + Math.round(Math.cos(a) * r), y + Math.round(Math.sin(a) * r), 1, 1, fg);
        }
      }
    }

    drawHud() {
      const { fg, mid } = this.pal, bw = this.bw, bh = this.bh, k = 2;
      // Top right: score (and best), like an arcade counter.
      if (this.zen) {
        const m = Math.floor(this.time / 60), s = Math.floor(this.time % 60);
        this.label(`ZEN  ${pad(this.collected, 3)}  ${m}:${String(s).padStart(2, '0')}`, bw - 8, 8, k, fg, 'right');
      } else {
        // The score blinks for a moment at each milestone.
        const blink = this.toast && /^\d/.test(this.toast.text) && this.tick % 2 === 0;
        if (!blink) this.label(pad(this.score), bw - 8, 8, k, fg, 'right');
        this.label(`HI ${pad(this.best)}`, bw - 8 - textWidth('00000', k) - 6 * k, 8, k, mid, 'right');
      }

      // Top left: the signal meter (5 bars fill toward a Boost), shield, connection level.
      for (let i = 0; i < 5; i++) {
        const on = this.boost > 0 || i < this.meter, h = 2 + i * 2;
        this.rect(8 + i * 3, 8 + 10 - h, 2, h, on ? fg : mid);
      }
      if (this.boost > 0) this.rect(8, 21, Math.round(14 * this.boost / 4), 1, fg);
      if (this.shield) this.sprite(SPR.shield, 30, 13, fg);
      if (!this.zen) this.text(LEVELS[this.level], 8, 25, 1, mid);

      if (this.toast && this.toast.t > 0 && this.tick % 4 !== 0) this.label(this.toast.text, bw >> 1, 30, k, fg, 'center');

      const cy = bh >> 1;
      const panel = (title, lines, icon) => {
        this.label(title, bw >> 1, cy - 26, 3, fg, 'center');
        lines.forEach((l, i) => this.label(l, bw >> 1, cy - 2 + i * 12, 1, fg, 'center'));
        if (icon) {
          this.rect((bw >> 1) - 15, cy + 22, 30, 22, this.pal.bg);
          this.sprite(SPR.retry, bw >> 1, cy + 33, fg, false, 2);
        }
      };
      if (this.state === 'ready' && this.zen) panel('SPACE DRIFT  ZEN', ['NOTHING CAN HIT YOU. DRIFT AND COLLECT.', 'HOLD SPACE TO FLY  -  Z FOR CLASSIC']);
      else if (this.state === 'ready') panel('SPACE DRIFT', ['HOLD SPACE TO FLY UP. LET GO TO DRIFT.', 'THREAD THE TABS  -  Z FOR ZEN']);
      else if (this.state === 'paused') panel('PAUSED', [`PRESS SPACE TO KEEP DRIFTING  -  Z FOR ${this.zen ? 'CLASSIC' : 'ZEN'}`]);
      else if (this.state === 'over') panel('SIGNAL LOST', [
        this.newBest ? `NEW BEST: ${pad(this.best)}` : `${pad(this.score)}   HI ${pad(this.best)}`,
        'PRESS SPACE TO DRIFT AGAIN  -  Z FOR ZEN',
      ], true);
    }
  }

  window.SpaceDrift = SpaceDrift;
  window.SpaceDrift.bestScore = () => store.get();
})();
