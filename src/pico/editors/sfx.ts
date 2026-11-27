// @ts-nocheck
import { topBar, topBarClick, bottomBar, inRect, clamp } from '../ui';

const GY = 37, GB = 100, VYB = 118;
const WCOL = [12, 14, 8, 11, 10, 9, 6, 13];
const WNAME = ['TRI', 'TILT', 'SAW', 'SQUARE', 'PULSE', 'ORGAN', 'NOISE', 'PHASER'];
const FNAME = ['NONE', 'SLIDE', 'VIBRATO', 'DROP', 'FADE IN', 'FADE OUT', 'ARP FAST', 'ARP SLOW'];
const NN = ['C-', 'C#', 'D-', 'D#', 'E-', 'F-', 'F#', 'G-', 'G#', 'A-', 'A#', 'B-'];
export const noteName = (p: number) => NN[p % 12] + Math.floor(p / 12);

export class SfxEditor {
  m: any;
  cur = 0; wave = 0; fx = 0; vol = 5;
  clip: Uint8Array | null = null;
  last = { n: -1, p: 0 };
  constructor(m: any) { this.m = m; }
  reset() { this.cur = 0; }

  get base() { return 0x3200 + this.cur * 68; }
  getNote(n: number) {
    const a = this.base + n * 2, w = this.m.mem[a] | (this.m.mem[a + 1] << 8);
    return { pitch: w & 63, wave: (w >> 6) & 7, vol: (w >> 9) & 7, fx: (w >> 12) & 7, custom: (w >> 15) & 1 };
  }
  setNote(n: number, o: any) {
    const a = this.base + n * 2;
    const w = (o.pitch & 63) | ((o.wave & 7) << 6) | ((o.vol & 7) << 9) | ((o.fx & 7) << 12) | ((o.custom || 0) << 15);
    this.m.mem[a] = w & 255; this.m.mem[a + 1] = w >> 8;
  }
  play() {
    const a = this.m.audio;
    if (a.playingNote(this.cur) >= 0) { a.chans.forEach((c, i) => { if (c.sfx === this.cur) a.stopChan(i); }); }
    else a.sfx(this.cur, -1);
  }
  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey, mem = this.m.mem;
    if (ctrl) {
      if (e.code === 'KeyC') { this.clip = mem.slice(this.base, this.base + 68); this.m.toast('SFX COPIED'); return true; }
      if (e.code === 'KeyV') { if (this.clip) mem.set(this.clip, this.base); return true; }
      return false;
    }
    switch (e.code) {
      case 'Space': this.play(); return true;
      case 'ArrowLeft': case 'PageUp': case 'Minus': this.cur = (this.cur + 63) & 63; return true;
      case 'ArrowRight': case 'PageDown': case 'Equal': case 'NumpadAdd': this.cur = (this.cur + 1) & 63; return true;
      case 'KeyQ': this.wave = (this.wave + 7) & 7; return true;
      case 'KeyW': this.wave = (this.wave + 1) & 7; return true;
      case 'KeyA': this.fx = (this.fx + 7) & 7; return true;
      case 'KeyS': this.fx = (this.fx + 1) & 7; return true;
      case 'Delete': case 'Backspace': mem.fill(0, this.base, this.base + 64); mem[this.base + 65] = 1; mem[this.base + 66] = 0; mem[this.base + 67] = 0; return true;
    }
    return false;
  }

  frame() {
    const m = this.m, g = m.g, ms = m.mouse, mem = m.mem, audio = m.audio;
    if (topBarClick(m)) return;
    const base = this.base;
    // ---- number fields ----
    const fields = [
      { x: 18, w: 11, t: String(this.cur).padStart(2, '0'), get: () => this.cur, set: (v: number) => { this.cur = (v + 64) & 63; } },
      { x: 52, w: 15, t: String(mem[base + 65]).padStart(3, '0'), get: () => mem[base + 65], set: (v: number) => { mem[base + 65] = clamp(v, 1, 255); } },
      { x: 96, w: 11, t: String(mem[base + 66]).padStart(2, '0'), get: () => mem[base + 66], set: (v: number) => { mem[base + 66] = clamp(v, 0, 32); } },
      { x: 110, w: 11, t: String(mem[base + 67]).padStart(2, '0'), get: () => mem[base + 67], set: (v: number) => { mem[base + 67] = clamp(v, 0, 32); } },
    ];
    for (const f of fields) {
      if (inRect(ms.x, ms.y, f.x - 1, 9, f.w + 2, 9)) {
        if (ms.edgeL) f.set(f.get() + (ms.x < f.x + f.w / 2 ? -1 : 1) * (m.keys.shift ? 4 : 1));
        if (ms.edgeR) f.set(f.get() + (ms.x < f.x + f.w / 2 ? -1 : 1) * 8);
        if (ms.wheel) f.set(f.get() - ms.wheel);
      }
    }
    // brush selectors
    if (ms.edgeL) {
      for (let i = 0; i < 8; i++) {
        if (inRect(ms.x, ms.y, 7 + i * 10, 19, 9, 8)) this.wave = i;
        if (inRect(ms.x, ms.y, 7 + i * 10, 28, 9, 8)) this.fx = i;
      }
    }
    // graphs
    const n = clamp(ms.x >> 2, 0, 31);
    const inPitch = inRect(ms.x, ms.y, 0, GY, 128, GB - GY + 1);
    const inVol = inRect(ms.x, ms.y, 0, GB + 2, 128, 18);
    if ((ms.edgeL || ms.edgeR) && (inPitch || inVol)) this.last = { n: -1, p: 0 };
    if ((ms.l || ms.r) && (inPitch || (this.last.n >= 0 && this.dragKind === 'p'))) {
      if (ms.edgeL || ms.edgeR) this.dragKind = 'p';
      if (this.dragKind === 'p') {
        const p = clamp(GB - ms.y, 0, 63);
        const from = this.last.n < 0 ? n : this.last.n, fp = this.last.n < 0 ? p : this.last.p;
        const step = n >= from ? 1 : -1;
        for (let k = from; ; k += step) {
          const t = n === from ? 1 : (k - from) / (n - from);
          const nt = this.getNote(k);
          if (ms.r && !ms.l) this.setNote(k, { ...nt, vol: 0 });
          else this.setNote(k, { pitch: Math.round(fp + (p - fp) * t), wave: this.wave, fx: this.fx, vol: nt.vol > 0 ? nt.vol : this.vol, custom: 0 });
          if (k === n) break;
        }
        if (ms.edgeL) audio.sfx(this.cur, 3, n, 1);
        this.last = { n, p };
      }
    } else if ((ms.l || ms.r) && (inVol || this.dragKind === 'v') && (ms.edgeL || ms.edgeR || this.dragKind === 'v')) {
      if (ms.edgeL || ms.edgeR) this.dragKind = 'v';
      const v = ms.r && !ms.l ? 0 : clamp(Math.floor((VYB + 1 - ms.y) / 2), 0, 7);
      const nt = this.getNote(n);
      this.setNote(n, { ...nt, vol: v });
      if (v > 0) this.vol = v;
    }
    if (!ms.l && !ms.r) { this.dragKind = ''; this.last = { n: -1, p: 0 }; }

    // ---- draw ----
    g.cls(1);
    g.print('SFX', 2, 11, 6); g.print('SPD', 36, 11, 6); g.print('LOOP', 78, 11, 6);
    for (const f of fields) { g.rectfill(f.x - 1, 10, f.x + f.w, 16, 5); g.print(f.t, f.x, 11, 7); }
    for (let i = 0; i < 8; i++) {
      const x = 7 + i * 10;
      g.rectfill(x, 19, x + 8, 26, i === this.wave ? WCOL[i] : 0);
      g.print(String(i), x + 3, 20, i === this.wave ? 0 : 6);
      g.rectfill(x, 28, x + 8, 35, i === this.fx ? 7 : 0);
      g.print(String(i), x + 3, 29, i === this.fx ? 0 : 6);
    }
    g.print('W', 1, 20, 6); g.print('F', 1, 29, 6);
    g.print(WNAME[this.wave], 90, 20, WCOL[this.wave]); g.print(FNAME[this.fx], 90, 29, 7);
    // pitch graph bg
    for (let k = 0; k < 32; k++) g.rectfill(k * 4, GY, k * 4 + 3, GB, ((k >> 2) & 1) ? 0 : 2 - 1 + 0);
    for (let o = 0; o <= 5; o++) { const y = GB - o * 12; if (y >= GY) for (let x = 0; x < 128; x += 2) g.pset(x, y, 5); }
    const sp = mem[base + 66], ep = mem[base + 67];
    if (ep > sp) { for (let y = GY; y <= GB; y += 2) { g.pset(sp * 4, y, 10); g.pset(ep * 4, y, 11); } }
    g.rectfill(0, GB + 2, 127, VYB, 0);
    const pn = audio.playingNote(this.cur);
    for (let k = 0; k < 32; k++) {
      const nt = this.getNote(k), x = k * 4;
      if (nt.vol > 0) {
        const col = WCOL[nt.wave];
        g.rectfill(x, GB - nt.pitch, x + 2, GB, col);
        g.rectfill(x, GB - nt.pitch, x + 2, GB - nt.pitch, 7);
        if (nt.fx) g.print(String(nt.fx), x, GB - nt.pitch - 6, 7);
        g.rectfill(x, VYB - nt.vol * 2 + 1, x + 2, VYB, col);
      } else g.pset(x + 1, VYB, 5);
    }
    if (pn >= 0) { g.rectfill(pn * 4, GY, pn * 4 + 3, GY + 1, 7); g.rectfill(pn * 4, VYB - 1, pn * 4 + 3, VYB, 7); }
    // hover info
    let info = 'SPACE:PLAY  Q/W A/S BRUSH';
    if (inPitch || inVol) {
      const nt = this.getNote(n);
      info = String(n).padStart(2, '0') + ' ' + noteName(nt.pitch) + ' ' + WNAME[nt.wave].slice(0, 5) + ' V' + nt.vol + ' F' + nt.fx;
    }
    topBar(m, 'sfx');
    bottomBar(m, info, 'VOL ' + this.vol, 5);
  }
  dragKind = '';
}
