// @ts-nocheck
import { Gfx } from './gfx';
import { Audio } from './audio';
import * as lua from './lua';
import { LuaError, LuaTable, MR, tostr, str2num } from './lua';
import { Cart, ROM_SIZE, newCart, parseP8, serializeP8, demoCart, pseudo3dCart } from './cart';
import { CodeEditor } from './editors/code';
import { SpriteEditor } from './editors/sprite';
import { MapEditor } from './editors/map';
import { SfxEditor } from './editors/sfx';
import { MusicEditor } from './editors/music';
import { Terminal, SCREEN_START, SCREEN_END, TEXT_LINE_HEIGHT } from './console';

const KEYMAP: Record<string, [number, number]> = {
  ArrowLeft: [0, 0], ArrowRight: [0, 1], ArrowUp: [0, 2], ArrowDown: [0, 3],
  KeyZ: [0, 4], KeyC: [0, 4], KeyN: [0, 4], KeyX: [0, 5], KeyV: [0, 5], KeyM: [0, 5],
  KeyS: [1, 0], KeyF: [1, 1], KeyE: [1, 2], KeyD: [1, 3], ShiftLeft: [1, 4], KeyA: [1, 4], Tab: [1, 5], KeyQ: [1, 5],
};
const EDITORS = ['code', 'sprite', 'map', 'sfx', 'music'];
const DRIVE = 'p8web.drive';

export class Machine {
  mem = new Uint8Array(65536);
  g: Gfx;
  audio: Audio;
  canvas!: HTMLCanvasElement;
  ctx!: CanvasRenderingContext2D;
  container!: HTMLElement;
  mode = 'console';
  lastEditor = 'code';
  returnMode = 'console';
  editors: any = {};
  console: Terminal;
  cartName = '';
  snapshot: Uint8Array | null = null;
  run: any = null;
  paused: any = null;

  // Los editores usan la misma VRAM. Guardamos la vista de consola
  // al entrar en un editor, no al pasar de RUN a la consola.
  private consoleScreen: Uint8Array | null = null;

  mouse = { x: 0, y: 0, l: false, r: false, m: false, edgeL: false, edgeR: false, wheel: 0 };
  keys = { shift: false, ctrl: false, alt: false, down: new Set<string>(), pressed: new Set<string>() };
  keyQueue: string[] = [];
  toastText = ''; toastUntil = 0;
  frameNo = 0;
  raf = 0; last = 0;
  btnCur = [new Array(8).fill(false), new Array(8).fill(false)];
  btnHold = [new Array(8).fill(0), new Array(8).fill(0)];
  consoleG: any = null;
  cartDataId = '';
  onCopy: ((t: string) => void) | null = null;
  onModeChange: ((m: string) => void) | null = null;
  fpsCount = 0; fpsTime = 0; fpsReal = 0;
  cleanup: (() => void)[] = [];

  constructor() {
    this.g = new Gfx(this.mem);
    this.audio = new Audio(this.mem);
    this.console = new Terminal(this);
    this.editors.code = new CodeEditor(this);
    this.editors.sprite = new SpriteEditor(this);
    this.editors.map = new MapEditor(this);
    this.editors.sfx = new SfxEditor(this);
    this.editors.music = new MusicEditor(this);
    const blank = newCart();
    this.mem.set(blank.data);
    lua.setPeekers({
      peek: (a: any) => this.peek(a), peek2: (a: any) => this.peek2(a), peek4: (a: any) => this.peek4(a),
    });
  }

