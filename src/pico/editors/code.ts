// @ts-nocheck
import { topBar, topBarClick, bottomBar, clamp } from '../ui';
import { countTokens } from '../lua';

const KW = new Set('and break do else elseif end false for function goto if in local nil not or repeat return then true until while'.split(' '));
const API = new Set(('print cls pset pget line rect rectfill circ circfill oval ovalfill spr sspr map mapdraw mget mset fget fset sget sset ' +
  'cursor color camera clip pal palt fillp btn btnp sfx music peek poke peek2 poke2 peek4 poke4 memcpy memset reload cstore time t stat ' +
  'printh menuitem cartdata dget dset extcmd run stop reset flip add del deli count foreach all pairs ipairs next select unpack pack ' +
  'setmetatable getmetatable rawget rawset rawequal rawlen type tostr tonum sub split chr ord flr ceil abs sqrt sgn min max mid sin cos ' +
  'atan2 rnd srand band bor bxor bnot shl shr lshr rotl rotr cocreate coresume costatus yield assert error pcall _init _update _update60 _draw').split(' '));

const COLS = 32, ROWS = 18, Y0 = 9;

export class CodeEditor {
  m: any;
  lines: string[] = [''];
  cx = 0; cy = 0; sx = 0; sy = 0;
  anchor: { x: number; y: number } | null = null;
  undoS: any[] = []; redoS: any[] = [];
  lastKind = ''; lastT = 0;
  colors: Uint8Array[] = []; ver = 0; colorVer = -1;
  tok = 0; tokVer = -1;
  dragging = false; needScroll = false; errLine = 0;

  constructor(m: any) { this.m = m; }
  getText() { return this.lines.join('\n'); }
  setText(t: string) {
    this.lines = t.replace(/\r/g, '').replace(/\t/g, '  ').split('\n');
    this.cx = this.cy = this.sx = this.sy = 0;
    this.anchor = null; this.undoS = []; this.redoS = []; this.errLine = 0; this.ver++;
  }
  gotoLine(n: number) {
    this.cy = clamp(n - 1, 0, this.lines.length - 1); this.cx = 0; this.sx = 0;
    this.sy = Math.max(0, this.cy - 8); this.anchor = null; this.errLine = n;
  }
  enter() { this.needScroll = true; }

  /* ---- selection helpers ---- */
  hasSel() { return !!this.anchor && (this.anchor.x !== this.cx || this.anchor.y !== this.cy); }
  selRange() {
    const a = this.anchor!, c = { x: this.cx, y: this.cy };
    return a.y < c.y || (a.y === c.y && a.x <= c.x) ? [a, c] : [c, a];
  }
  selText() {
    if (!this.hasSel()) return '';
    const [a, b] = this.selRange();
    if (a.y === b.y) return this.lines[a.y].slice(a.x, b.x);
    const out = [this.lines[a.y].slice(a.x)];
    for (let y = a.y + 1; y < b.y; y++) out.push(this.lines[y]);
    out.push(this.lines[b.y].slice(0, b.x));
    return out.join('\n');
  }
  deleteSel() {
    if (!this.hasSel()) { this.anchor = null; return false; }
    const [a, b] = this.selRange();
    this.lines.splice(a.y, b.y - a.y + 1, this.lines[a.y].slice(0, a.x) + this.lines[b.y].slice(b.x));
    this.cx = a.x; this.cy = a.y; this.anchor = null;
    return true;
  }
  insertText(s: string) {
    this.deleteSel();
    const parts = s.split('\n');
    const ln = this.lines[this.cy];
    if (parts.length === 1) { this.lines[this.cy] = ln.slice(0, this.cx) + s + ln.slice(this.cx); this.cx += s.length; return; }
    const tail = ln.slice(this.cx);
    this.lines[this.cy] = ln.slice(0, this.cx) + parts[0];
    const mid = parts.slice(1, -1);
    const last = parts[parts.length - 1];
    this.lines.splice(this.cy + 1, 0, ...mid, last + tail);
    this.cy += parts.length - 1; this.cx = last.length;
  }

