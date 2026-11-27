// @ts-nocheck
import { topBar, topBarClick, bottomBar, inRect, clamp } from '../ui';

const VY = 8, VH = 72, SHEET_Y = 88;

export class MapEditor {
  m: any;
  ox = 0; oy = 0; tile = 1; selW = 1; selH = 1; page = 0; tool = 0; ts = 8;
  pan: any = null; sheetStart = -1; undoS: Uint8Array[] = [];
  constructor(m: any) { this.m = m; }
  reset() { this.ox = this.oy = 0; this.tile = 1; this.selW = this.selH = 1; this.undoS = []; }

  get cols() { return 128 / this.ts; }
  get rows() { return VH / this.ts; }
  clampView() { this.ox = clamp(this.ox, 0, 128 - this.cols); this.oy = clamp(this.oy, 0, 64 - this.rows); }
  pushUndo() {
    const mem = this.m.mem;
    const s = new Uint8Array(0x2000);
    s.set(mem.subarray(0x1000, 0x3000));
    this.undoS.push(s); if (this.undoS.length > 20) this.undoS.shift();
  }
  undo() { const s = this.undoS.pop(); if (s) this.m.mem.set(s, 0x1000); }
  fill(x: number, y: number, n: number) {
    const g = this.m.g, t = g.mget(x, y);
    if (t === n) return;
    const st = [[x, y]];
    while (st.length) {
      const [a, b] = st.pop()!;
      if (a < 0 || b < 0 || a > 127 || b > 63 || g.mget(a, b) !== t) continue;
      g.mset(a, b, n);
      st.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]);
    }
  }
  stamp(tx: number, ty: number) {
    const g = this.m.g;
    for (let dy = 0; dy < this.selH; dy++) for (let dx = 0; dx < this.selW; dx++) g.mset(tx + dx, ty + dy, this.tile + dy * 16 + dx);
  }

  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl) { if (e.code === 'KeyZ') { this.undo(); return true; } return false; }
    const s = e.shiftKey ? 8 : 1;
    switch (e.code) {
      case 'ArrowLeft': this.ox -= s; this.clampView(); return true;
      case 'ArrowRight': this.ox += s; this.clampView(); return true;
      case 'ArrowUp': this.oy -= s; this.clampView(); return true;
      case 'ArrowDown': this.oy += s; this.clampView(); return true;
      case 'Tab': this.ts = this.ts === 8 ? 4 : 8; this.clampView(); return true;
      case 'KeyP': this.tool = 0; return true;
      case 'KeyF': this.tool = 1; return true;
      case 'KeyZ': this.ts = this.ts === 8 ? 4 : 8; this.clampView(); return true;
      case 'KeyQ': this.tile = clamp(this.tile - 1, 0, 255); this.selW = this.selH = 1; return true;
      case 'KeyW': this.tile = clamp(this.tile + 1, 0, 255); this.selW = this.selH = 1; return true;
    }
    return false;
  }

  frame() {
    const m = this.m, g = m.g, ms = m.mouse;
    if (topBarClick(m)) return;
    const ts = this.ts;
    this.clampView();
    const tx = this.ox + Math.floor(ms.x / ts), ty = this.oy + Math.floor((ms.y - VY) / ts);
    const inView = ms.y >= VY && ms.y < VY + VH;
    const space = m.keys.down.has('Space');

    if (ms.wheel) { if (m.keys.shift) this.ox += ms.wheel * 2; else this.oy += ms.wheel * 2; this.clampView(); }
    if (ms.edgeL || ms.edgeR || ms.m) {
      if (inView && (space || ms.m)) this.pan = { x: ms.x, y: ms.y, ox: this.ox, oy: this.oy };
      else if (inView && ms.edgeR) { this.tile = g.mget(tx, ty); this.selW = this.selH = 1; }
      else if (inView && ms.edgeL) {
        this.pushUndo();
        if (this.tool === 1) this.fill(tx, ty, this.tile);
      }
      if (ms.edgeL) {
        if (inRect(ms.x, ms.y, 1, 80, 9, 8)) this.tool = 0;
        if (inRect(ms.x, ms.y, 11, 80, 9, 8)) this.tool = 1;
        if (inRect(ms.x, ms.y, 21, 80, 9, 8)) { this.ts = this.ts === 8 ? 4 : 8; this.clampView(); }
        for (let i = 0; i < 4; i++) if (inRect(ms.x, ms.y, 98 + i * 8, 80, 7, 8)) this.page = i;
        if (inRect(ms.x, ms.y, 0, SHEET_Y, 128, 32)) {
          this.sheetStart = (this.page * 4 + Math.floor((ms.y - SHEET_Y) / 8)) * 16 + (ms.x >> 3);
          this.tile = this.sheetStart; this.selW = this.selH = 1;
        }
      }
    }
    if (ms.l && this.pan) {
      const nx = this.pan.ox - Math.round((ms.x - this.pan.x) / ts), ny = this.pan.oy - Math.round((ms.y - this.pan.y) / ts);
      this.ox = nx; this.oy = ny; this.clampView();
    } else if (ms.l && inView && this.tool === 0 && this.sheetStart < 0 && !space) {
      this.stamp(tx, ty);
    }
    if (!ms.l && !ms.m) { this.pan = null; this.sheetStart = -1; }
    if (ms.l && this.sheetStart >= 0 && ms.y >= SHEET_Y) {
      const cx = clamp(ms.x >> 3, 0, 15), cy = clamp(this.page * 4 + Math.floor((ms.y - SHEET_Y) / 8), 0, 31);
      const sx = this.sheetStart & 15, sy = this.sheetStart >> 4;
      if (m.keys.shift) { this.tile = Math.min(cy, sy) * 16 + Math.min(cx, sx); this.selW = Math.abs(cx - sx) + 1; this.selH = Math.abs(cy - sy) + 1; }
      else { this.tile = cy * 16 + cx; this.selW = this.selH = 1; }
    }

    // ---- draw ----
    g.cls(5);
    g.rectfill(0, VY, 127, VY + VH - 1, 0);
    g.clip(0, VY, 128, VH);
    for (let i = 0; i <= this.cols; i++) if ((this.ox + i) % 16 === 0) for (let y = VY; y < VY + VH; y += 2) g.pset(i * ts, y, 1);
    for (let j = 0; j <= this.rows; j++) if ((this.oy + j) % 16 === 0) for (let x = 0; x < 128; x += 2) g.pset(x, VY + j * ts, 1);
    for (let j = 0; j < this.rows; j++) for (let i = 0; i < this.cols; i++) {
      const t = g.mget(this.ox + i, this.oy + j);
      if (t) g.blit((t & 15) * 8, (t >> 4) * 8, 8, 8, i * ts, VY + j * ts, ts, ts, false, false);
    }
    if (inView && !this.pan) g.rect(Math.floor(ms.x / ts) * ts, VY + Math.floor((ms.y - VY) / ts) * ts, Math.floor(ms.x / ts) * ts + this.selW * ts - 1, VY + Math.floor((ms.y - VY) / ts) * ts + this.selH * ts - 1, 7);
    g.clip();
    // tool row
    const btn = (x: number, w: number, label: string, on: boolean) => { g.rectfill(x, 80, x + w - 1, 87, on ? 6 : 1); g.print(label, x + 3, 81, on ? 0 : 6); };
    btn(1, 9, 'P', this.tool === 0); btn(11, 9, 'F', this.tool === 1); btn(21, 9, 'Z', false);
    g.print(inView ? tx + ',' + ty : '', 34, 81, 7);
    for (let i = 0; i < 4; i++) {
      const x = 98 + i * 8;
      g.rectfill(x, 80, x + 6, 87, i === this.page ? 7 : 1);
      g.print(String(i), x + 2, 81, i === this.page ? 0 : 6);
    }
    // sheet
    g.rectfill(0, SHEET_Y, 127, SHEET_Y + 31, 0);
    g.sspr(0, this.page * 32, 128, 32, 0, SHEET_Y);
    g.clip(0, SHEET_Y, 128, 32);
    const row = (this.tile >> 4) - this.page * 4;
    g.rect((this.tile & 15) * 8, SHEET_Y + row * 8, (this.tile & 15) * 8 + this.selW * 8 - 1, SHEET_Y + row * 8 + this.selH * 8 - 1, 7);
    g.clip();
    topBar(m, 'map');
    bottomBar(m, 'TAB:ZOOM SPACE+DRAG:PAN', 'TILE ' + this.tile);
  }
}