  /* ---------------- lifecycle ---------------- */
  attach(canvas: HTMLCanvasElement, container: HTMLElement) {
    this.canvas = canvas; this.container = container;
    this.ctx = canvas.getContext('2d')!;
    const on = (t: any, ev: string, fn: any, o?: any) => {
      t.addEventListener(ev, fn, o);
      this.cleanup.push(() => t.removeEventListener(ev, fn, o));
    };
    on(window, 'keydown', (e: KeyboardEvent) => { if (this.onKeyDown(e)) e.preventDefault(); });
    on(window, 'keyup', (e: KeyboardEvent) => this.onKeyUp(e));
    on(window, 'blur', () => { this.keys.down.clear(); this.mouse.l = this.mouse.r = false; });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      this.audio.ensure();
      this.mouseMove(e);
      if (e.button === 0) { this.mouse.l = true; this.mouse.edgeL = true; }
      if (e.button === 2) { this.mouse.r = true; this.mouse.edgeR = true; }
      if (e.button === 1) this.mouse.m = true;
      e.preventDefault();
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouse.l = false;
      if (e.button === 2) this.mouse.r = false;
      if (e.button === 1) this.mouse.m = false;
    });
    on(window, 'mousemove', (e: MouseEvent) => this.mouseMove(e));
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(canvas, 'wheel', (e: WheelEvent) => {
      this.mouse.wheel += Math.sign(e.deltaY);
      e.preventDefault();
    }, { passive: false });
    this.last = performance.now();
    const loop = (now: number) => { this.raf = requestAnimationFrame(loop); this.tick(now); };
    this.raf = requestAnimationFrame(loop);
    this.console.intro();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.cleanup = [];
    this.audio.dispose();
  }

  mouseMove(e: MouseEvent) {
    if (!this.canvas) return;
    const r = this.canvas.getBoundingClientRect();
    this.mouse.x = Math.floor(((e.clientX - r.left) * 128) / r.width);
    this.mouse.y = Math.floor(((e.clientY - r.top) * 128) / r.height);
  }

  toast(t: string, ms = 2200) { this.toastText = t; this.toastUntil = performance.now() + ms; }
  get toastActive() { return performance.now() < this.toastUntil; }
  copy(text: string) { this.onCopy && this.onCopy(text); }

  paste(text: string) {
    if (this.mode === 'console') this.console.paste(text);
    else if (this.mode !== 'run') this.editors[this.mode].paste?.(text);
  }

  copyForEditor(cut: boolean): string | null { return null; }

  private readScreen() {
    return this.mem.slice(SCREEN_START, SCREEN_END);
  }

  private restoreConsoleScreen() {
    if (this.consoleScreen === null) return;
    this.mem.set(this.consoleScreen, SCREEN_START);
    this.consoleScreen = null;
  }

  private clearRamKeepingScreen(from = ROM_SIZE) {
    this.mem.fill(0, from, SCREEN_START);
    this.mem.fill(0, SCREEN_END);
  }

  setMode(m: string) {
    if (m === 'run') return;

    if (this.mode === 'run') {
      this.exitRun(true);
      if (m === 'console') return;
    }

    if (this.mode === 'console' && m !== 'console') {
      this.console.detach();
      this.consoleScreen = this.readScreen();
    } else if (this.mode !== 'console' && m === 'console') {
      this.restoreConsoleScreen();
    }

    this.mode = m;
    if (EDITORS.includes(m)) this.lastEditor = m;
    this.g.resetDraw();
    this.editors[m]?.enter?.();
    this.onModeChange && this.onModeChange(m);
  }

  /* ---------------- frame loop ---------------- */
  tick(now: number) {
    const dt = Math.min(now - this.last, 100);
    this.last = now;
    this.frameNo++;
    this.fpsCount++;
    if (now - this.fpsTime > 1000) {
      this.fpsReal = this.fpsCount;
      this.fpsCount = 0;
      this.fpsTime = now;
    }

    try {
      if (this.mode === 'run') this.runFrame(dt);
      else {
        // Reinicia cámara, clip, etc.; no borra los píxeles.
        this.g.resetDraw();
        if (this.mode === 'console') this.console.frame();
        else this.editors[this.mode].frame();
      }
    } catch (e: any) {
      if (this.mode === 'run') this.handleError(e);
      else { console.error(e); this.toast('EDITOR ERROR: ' + (e && e.message)); }
    }

    this.g.present(this.ctx);
    this.mouse.edgeL = this.mouse.edgeR = false;
    this.mouse.wheel = 0;
  }

  /* ---------------- input ---------------- */
  onKeyDown(e: KeyboardEvent): boolean {
    this.audio.ensure();
    this.keys.shift = e.shiftKey; this.keys.ctrl = e.ctrlKey || e.metaKey; this.keys.alt = e.altKey;
    if (e.code === 'Enter' && e.altKey) { this.toggleFullscreen(); return true; }
    if (e.key === 'F6') { this.screenshot(); return true; }
    if (/^F\d+$/.test(e.key)) return false;
    this.keys.down.add(e.code); this.keys.pressed.add(e.code);
    const ctrl = this.keys.ctrl;

    if (this.mode === 'run') {
      const r = this.run;
      if (e.code === 'Escape') { this.exitRun(true); return true; }
      if (ctrl && e.code === 'KeyR') { this.startRun(this.returnMode); return true; }
      if (r.paused) { this.pauseKey(e); return true; }
      if (e.code === 'Enter' || (e.code === 'KeyP' && !ctrl)) { this.pause(); return true; }
      if (e.key.length === 1 && !ctrl) this.keyQueue.push(e.key);
      if (ctrl && (e.code === 'KeyC' || e.code === 'KeyV' || e.code === 'KeyX')) return false;
      return true;
    }

    if (ctrl && e.code === 'KeyR') { this.startRun(this.mode === 'console' ? 'console' : this.mode); return true; }
    if (ctrl && e.code === 'KeyS') { this.saveCart(this.cartName); return true; }
    if (e.altKey && (e.code === 'ArrowLeft' || e.code === 'ArrowRight') && this.mode !== 'console') {
      const i = EDITORS.indexOf(this.mode) + (e.code === 'ArrowRight' ? 1 : -1);
      this.setMode(EDITORS[(i + EDITORS.length) % EDITORS.length]);
      return true;
    }
    if (e.code === 'Escape') {
      if (this.mode === 'console') this.setMode(this.lastEditor);
      else this.setMode('console');
      return true;
    }
    if (this.mode === 'console') return this.console.key(e);
    const h = !!this.editors[this.mode].key?.(e);
    return h || e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow');
  }

  onKeyUp(e: KeyboardEvent) {
    this.keys.shift = e.shiftKey; this.keys.ctrl = e.ctrlKey || e.metaKey; this.keys.alt = e.altKey;
    this.keys.down.delete(e.code);
  }

  inputTick(fps: number) {
    const cur = [new Array(8).fill(false), new Array(8).fill(false)];
    for (const code of this.keys.down) { const k = KEYMAP[code]; if (k) cur[k[0]][k[1]] = true; }
    for (const code of this.keys.pressed) { const k = KEYMAP[code]; if (k) cur[k[0]][k[1]] = true; }
    this.keys.pressed.clear();
    for (let p = 0; p < 2; p++) for (let i = 0; i < 8; i++) {
      this.btnHold[p][i] = cur[p][i] ? this.btnHold[p][i] + 1 : 0;
    }
    this.btnCur = cur;
    this.btnFps = fps;
  }

  btnFps = 30;

  btn(i?: any, p?: any) {
    p = Math.floor(typeof p === 'number' ? p : 0);
    if (p < 0 || p > 1) return i === undefined ? 0 : false;
    if (i === undefined) return this.btnBits(0) | (this.btnBits(1) << 8);
    return !!this.btnCur[p][Math.floor(i)];
  }

  btnBits(p: number) {
    let b = 0;
    for (let k = 0; k < 8; k++) if (this.btnCur[p][k]) b |= 1 << k;
    return b;
  }

  btnp(i?: any, p?: any) {
    if (i === undefined) return this.btnBits(0) | (this.btnBits(1) << 8);
    p = Math.floor(typeof p === 'number' ? p : 0);
    if (p < 0 || p > 1) return false;
    const h = this.btnHold[p][Math.floor(i)];
    const s = this.btnFps / 30;
    return h === 1 || (h >= 15 * s && (h - 15 * s) % (4 * s) === 0);
  }

  toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else this.container?.requestFullscreen?.();
  }

  screenshot() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = false;
    x.drawImage(this.canvas, 0, 0, 512, 512);
    c.toBlob((b) => { if (b) this.download('screenshot.png', b); });
    this.toast('SCREENSHOT SAVED');
  }

  download(name: string, data: Blob | string) {
    const blob = typeof data === 'string' ? new Blob([data], { type: 'text/plain' }) : data;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------------- memory ---------------- */
  peek(a: any) { a = Math.floor(typeof a === 'number' ? a : 0); return a < 0 || a > 0xffff ? 0 : this.mem[a]; }
  peek2(a: any) { a = Math.floor(a); if (a < 0 || a > 0xfffe) return 0; const v = this.mem[a] | (this.mem[a + 1] << 8); return v >= 0x8000 ? v - 0x10000 : v; }
  peek4(a: any) { a = Math.floor(a); if (a < 0 || a > 0xfffc) return 0; const m = this.mem; return ((m[a] | (m[a + 1] << 8) | (m[a + 2] << 16) | (m[a + 3] << 24)) | 0) / 65536; }

  poke(a: number, v: number) {
    a = Math.floor(a);
    if (a < 0 || a > 0xffff) throw lua.rtError('bad memory access');
    this.mem[a] = Math.floor(v) & 255;
    if (a >= 0x5f20 && a < 0x5f30) this.syncState();
  }

  syncState() {
    const m = this.mem, g = this.g;
    g.col = m[0x5f25];
    g.cx0 = m[0x5f20]; g.cy0 = m[0x5f21]; g.cx1 = Math.min(128, m[0x5f22]); g.cy1 = Math.min(128, m[0x5f23]);
    const cx = m[0x5f28] | (m[0x5f29] << 8), cy = m[0x5f2a] | (m[0x5f2b] << 8);
    g.camX = cx >= 0x8000 ? cx - 0x10000 : cx; g.camY = cy >= 0x8000 ? cy - 0x10000 : cy;
  }

  /* ---------------- Lua API ---------------- */
  installApi(G: any) {
    const g = this.g, mem = this.mem, audio = this.audio, m = this;
    const num = (v: any, d = 0) => (typeof v === 'number' ? v : typeof v === 'string' ? (str2num(v) ?? d) : v === true ? 1 : d);
    const opt = (v: any) => (v === undefined ? undefined : num(v));
    const bool = (v: any) => v !== undefined && v !== false;

    G.cls = (c: any) => {
      if (m.mode === 'console') {
        m.console.clear(num(c));
        return;
      }
      g.cls(num(c));
      if (m.run) m.run.promptY = g.curY;
    };
    G.pset = (x: any, y: any, c: any) => g.pset(num(x), num(y), opt(c));
    G.pget = (x: any, y: any) => g.pget(num(x), num(y));
    G.line = (a: any, b: any, c: any, d: any, e: any) => g.line(opt(a), opt(b), opt(c), opt(d), opt(e));
    G.rect = (a: any, b: any, c: any, d: any, e: any) => g.rect(num(a), num(b), num(c, num(a)), num(d, num(b)), opt(e));
    G.rectfill = (a: any, b: any, c: any, d: any, e: any) => g.rectfill(num(a), num(b), num(c, num(a)), num(d, num(b)), opt(e));
    G.circ = (x: any, y: any, r: any, c: any) => g.circ(num(x), num(y), num(r, 4), opt(c));
    G.circfill = (x: any, y: any, r: any, c: any) => g.circfill(num(x), num(y), num(r, 4), opt(c));
    G.oval = (a: any, b: any, c: any, d: any, e: any) => g.oval(num(a), num(b), num(c), num(d), opt(e), false);
    G.ovalfill = (a: any, b: any, c: any, d: any, e: any) => g.oval(num(a), num(b), num(c), num(d), opt(e), true);
    G.spr = (n: any, x: any, y: any, w: any, h: any, fx: any, fy: any) => g.spr(num(n), num(x), num(y), num(w, 1), num(h, 1), bool(fx), bool(fy));
    G.sspr = (a: any, b: any, c: any, d: any, e: any, f: any, h: any, i: any, fx: any, fy: any) => g.sspr(num(a), num(b), num(c), num(d), num(e), num(f), opt(h), opt(i), bool(fx), bool(fy));
    G.map = (a: any, b: any, c: any, d: any, e: any, f: any, h: any) => g.map(num(a), num(b), num(c), num(d), num(e, 128), num(f, 64), num(h));
    G.mapdraw = G.map;
    G.tline = (x0: any, y0: any, x1: any, y1: any, mx: any, my: any, mdx: any, mdy: any, layers: any) => {
      if (y0 === undefined) {
        if (x0 !== undefined) g.setTlineBits(num(x0));
        return;
      }
      g.tline(num(x0), num(y0), num(x1), num(y1), num(mx), num(my), opt(mdx), opt(mdy), opt(layers));
    };
    G.mget = (x: any, y: any) => g.mget(num(x), num(y));
    G.mset = (x: any, y: any, v: any) => g.mset(num(x), num(y), num(v));
    G.fget = (n: any, b: any) => g.fget(num(n), opt(b));
    G.fset = (n: any, b: any, v: any) => g.fset(num(n), b, v);
    G.sget = (x: any, y: any) => g.sget(num(x), num(y));
    G.sset = (x: any, y: any, c: any) => g.sset(num(x), num(y), num(c));

    G.print = (s: any, x: any, y: any, c: any) => {
      if (m.mode === 'console') { m.console.print(tostr(s)); return; }

      const py = opt(y);
      const previousY = g.curY;
      const result = py === undefined
        ? g.print(s, undefined, undefined, opt(c) ?? opt(x))
        : g.print(s, opt(x), py, opt(c));

      if (m.run) {
        // Usa el cursor real de Gfx. Si un PRINT con posición explícita
        // no lo mueve, guarda igualmente la línea siguiente para el prompt.
        if (py !== undefined && g.curY === previousY) {
          const lines = typeof s === 'string' ? s.split('\n').length : 1;
          m.run.promptY = Math.floor(py) + lines * TEXT_LINE_HEIGHT;
        } else {
          m.run.promptY = g.curY;
        }
      }
      return result;
    };

    G.cursor = (x: any, y: any, c: any) => {
      g.curX = num(x);
      g.curY = num(y);
      if (c !== undefined) g.setc(num(c));
      if (m.run) m.run.promptY = g.curY;
    };

    G.color = (c: any) => { const o = g.col; g.setc(num(c, 6)); return o; };
    G.camera = (x: any, y: any) => { g.camX = Math.floor(num(x)); g.camY = Math.floor(num(y)); };
    G.clip = (x: any, y: any, w: any, h: any) => g.clip(opt(x), opt(y), opt(w), opt(h));
    G.pal = (a: any, b: any, p: any) => g.pal(a instanceof LuaTable ? a : opt(a), b instanceof LuaTable ? b : opt(b), p instanceof LuaTable ? 0 : opt(p));
    G.palt = (a: any, t: any) => g.palt(opt(a), t);
    G.fillp = (p: any) => g.fillpat(num(p));
    G.flip = lua.FLIP;
    G.reset = () => { g.resetDraw(); };
    G.btn = (i: any, p: any) => m.btn(i, p);
    G.btnp = (i: any, p: any) => m.btnp(i, p);
    G.sfx = (n: any, c: any, o: any, l: any) => audio.sfx(num(n), num(c, -1), num(o), num(l));
    G.music = (n: any, f: any, mk: any) => audio.playMusic(num(n), num(f), num(mk));

    G.peek = (a: any, n: any) => {
      if (n === undefined) return m.peek(a);
      const r = [];
      for (let i = 0; i < Math.min(num(n), 8192); i++) r.push(m.peek(num(a) + i));
      return new MR(r);
    };
    G.poke = (a: any, ...v: any[]) => { a = num(a); v.forEach((x, i) => m.poke(a + i, num(x))); };
    G.peek2 = (a: any) => m.peek2(num(a));
    G.peek4 = (a: any) => m.peek4(num(a));
    G.poke2 = (a: any, v: any) => { a = Math.floor(num(a)); v = Math.floor(num(v)); m.poke(a, v & 255); m.poke(a + 1, (v >> 8) & 255); };
    G.poke4 = (a: any, v: any) => { a = Math.floor(num(a)); v = Math.round(num(v) * 65536); for (let i = 0; i < 4; i++) m.poke(a + i, (v >> (8 * i)) & 255); };
    G.memcpy = (d: any, s: any, l: any) => {
      d = Math.floor(num(d)); s = Math.floor(num(s)); l = Math.floor(num(l));
      if (l <= 0 || d < 0 || s < 0) return;
      l = Math.min(l, 65536 - d, 65536 - s);
      mem.copyWithin(d, s, s + l);
      if (d <= 0x5f2f && d + l > 0x5f20) m.syncState();
    };
    G.memset = (d: any, v: any, l: any) => {
      d = Math.floor(num(d)); l = Math.floor(num(l));
      if (l <= 0 || d < 0) return;
      mem.fill(num(v) & 255, d, Math.min(65536, d + l));
      if (d <= 0x5f2f && d + l > 0x5f20) m.syncState();
    };
    G.reload = (d: any, s: any, l: any) => {
      d = Math.floor(num(d)); s = Math.floor(num(s)); l = Math.floor(num(l, ROM_SIZE));
      if (!m.snapshot) return;
      l = Math.min(l, ROM_SIZE - s, ROM_SIZE - d);
      if (l > 0) mem.set(m.snapshot.subarray(s, s + l), d);
    };
    G.cstore = (d: any, s: any, l: any) => {
      d = Math.floor(num(d)); s = Math.floor(num(s)); l = Math.floor(num(l, ROM_SIZE));
      if (!m.snapshot) return;
      l = Math.min(l, ROM_SIZE - s, ROM_SIZE - d);
      if (l > 0) m.snapshot.set(mem.subarray(s, s + l), d);
    };

    G.time = G.t = () => (m.run ? m.run.frame / m.run.fps : 0);
    G.printh = (s: any) => { console.log(tostr(s)); };
    G.extcmd = (c: any) => { if (c === 'screen') m.screenshot(); else if (c === 'reset') m.run && (m.run.restart = true); else if (c === 'pause') m.pause(); };
    G.run = () => { if (m.run) m.run.restart = true; };
    G.stop = (msg: any) => { if (m.run) { m.run.stopMsg = msg === undefined ? '' : tostr(msg); m.run.stop = true; } };
    G.menuitem = (i: any, label: any, cb: any) => {
      if (!m.run) return;
      i = Math.floor(num(i));
      if (i < 1 || i > 5) return;
      m.run.menu[i] = label === undefined ? undefined : { label: tostr(label), cb };
    };

    G.cartdata = (id: any) => {
      m.cartDataId = tostr(id);
      try {
        const arr = JSON.parse(localStorage.getItem('p8web.cartdata.' + m.cartDataId) || '[]');
        for (let i = 0; i < 64; i++) {
          const v = Math.round((arr[i] || 0) * 65536);
          for (let k = 0; k < 4; k++) mem[0x5e00 + i * 4 + k] = (v >> (8 * k)) & 255;
        }
      } catch {}
      return true;
    };
    G.dget = (i: any) => m.peek4(0x5e00 + (Math.floor(num(i)) & 63) * 4);
    G.dset = (i: any, v: any) => {
      i = Math.floor(num(i)) & 63;
      G.poke4(0x5e00 + i * 4, v);
      if (m.cartDataId) {
        try {
          const arr = [];
          for (let k = 0; k < 64; k++) arr.push(m.peek4(0x5e00 + k * 4));
          localStorage.setItem('p8web.cartdata.' + m.cartDataId, JSON.stringify(arr));
        } catch {}
      }
    };

    G.stat = (n: any) => {
      n = Math.floor(num(n));
      const now = new Date();
      switch (n) {
        case 0: return 128; case 1: return 0.05; case 2: return 0.02; case 4: return '';
        case 5: return 42; case 6: return ''; case 7: return m.fpsReal; case 8: case 9: return m.run ? m.run.fps : 30;
        case 16: case 17: case 18: case 19: return audio.chanSfx(n - 16);
        case 20: case 21: case 22: case 23: return audio.chanNote(n - 20);
        case 24: return audio.music.playing ? audio.music.pat : -1;
        case 30: return m.keyQueue.length > 0;
        case 31: return m.keyQueue.shift() || '';
        case 32: return m.mouse.x; case 33: return m.mouse.y;
        case 34: return (m.mouse.l ? 1 : 0) | (m.mouse.r ? 2 : 0) | (m.mouse.m ? 4 : 0);
        case 36: return m.mouse.wheel;
        case 46: case 47: case 48: case 49: return audio.chanSfx(n - 46);
        case 50: case 51: case 52: case 53: return audio.chanNote(n - 50);
        case 54: return audio.music.playing ? audio.music.pat : -1;
        case 80: return now.getUTCFullYear(); case 81: return now.getUTCMonth() + 1; case 82: return now.getUTCDate();
        case 83: return now.getUTCHours(); case 84: return now.getUTCMinutes(); case 85: return now.getUTCSeconds();
        case 90: return now.getFullYear(); case 91: return now.getMonth() + 1; case 92: return now.getDate();
        case 93: return now.getHours(); case 94: return now.getMinutes(); case 95: return now.getSeconds();
      }
      return 0;
    };

    G._G = lua.globalsTable(G);
    return G;
  }

  /* ---------------- running carts ---------------- */
  getRomData(): Uint8Array { return this.snapshot && (this.run || this.paused) ? this.snapshot : this.mem.slice(0, ROM_SIZE); }
  getCart(): Cart { return { code: this.editors.code.getText(), data: this.getRomData().slice() }; }

  startRun(from: string) {
    this.audio.ensure();
    let promptY: number;

    if (this.run) {
      if (this.run.paused) this.leavePause();
      promptY = this.run.promptY;
      if (this.snapshot) this.mem.set(this.snapshot, 0);
    } else {
      if (this.mode === 'console') this.console.detach();
      else this.restoreConsoleScreen();
      promptY = this.console.promptY;
    }

    this.paused = null;
    const code = this.editors.code.getText();
    this.audio.stopAll();
    this.snapshot = this.mem.slice(0, ROM_SIZE);
    this.clearRamKeepingScreen();
    this.keyQueue = [];
    this.g.resetDraw();
	this.g.curX = 0;
	this.g.curY = promptY;
	// RUN reinicia el estado de dibujo, pero conserva la posición
	// de escritura de la consola. No ejecuta CLS.

    const G = lua.makeGlobals();
    this.installApi(G);
    const gen = lua.usesCoroutines(code);
    this.returnMode = from === 'run' ? this.returnMode : from;
    const rs: any = {
      G, gen, promptY, frame: 0, acc: 0, fps: 30,
      paused: false, menu: [], menuSel: 0, shot: null,
      restart: false, stop: false, stopMsg: '', boot: null,
    };
    this.run = rs;
    this.mode = 'run';
    this.onModeChange && this.onModeChange('run');
    this.btnCur = [new Array(8).fill(false), new Array(8).fill(false)];
    this.btnHold = [new Array(8).fill(0), new Array(8).fill(0)];

    try {
      const main = lua.compileLua(code, G, gen);
      rs.boot = lua.bootSeq(main, G);
      this.stepBoot(); // bootSeq también ejecuta _init, una sola vez.
    } catch (e) { this.handleError(e); return; }

    this.last = performance.now();
  }

  /** Avanza el chunk principal/_init hasta el siguiente flip() o hasta terminar. */
  stepBoot() {
    const r = this.run;
    if (!r || !r.boot) return;
    lua.guard.start = performance.now();
    try {
      const res = r.boot.next();
      if (res.done) r.boot = null;
    } catch (e) {
      r.boot = null;
      throw e;
    } finally {
      lua.guard.start = 0;
    }
  }

    runFrame(dt: number) {
    const r = this.run;
    if (!r) return;
    if (r.paused) { this.drawPause(); return; }
    const G = r.G;
    const u60 = G._update60, u = G._update, d = G._draw;
    r.fps = u60 ? 60 : 30;
    const step = 1000 / r.fps;
    if (r.boot) {
      // Chunk principal / _init todavía en marcha (usa flip()).
      r.acc = Math.min(r.acc + dt, step * 4);
      if (r.acc >= step - 0.5) {
        r.acc = Math.min(r.acc - step, step);
        this.inputTick(r.fps);
        r.frame++;
        this.stepBoot();
      }
    } else if (u60 || u || d) {
      // Cart con bucle: se comporta exactamente como antes.
      r.acc = Math.min(r.acc + dt, step * 4);
      let updated = false;
      while (r.acc >= step - 0.5) {
        r.acc -= step;
        this.inputTick(r.fps);
        r.frame++;
        lua.guard.start = performance.now();
        if (typeof u60 === 'function') lua.callSync(u60);
        else if (typeof u === 'function') lua.callSync(u);
        updated = true;
        if (r.stop || r.restart) break;
      }
      if (updated && typeof d === 'function' && !r.stop && !r.restart) {
        lua.guard.start = performance.now();
        lua.callSync(d);
      }
      lua.guard.start = 0;
    } else if (!r.stop && !r.restart) {
      // Sin _update/_update60/_draw y con el chunk ya terminado, el programa
      // acaba. Vuelve a la consola conservando el framebuffer; el prompt
      // aparece en r.promptY (la línea siguiente al último print/cursor).
      this.exitRun(false, true);
      return;
    }
    if (r.restart) { this.startRun(this.returnMode); return; }
    if (r.stop) {
      const msg = r.stopMsg;
      this.exitRun(false);
      if (msg) this.console.print(msg, 7);
    }
  }
  exitRun(keep: boolean, toConsole = keep) {
    const r = this.run;
    if (!r) return;

    // Si Escape se pulsa en el menú de pausa, conserva la imagen
    // del cart, no los rectángulos dibujados por ese menú.
    if (r.paused) this.leavePause();

    this.audio.stopAll();
    this.paused = keep
      ? { mem: this.mem.slice(), gstate: this.g.saveState(), run: r }
      : null;

    if (this.snapshot) this.mem.set(this.snapshot, 0);
    this.clearRamKeepingScreen();
    this.run = null;
    this.g.resetDraw();

    this.console.useFramebuffer(r.promptY);
    this.mode = toConsole || this.returnMode === 'run' ? 'console' : this.returnMode;
    this.consoleScreen = this.mode === 'console' ? null : this.readScreen();
    this.onModeChange && this.onModeChange(this.mode);
  }

  resume() {
    const p = this.paused;
    if (!p) return false;

    if (this.mode === 'console') this.console.detach();
    this.consoleScreen = null;
    this.snapshot = this.mem.slice(0, ROM_SIZE);
    this.mem.set(p.mem);
    this.g.loadState(p.gstate);
    this.run = p.run;
    this.run.paused = false;
    this.run.acc = 0;
    this.paused = null;
    this.mode = 'run';
    this.last = performance.now();
    this.onModeChange && this.onModeChange('run');
    return true;
  }

  handleError(e: any) {
    const line = e instanceof LuaError ? e.line || lua.L.v : lua.L.v;
    const msg = String(lua.errValue(e));
    const syntax = /^(syntax error|unexpected symbol|unfinished|goto|internal compile|.* expected)/.test(msg);
    lua.guard.start = 0;
    if (this.run) {
      this.run.stop = true;
      this.exitRun(false, true);
    } else if (this.mode !== 'console') {
      this.setMode('console');
    }
    this.console.print((syntax ? 'SYNTAX ERROR' : 'RUNTIME ERROR') + ' LINE ' + line, 8);
    this.console.print(msg, 14);
    this.console.print('(PRESS ESC TO EDIT CODE)', 6);
    this.editors.code.gotoLine(line);
    this.lastEditor = 'code';
    if (!(e instanceof LuaError)) console.error(e);
  }

  /* ---------------- pause menu ---------------- */
  pause() {
    const r = this.run;
    if (!r || r.paused) return;
    r.paused = true; r.menuSel = 0;
    r.shot = this.readScreen();
    this.audio.stopAll();
  }

  private leavePause() {
    const r = this.run;
    if (!r || !r.paused) return;
    if (r.shot) this.mem.set(r.shot, SCREEN_START);
    r.paused = false;
    r.shot = null;
    r.acc = 0;
  }

  pauseItems() {
    const r = this.run;
    const items: any[] = [{ label: 'CONTINUE', act: 'cont' }];
    for (let i = 1; i <= 5; i++) if (r.menu[i]) items.push({ label: r.menu[i].label, act: 'user', cb: r.menu[i].cb, idx: i });
    items.push({ label: 'SOUND: ' + (this.audio.muted ? 'OFF' : 'ON'), act: 'sound' });
    items.push({ label: 'RESET CART', act: 'reset' });
    items.push({ label: 'EXIT', act: 'exit' });
    return items;
  }

  pauseKey(e: KeyboardEvent) {
    const r = this.run, items = this.pauseItems();
    if (e.code === 'Escape' || e.code === 'KeyP') { this.leavePause(); return; }
    if (e.code === 'ArrowUp') r.menuSel = (r.menuSel + items.length - 1) % items.length;
    else if (e.code === 'ArrowDown') r.menuSel = (r.menuSel + 1) % items.length;
    else if (['Enter', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyN', 'KeyM'].includes(e.code)) {
      const it = items[r.menuSel];
      switch (it.act) {
        case 'cont': this.leavePause(); break;
        case 'sound': this.audio.muted = !this.audio.muted; break;
        case 'reset': this.startRun(this.returnMode); break;
        case 'exit': this.exitRun(false); break;
        case 'user': {
          let keep = false;
          try { keep = lua.T(lua.S(lua.callSync(it.cb, 0))); } catch (err) { this.handleError(err); return; }
          if (!keep) this.leavePause();
          break;
        }
      }
    } else if (it_isLR(e.code)) {
      const it = items[r.menuSel];
      if (it.act === 'sound') this.audio.muted = !this.audio.muted;
      if (it.act === 'user') {
        try { lua.callSync(it.cb, e.code === 'ArrowLeft' ? 1 : 2); }
        catch (err) { this.handleError(err); }
      }
    }
  }

  drawPause() {
    const r = this.run, g = this.g;
    if (!r || !r.shot) return;
    this.mem.set(r.shot, SCREEN_START);
    const state = g.saveState();
    const registers = this.mem.slice(0x5f00, SCREEN_START);

    try {
      g.resetDraw();
      const items = this.pauseItems();
      const h = items.length * 8 + 10, w = 84;
      const x = 64 - w / 2, y = 64 - h / 2;
      g.rectfill(x, y, x + w, y + h, 0);
      g.rect(x, y, x + w, y + h, 7);
      items.forEach((it, i) => {
        const sel = i === r.menuSel;
        g.print(it.label, x + 12, y + 6 + i * 8, sel ? 7 : 6);
        if (sel) g.glyph('>', x + 5, y + 6 + i * 8, 10);
      });
    } finally {
      this.mem.set(registers, 0x5f00);
      g.loadState(state);
    }
  }

  /* ---------------- console eval ---------------- */
  execLua(src: string) {
    // Asienta el eco del comando antes de que Lua dibuje o toque la VRAM.
    if (this.mode === 'console') this.console.detach();
    const G = this.paused ? this.paused.run.G : (this.consoleG || (this.consoleG = this.installApi(lua.makeGlobals())));
    const gen = this.paused ? this.paused.run.gen : false;

    try {
      lua.guard.start = performance.now();
      let fn;
      try { fn = lua.compileLua('return ' + src, G, gen); } catch { fn = lua.compileLua(src, G, gen); }
      const r = lua.callSync(fn);
      lua.guard.start = 0;
      if (r !== undefined) lua.M(r).forEach((v) => this.console.print(tostr(v), 7));
    } catch (e: any) {
      lua.guard.start = 0;
      this.console.print(String(lua.errValue(e)).toUpperCase(), 8);
    }
  }

  /* ---------------- cart storage ---------------- */
  drive(): Record<string, string> { try { return JSON.parse(localStorage.getItem(DRIVE) || '{}'); } catch { return {}; } }
  saveDrive(d: Record<string, string>) { try { localStorage.setItem(DRIVE, JSON.stringify(d)); return true; } catch { return false; } }
  cleanName(n: string) { return n.replace(/\.p8(\.png)?$/i, '').replace(/\.txt$/i, '').replace(/[^\w\-. ]/g, '_'); }
  serialize() { const c = this.getCart(); return serializeP8(c.code, c.data); }

  saveCart(name: string) {
    name = this.cleanName(name || '');
    if (!name) {
      this.toast('NO FILENAME. USE: SAVE NAME');
      this.console.print('USE: SAVE <NAME>', 8);
      return false;
    }
    const d = this.drive();
    d[name] = this.serialize();
    if (!this.saveDrive(d)) { this.toast('SAVE FAILED'); return false; }
    this.cartName = name;
    this.toast('SAVED ' + name.toUpperCase() + '.P8');
    if (this.mode === 'console') this.console.print('SAVED ' + name.toUpperCase() + '.P8', 6);
    return true;
  }

  loadCartObj(c: Cart, name: string) {
    this.paused = null;
    if (this.run) this.exitRun(false);
    this.clearRamKeepingScreen(0);
    this.mem.set(c.data.subarray(0, ROM_SIZE));
    this.editors.code.setText(c.code);
    this.cartName = name;
    this.g.resetDraw();
    for (const k of ['sprite', 'map', 'sfx', 'music']) this.editors[k].reset?.();
  }

  loadByName(name: string): boolean {
    const n = this.cleanName(name);
    if (n.toLowerCase() === 'demo') { this.loadCartObj(demoCart(), 'demo'); return true; }
    if (['pseudo3d', 'tline', 'mode7'].includes(n.toLowerCase())) {
      this.loadCartObj(pseudo3dCart(), 'pseudo3d');
      return true;
    }
    const d = this.drive();
    if (d[n] === undefined) return false;
    this.loadCartObj(parseP8(d[n]), n);
    return true;
  }

  loadText(filename: string, text: string) {
    if (/\.png$/i.test(filename)) {
      this.console.print('PNG CARTS NOT SUPPORTED', 8);
      this.toast('USE .P8 TEXT CARTS');
      return;
    }
    const cart = /\.lua$/i.test(filename) ? { code: text, data: newCart().data } : parseP8(text);
    const name = this.cleanName(filename);
    this.loadCartObj(cart, name);
    this.setMode('console');
    this.console.print('LOADED ' + name.toUpperCase() + '.P8', 6);
    this.console.print('(TYPE RUN OR PRESS CTRL-R)', 6);
  }

  openFileDialog() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.p8,.txt,.lua';
    inp.onchange = async () => { const f = inp.files?.[0]; if (f) this.loadText(f.name, await f.text()); };
    inp.click();
  }

  exportCart(name?: string) {
    const n = this.cleanName(name || this.cartName || 'untitled');
    this.download(n + '.p8', this.serialize());
    this.console.print('EXPORTED ' + n.toUpperCase() + '.P8', 6);
  }

  newCartCmd() {
    this.loadCartObj(newCart(), '');
  }
}

const it_isLR = (c: string) => c === 'ArrowLeft' || c === 'ArrowRight';
