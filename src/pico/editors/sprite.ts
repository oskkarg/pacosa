// @ts-nocheck
import { topBar, topBarClick, bottomBar, inRect, clamp } from '../ui';

const CX = 2, CY = 10, PX = 76, PY = 10, SHEET_Y = 88;
const FLAG_COL = [8, 9, 10, 11, 12, 13, 14, 15];
const TOOLS = ['P', 'F', 'I'];

export class SpriteEditor {
  m: any;
  cur = 0; selW = 1; selH = 1; color = 7; tool = 0; page = 0;
  prev: { u: number; v: number } | null = null;
  undoS: Uint8Array[] = [];
  clip: { w: number; h: number; px: number[] } | null = null;
  sheetStart = -1; hover = '';
  constructor(m: any) { this.m = m; }
  reset() { this.cur = 0; this.selW = this.selH = 1; this.undoS = []; this.page = 0; }

  get sx0() { return (this.cur & 15) * 8; }
  get sy0() { return (this.cur >> 4) * 8; }
  clampSel() {
    this.cur = clamp(this.cur, 0, 255);
    this.selW = clamp(this.selW, 1, Math.min(8, 16 - (this.cur & 15)));
    this.selH = clamp(this.selH, 1, Math.min(8, 32 - (this.cur >> 4)));
  }
  pushUndo() { this.undoS.push(this.m.mem.slice(0, 0x2000)); if (this.undoS.length > 30) this.undoS.shift(); }
  undo() { const s = this.undoS.pop(); if (s) this.m.mem.set(s, 0); }