  /* ---- undo ---- */
  snap() { return { lines: this.lines.slice(), cx: this.cx, cy: this.cy }; }
  pushUndo(kind: string) {
    const now = performance.now();
    if (!(kind === 'type' && this.lastKind === 'type' && now - this.lastT < 900)) {
      this.undoS.push(this.snap());
      if (this.undoS.length > 100) this.undoS.shift();
    }
    this.lastKind = kind; this.lastT = now; this.redoS = [];
  }
  restore(s: any) { this.lines = s.lines.slice(); this.cx = s.cx; this.cy = s.cy; this.anchor = null; this.ver++; this.needScroll = true; this.lastKind = ''; }
  undo() { if (!this.undoS.length) return; this.redoS.push(this.snap()); this.restore(this.undoS.pop()); }
  redo() { if (!this.redoS.length) return; this.undoS.push(this.snap()); this.restore(this.redoS.pop()); }
  edit(kind: string, fn: () => void) { this.pushUndo(kind); fn(); this.ver++; this.needScroll = true; this.errLine = 0; }

  paste(text: string) {
    const t = text.replace(/\r/g, '').replace(/\t/g, '  ');
    this.edit('paste', () => this.insertText(t));
  }

  /* ---- keys ---- */
  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey, shift = e.shiftKey;
    const L = this.lines;
    const startSel = () => { if (shift) { if (!this.anchor) this.anchor = { x: this.cx, y: this.cy }; } else if (!this.hasSel()) this.anchor = null; };
    const moved = () => { this.needScroll = true; if (!shift) this.anchor = null; };
    if (ctrl) {
      switch (e.code) {
        case 'KeyA': this.anchor = { x: 0, y: 0 }; this.cy = L.length - 1; this.cx = L[this.cy].length; return true;
        case 'KeyZ': shift ? this.redo() : this.undo(); return true;
        case 'KeyY': this.redo(); return true;
        case 'KeyC': if (this.hasSel()) this.m.copy(this.selText()); return false;
        case 'KeyX': if (this.hasSel()) { this.m.copy(this.selText()); this.edit('cut', () => this.deleteSel()); } return false;
        case 'KeyV': return false;
        case 'KeyD': this.edit('dup', () => { L.splice(this.cy + 1, 0, L[this.cy]); this.cy++; }); return true;
        case 'ArrowLeft': case 'ArrowRight': {
          startSel();
          const dir = e.code === 'ArrowLeft' ? -1 : 1;
          let ln = L[this.cy], x = this.cx;
          if (dir < 0) { while (x > 0 && !/\w/.test(ln[x - 1])) x--; while (x > 0 && /\w/.test(ln[x - 1])) x--; }
          else { while (x < ln.length && !/\w/.test(ln[x])) x++; while (x < ln.length && /\w/.test(ln[x])) x++; }
          this.cx = x; moved(); return true;
        }
        case 'Home': startSel(); this.cx = 0; this.cy = 0; moved(); return true;
        case 'End': startSel(); this.cy = L.length - 1; this.cx = L[this.cy].length; moved(); return true;
        case 'Backspace': {
          if (this.hasSel()) { this.edit('del', () => this.deleteSel()); return true; }
          this.edit('del', () => { let x = this.cx; const ln = L[this.cy]; while (x > 0 && !/\w/.test(ln[x - 1])) x--; while (x > 0 && /\w/.test(ln[x - 1])) x--; L[this.cy] = ln.slice(0, x) + ln.slice(this.cx); this.cx = x; });
          return true;
        }
      }
      return false;
    }
    switch (e.code) {
      case 'ArrowLeft':
        if (!shift && this.hasSel()) { const [a] = this.selRange(); this.cx = a.x; this.cy = a.y; this.anchor = null; this.needScroll = true; return true; }
        startSel();
        if (this.cx > 0) this.cx--; else if (this.cy > 0) { this.cy--; this.cx = L[this.cy].length; }
        moved(); return true;
      case 'ArrowRight':
        if (!shift && this.hasSel()) { const [, b] = this.selRange(); this.cx = b.x; this.cy = b.y; this.anchor = null; this.needScroll = true; return true; }
        startSel();
        if (this.cx < L[this.cy].length) this.cx++; else if (this.cy < L.length - 1) { this.cy++; this.cx = 0; }
        moved(); return true;
      case 'ArrowUp': startSel(); if (this.cy > 0) { this.cy--; this.cx = Math.min(this.cx, L[this.cy].length); } else this.cx = 0; moved(); return true;
      case 'ArrowDown': startSel(); if (this.cy < L.length - 1) { this.cy++; this.cx = Math.min(this.cx, L[this.cy].length); } else this.cx = L[this.cy].length; moved(); return true;
      case 'Home': {
        startSel();
        const ind = L[this.cy].length - L[this.cy].trimStart().length;
        this.cx = this.cx === ind ? 0 : ind; moved(); return true;
      }
      case 'End': startSel(); this.cx = L[this.cy].length; moved(); return true;
      case 'PageUp': startSel(); this.cy = Math.max(0, this.cy - ROWS + 1); this.cx = Math.min(this.cx, L[this.cy].length); this.sy = Math.max(0, this.sy - ROWS + 1); moved(); return true;
      case 'PageDown': startSel(); this.cy = Math.min(L.length - 1, this.cy + ROWS - 1); this.cx = Math.min(this.cx, L[this.cy].length); this.sy = Math.min(Math.max(0, L.length - ROWS), this.sy + ROWS - 1); moved(); return true;
      case 'Backspace':
        this.edit('del', () => {
          if (this.deleteSel()) return;
          if (this.cx > 0) { L[this.cy] = L[this.cy].slice(0, this.cx - 1) + L[this.cy].slice(this.cx); this.cx--; }
          else if (this.cy > 0) { const p = L[this.cy - 1].length; L[this.cy - 1] += L[this.cy]; L.splice(this.cy, 1); this.cy--; this.cx = p; }
        });
        return true;
      case 'Delete':
        this.edit('del', () => {
          if (this.deleteSel()) return;
          if (this.cx < L[this.cy].length) L[this.cy] = L[this.cy].slice(0, this.cx) + L[this.cy].slice(this.cx + 1);
          else if (this.cy < L.length - 1) { L[this.cy] += L[this.cy + 1]; L.splice(this.cy + 1, 1); }
        });
        return true;
      case 'Enter': case 'NumpadEnter':
        this.edit('enter', () => {
          this.deleteSel();
          const ln = L[this.cy];
          const ind = ln.match(/^ */)![0].slice(0, this.cx);
          this.insertText('\n' + ind);
        });
        return true;
      case 'Tab':
        this.edit('tab', () => {
          if (this.hasSel() && this.selRange()[0].y !== this.selRange()[1].y) {
            const [a, b] = this.selRange();
            for (let y = a.y; y <= b.y; y++) {
              if (shift) L[y] = L[y].replace(/^ {1,2}/, ''); else L[y] = '  ' + L[y];
            }
            this.anchor = { x: 0, y: a.y }; this.cy = b.y; this.cx = L[b.y].length;
          } else if (shift) { const l0 = L[this.cy].length; L[this.cy] = L[this.cy].replace(/^ {1,2}/, ''); this.cx = Math.max(0, this.cx - (l0 - L[this.cy].length)); }
          else this.insertText('  ');
        });
        return true;
    }
    if ((e.key.length === 1 && !e.altKey) || (e.key.length === 1 && e.getModifierState && e.getModifierState('AltGraph'))) {
      this.edit('type', () => this.insertText(e.key));
      return true;
    }
    return false;
  }

  /* ---- highlighting ---- */
  computeColors() {
    const out: Uint8Array[] = [];
    let inLong = 0;
    for (const ln of this.lines) {
      const c = new Uint8Array(ln.length).fill(7);
      let i = 0;
      if (inLong) {
        const e = ln.indexOf(']]');
        const col = inLong === 1 ? 13 : 9;
        if (e < 0) { c.fill(col); out.push(c); continue; }
        c.fill(col, 0, e + 2); i = e + 2; inLong = 0;
      }
      while (i < ln.length) {
        const ch = ln[i];
        if ((ch === '-' && ln[i + 1] === '-') || (ch === '/' && ln[i + 1] === '/')) {
          if (ch === '-' && ln.startsWith('[[', i + 2)) {
            const e = ln.indexOf(']]', i + 4);
            if (e < 0) { c.fill(13, i); inLong = 1; i = ln.length; } else { c.fill(13, i, e + 2); i = e + 2; }
          } else { c.fill(13, i); i = ln.length; }
          continue;
        }
        if (ch === '"' || ch === "'") {
          let j = i + 1;
          while (j < ln.length && ln[j] !== ch) { if (ln[j] === '\\') j++; j++; }
          c.fill(9, i, Math.min(ln.length, j + 1)); i = j + 1; continue;
        }
        if (ch === '[' && ln[i + 1] === '[') {
          const e = ln.indexOf(']]', i + 2);
          if (e < 0) { c.fill(9, i); inLong = 2; i = ln.length; } else { c.fill(9, i, e + 2); i = e + 2; }
          continue;
        }
        if (/[A-Za-z_]/.test(ch)) {
          let j = i + 1;
          while (j < ln.length && /\w/.test(ln[j])) j++;
          const w = ln.slice(i, j);
          const col = KW.has(w) ? 14 : API.has(w) ? 12 : 7;
          if (col !== 7) c.fill(col, i, j);
          i = j; continue;
        }
        if (/\d/.test(ch)) { let j = i + 1; while (j < ln.length && /[\w.]/.test(ln[j])) j++; c.fill(15, i, j); i = j; continue; }
        i++;
      }
      out.push(c);
    }
    return out;
  }

  posFromMouse() {
    const ms = this.m.mouse;
    const row = clamp(this.sy + Math.floor((ms.y - Y0) / 6), 0, this.lines.length - 1);
    const col = clamp(this.sx + Math.floor((ms.x + 2) / 4), 0, this.lines[row].length);
    return { x: col, y: row };
  }

  frame() {
    const m = this.m, g = m.g, ms = m.mouse;
    if (topBarClick(m)) return;
    if (ms.edgeL && ms.y >= 8 && ms.y < 120) {
      const p = this.posFromMouse();
      if (m.keys.shift && !this.anchor) this.anchor = { x: this.cx, y: this.cy };
      else if (!m.keys.shift) this.anchor = { x: p.x, y: p.y };
      this.cx = p.x; this.cy = p.y; this.dragging = true;
    } else if (this.dragging && ms.l) {
      const p = this.posFromMouse();
      this.cx = p.x; this.cy = p.y; this.needScroll = true;
    }
    if (!ms.l) this.dragging = false;
    if (ms.wheel) this.sy = clamp(this.sy + ms.wheel * 3, 0, Math.max(0, this.lines.length - 3));
    if (this.needScroll) {
      if (this.cy < this.sy) this.sy = this.cy;
      if (this.cy >= this.sy + ROWS) this.sy = this.cy - ROWS + 1;
      if (this.cx < this.sx) this.sx = this.cx;
      if (this.cx >= this.sx + COLS - 1) this.sx = this.cx - COLS + 2;
      this.needScroll = false;
    }
    this.sy = clamp(this.sy, 0, Math.max(0, this.lines.length - 1));
    if (this.colorVer !== this.ver) { this.colors = this.computeColors(); this.colorVer = this.ver; }

    g.cls(1);
    const sel = this.hasSel() ? this.selRange() : null;
    for (let r = 0; r < ROWS; r++) {
      const li = this.sy + r;
      if (li >= this.lines.length) break;
      const ln = this.lines[li], y = Y0 + r * 6;
      if (this.errLine === li + 1) g.rectfill(0, y - 1, 127, y + 4, 2);
      if (sel && li >= sel[0].y && li <= sel[1].y) {
        const a = li === sel[0].y ? sel[0].x : 0;
        const b = li === sel[1].y ? sel[1].x : ln.length + 1;
        g.rectfill((a - this.sx) * 4, y - 1, (b - this.sx) * 4 - 1, y + 4, 5);
      }
      const cl = this.colors[li];
      for (let c = 0; c < COLS; c++) {
        const ci = this.sx + c;
        if (ci >= ln.length) break;
        const ch = ln[ci];
        if (ch !== ' ') g.glyph(ch, c * 4, y, cl[ci]);
      }
    }
    if (Math.floor(m.frameNo / 20) % 2 === 0 && this.cy >= this.sy && this.cy < this.sy + ROWS) {
      const x = (this.cx - this.sx) * 4, y = Y0 + (this.cy - this.sy) * 6;
      g.rectfill(x, y - 1, x + 3, y + 4, 14);
      const ch = this.lines[this.cy][this.cx];
      if (ch && ch !== ' ') g.glyph(ch, x, y, 1);
    }
    // scrollbar
    if (this.lines.length > ROWS) {
      const h = Math.max(4, Math.floor((ROWS / this.lines.length) * 110));
      const y = 9 + Math.floor((this.sy / this.lines.length) * 110);
      g.rectfill(127, y, 127, y + h, 5);
    }
    topBar(m, 'code');
    if (this.tokVer !== this.ver) { this.tok = countTokens(this.getText()); this.tokVer = this.ver; }
    const chars = this.lines.reduce((a, l) => a + l.length + 1, -1);
    const over = this.tok > 8192 || chars > 65535;
    bottomBar(m, 'LN ' + (this.cy + 1) + '/' + this.lines.length + ' COL ' + (this.cx + 1), 'TOK ' + this.tok + '/8192', over ? 8 : 5);
  }
}