  getRegion() {
    const g = this.m.g, W = this.selW * 8, H = this.selH * 8, px: number[] = [];
    for (let v = 0; v < H; v++) for (let u = 0; u < W; u++) px.push(g.sget(this.sx0 + u, this.sy0 + v));
    return { w: W, h: H, px };
  }
  setRegion(r: { w: number; h: number; px: number[] }) {
    const g = this.m.g;
    for (let v = 0; v < r.h; v++) for (let u = 0; u < r.w; u++) g.sset(this.sx0 + u, this.sy0 + v, r.px[v * r.w + u]);
  }
  transform(kind: string) {
    this.pushUndo();
    const r = this.getRegion(), { w, h, px } = r;
    const out = new Array(w * h).fill(0);
    if (kind === 'rot' && w !== h) { this.undoS.pop(); this.m.toast('ROTATE NEEDS SQUARE'); return; }
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      let nu = u, nv = v;
      switch (kind) {
        case 'fh': nu = w - 1 - u; break;
        case 'fv': nv = h - 1 - v; break;
        case 'rot': nu = h - 1 - v; nv = u; break;
        case 'l': nu = (u + w - 1) % w; break;
        case 'r': nu = (u + 1) % w; break;
        case 'u': nv = (v + h - 1) % h; break;
        case 'd': nv = (v + 1) % h; break;
      }
      out[nv * w + nu] = px[v * w + u];
    }
    this.setRegion({ w, h, px: out });
  }
  fill(u: number, v: number, c: number) {
    const g = this.m.g, W = this.selW * 8, H = this.selH * 8;
    const t = g.sget(this.sx0 + u, this.sy0 + v);
    if (t === c) return;
    const st = [[u, v]];
    while (st.length) {
      const [x, y] = st.pop()!;
      if (x < 0 || y < 0 || x >= W || y >= H || g.sget(this.sx0 + x, this.sy0 + y) !== t) continue;
      g.sset(this.sx0 + x, this.sy0 + y, c);
      st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }
  plotLine(u0: number, v0: number, u1: number, v1: number) {
    const g = this.m.g, W = this.selW * 8, H = this.selH * 8;
    const dx = Math.abs(u1 - u0), dy = -Math.abs(v1 - v0), sx = u0 < u1 ? 1 : -1, sy = v0 < v1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      if (u0 >= 0 && v0 >= 0 && u0 < W && v0 < H) g.sset(this.sx0 + u0, this.sy0 + v0, this.color);
      if (u0 === u1 && v0 === v1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; u0 += sx; }
      if (e2 <= dx) { err += dx; v0 += sy; }
    }
  }

  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) {
      if (e.code === 'KeyZ') { this.undo(); return true; }
      if (e.code === 'KeyC') { this.clip = this.getRegion(); this.m.toast('COPIED'); return true; }
      if (e.code === 'KeyV') { if (this.clip) { this.pushUndo(); this.setRegion(this.clip); } return true; }
      return false;
    }
    switch (e.code) {
      case 'KeyQ': this.color = (this.color + 15) & 15; return true;
      case 'KeyW': this.color = (this.color + 1) & 15; return true;
      case 'KeyA': this.cur = clamp(this.cur - 1, 0, 255); this.selW = this.selH = 1; this.page = clamp(Math.floor(this.cur / 64), 0, 3); return true;
      case 'KeyS': this.cur = clamp(this.cur + 1, 0, 255); this.selW = this.selH = 1; this.page = clamp(Math.floor(this.cur / 64), 0, 3); return true;
      case 'KeyF': this.transform('fh'); return true;
      case 'KeyV': this.transform('fv'); return true;
      case 'KeyR': this.transform('rot'); return true;
      case 'ArrowLeft': this.transform('l'); return true;
      case 'ArrowRight': this.transform('r'); return true;
      case 'ArrowUp': this.transform('u'); return true;
      case 'ArrowDown': this.transform('d'); return true;
      case 'Delete': case 'Backspace': this.pushUndo(); this.setRegion({ w: this.selW * 8, h: this.selH * 8, px: new Array(this.selW * this.selH * 64).fill(0) }); return true;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': this.page = +e.code[5] - 1; return true;
    }
    return false;
  }

  frame() {
    const m = this.m, g = m.g, ms = m.mouse, mem = m.mem;
    if (topBarClick(m)) return;
    this.clampSel();
    const W = this.selW * 8, H = this.selH * 8, z = Math.max(1, Math.floor(64 / Math.max(W, H)));

    // ---- input ----
    const u = Math.floor((ms.x - CX) / z), v = Math.floor((ms.y - CY) / z);
    const inCanvas = u >= 0 && v >= 0 && u < W && v < H;
    this.hover = inCanvas ? 'X:' + u + ' Y:' + v : '';
    if (ms.edgeL || ms.edgeR) {
      if (inCanvas) {
        if (ms.edgeR) { this.color = g.sget(this.sx0 + u, this.sy0 + v); }
        else {
          this.pushUndo();
          if (this.tool === 1) this.fill(u, v, this.color);
          else if (this.tool === 2) this.color = g.sget(this.sx0 + u, this.sy0 + v);
          else { this.prev = { u, v }; this.plotLine(u, v, u, v); }
        }
      }
      for (let c = 0; c < 16; c++) if (inRect(ms.x, ms.y, PX + (c & 3) * 12, PY + (c >> 2) * 12, 11, 11)) this.color = c;
      for (let i = 0; i < TOOLS.length; i++) if (inRect(ms.x, ms.y, PX + i * 12, 60, 11, 11)) this.tool = i;
      for (let i = 0; i < 4; i++) if (inRect(ms.x, ms.y, 38 + i * 8, 77, 7, 8)) this.page = i;
      for (let b = 0; b < 8; b++) if (inRect(ms.x, ms.y, 64 + b * 8, 77, 7, 8)) mem[0x3000 + this.cur] ^= 1 << b;
      if (ms.edgeL && inRect(ms.x, ms.y, 0, SHEET_Y, 128, 32)) {
        this.sheetStart = (this.page * 4 + Math.floor((ms.y - SHEET_Y) / 8)) * 16 + (ms.x >> 3);
        this.cur = this.sheetStart; this.selW = this.selH = 1;
      }
    }
    if (ms.l && this.tool === 0 && this.prev && inCanvas === true) {
      this.plotLine(this.prev.u, this.prev.v, u, v);
      this.prev = { u, v };
    }
    if (!ms.l) { this.prev = null; if (this.sheetStart >= 0) this.sheetStart = -1; }
    else if (this.prev && !inCanvas) { /* keep prev for re-entry */ }
    if (ms.l && this.sheetStart >= 0 && ms.y >= SHEET_Y) {
      const cx = clamp(ms.x >> 3, 0, 15), cy = clamp(this.page * 4 + Math.floor((ms.y - SHEET_Y) / 8), 0, 31);
      const sx = this.sheetStart & 15, sy = this.sheetStart >> 4;
      if (m.keys.shift) {
        this.cur = Math.min(cy, sy) * 16 + Math.min(cx, sx);
        this.selW = Math.abs(cx - sx) + 1; this.selH = Math.abs(cy - sy) + 1;
      } else { this.cur = cy * 16 + cx; this.selW = this.selH = 1; }
    }
    this.clampSel();

    // ---- draw ----
    g.cls(5);
    // canvas
    const W2 = this.selW * 8, H2 = this.selH * 8, z2 = Math.max(1, Math.floor(64 / Math.max(W2, H2)));
    g.rect(CX - 1, CY - 1, CX + W2 * z2, CY + H2 * z2, 6);
    for (let vv = 0; vv < H2; vv++) for (let uu = 0; uu < W2; uu++) {
      const c = g.sget(this.sx0 + uu, this.sy0 + vv);
      g.rectfill(CX + uu * z2, CY + vv * z2, CX + uu * z2 + z2 - 1, CY + vv * z2 + z2 - 1, c);
    }
    if (inCanvas) {
      if (z2 >= 3) g.rect(CX + u * z2, CY + v * z2, CX + u * z2 + z2 - 1, CY + v * z2 + z2 - 1, this.color === 7 ? 0 : 7);
      else g.pset(CX + u * z2, CY + v * z2, 7);
    }
    // palette
    for (let c = 0; c < 16; c++) {
      const x = PX + (c & 3) * 12, y = PY + (c >> 2) * 12;
      g.rectfill(x, y, x + 10, y + 10, c);
      if (c === this.color) { g.rect(x - 1, y - 1, x + 11, y + 11, 7); g.rect(x, y, x + 10, y + 10, 0); g.rect(x - 1, y - 1, x + 11, y + 11, 7); }
    }
    // tools
    for (let i = 0; i < TOOLS.length; i++) {
      const x = PX + i * 12;
      g.rectfill(x, 60, x + 10, 70, i === this.tool ? 6 : 1);
      g.print(TOOLS[i], x + 4, 63, i === this.tool ? 0 : 6);
    }
    g.print('PEN FILL PICK', 76, 72, 6);
    // info row
    g.print('SPR ' + String(this.cur).padStart(3, '0'), 2, 79, 7);
    for (let i = 0; i < 4; i++) {
      const x = 38 + i * 8;
      g.rectfill(x, 77, x + 6, 84, i === this.page ? 7 : 1);
      g.print(String(i), x + 2, 79, i === this.page ? 0 : 6);
    }
    const fl = mem[0x3000 + this.cur];
    for (let b = 0; b < 8; b++) {
      const x = 64 + b * 8;
      g.rectfill(x, 77, x + 6, 84, (fl >> b) & 1 ? FLAG_COL[b] : 0);
      if (!((fl >> b) & 1)) g.rect(x, 77, x + 6, 84, 1);
    }
    // sheet
    g.rectfill(0, SHEET_Y, 127, SHEET_Y + 31, 0);
    g.sspr(0, this.page * 32, 128, 32, 0, SHEET_Y);
    g.clip(0, SHEET_Y, 128, 32);
    const row = (this.cur >> 4) - this.page * 4;
    g.rect((this.cur & 15) * 8, SHEET_Y + row * 8, (this.cur & 15) * 8 + this.selW * 8 - 1, SHEET_Y + row * 8 + this.selH * 8 - 1, 7);
    g.clip();
    topBar(m, 'sprite');
    bottomBar(m, 'Q/W COL A/S SPR', this.hover || (this.selW > 1 || this.selH > 1 ? this.selW + 'X' + this.selH + ' SPRITES' : 'SHIFT:MULTI'));
  }
}
