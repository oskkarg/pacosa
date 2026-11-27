// @ts-nocheck
import { topBar, topBarClick, bottomBar, inRect, clamp } from '../ui';

const Y0 = 18, RH = 8, VIS = 12;

export class MusicEditor {
  m: any;
  row = 0; ch = 0; top = 0; lastId = 0; typed = 0; typedT = 0;
  clip: number[] | null = null;
  constructor(m: any) { this.m = m; }
  reset() { this.row = 0; this.top = 0; }
  addr(r: number, c: number) { return 0x3100 + r * 4 + c; }
  togglePlay() {
    const a = this.m.audio;
    if (a.music.playing) a.playMusic(-1); else a.playMusic(this.row);
  }
  setId(r: number, c: number, id: number) {
    const mem = this.m.mem, a = this.addr(r, c);
    mem[a] = (mem[a] & 0x80) | (id & 63);
    this.lastId = id & 63;
  }
  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey, mem = this.m.mem;
    if (ctrl) {
      if (e.code === 'KeyC') { this.clip = [0, 1, 2, 3].map((c) => mem[this.addr(this.row, c)]); this.m.toast('PATTERN COPIED'); return true; }
      if (e.code === 'KeyV') { if (this.clip) this.clip.forEach((b, c) => { mem[this.addr(this.row, c)] = b; }); return true; }
      return false;
    }
    const a = this.addr(this.row, this.ch);
    switch (e.code) {
      case 'ArrowUp': this.row = clamp(this.row - 1, 0, 63); return true;
      case 'ArrowDown': this.row = clamp(this.row + 1, 0, 63); return true;
      case 'ArrowLeft': this.ch = (this.ch + 3) & 3; return true;
      case 'ArrowRight': this.ch = (this.ch + 1) & 3; return true;
      case 'PageUp': this.row = clamp(this.row - VIS, 0, 63); return true;
      case 'PageDown': this.row = clamp(this.row + VIS, 0, 63); return true;
      case 'Space': this.togglePlay(); return true;
      case 'Delete': case 'Backspace': mem[a] |= 0x40; return true;
      case 'Minus': case 'NumpadSubtract': this.setId(this.row, this.ch, ((mem[a] & 63) + 63) & 63); mem[a] &= ~0x40; return true;
      case 'Equal': case 'NumpadAdd': this.setId(this.row, this.ch, ((mem[a] & 63) + 1) & 63); mem[a] &= ~0x40; return true;
    }
    if (/^(Digit|Numpad)\d$/.test(e.code)) {
      const d = +e.code.slice(-1), now = performance.now();
      let id = d;
      if (now - this.typedT < 1200 && this.typed >= 0 && this.typed < 7) id = this.typed * 10 + d;
      this.typed = d; this.typedT = now;
      if (id > 63) id = d;
      this.setId(this.row, this.ch, id); mem[a] &= ~0x40;
      return true;
    }
    return false;
  }
  frame() {
    const m = this.m, g = m.g, ms = m.mouse, mem = m.mem, audio = m.audio;
    if (topBarClick(m)) return;
    const playing = audio.music.playing ? audio.music.pat : -1;
    if (playing >= 0 && playing < this.top) this.top = playing;
    if (playing >= this.top + VIS) this.top = playing - VIS + 1;
    if (this.row < this.top) this.top = this.row;
    if (this.row >= this.top + VIS) this.top = this.row - VIS + 1;
    if (ms.wheel && !inRect(ms.x, ms.y, 40, Y0, 88, VIS * RH)) this.top = clamp(this.top + ms.wheel * 2, 0, 64 - VIS);

    for (let i = 0; i < VIS; i++) {
      const r = this.top + i, y = Y0 + i * RH;
      if (r > 63) break;
      for (let f = 0; f < 3; f++) {
        if (ms.edgeL && inRect(ms.x, ms.y, 14 + f * 9, y, 8, 8)) { mem[this.addr(r, f)] ^= 0x80; this.row = r; }
      }
      for (let c = 0; c < 4; c++) {
        const x = 40 + c * 22;
        if (inRect(ms.x, ms.y, x, y, 21, 8)) {
          const a = this.addr(r, c);
          if (ms.edgeL) { this.row = r; this.ch = c; if (mem[a] & 0x40) { mem[a] &= ~0x40; this.setId(r, c, this.lastId); } }
          if (ms.edgeR) { this.row = r; this.ch = c; mem[a] ^= 0x40; }
          if (ms.wheel) { this.row = r; this.ch = c; this.setId(r, c, ((mem[a] & 63) - ms.wheel + 64) & 63); mem[a] &= ~0x40; }
        }
      }
      if (ms.edgeL && inRect(ms.x, ms.y, 0, y, 13, 8)) this.row = r;
    }
    if (ms.edgeL && inRect(ms.x, ms.y, 2, 9, 30, 8)) this.togglePlay();

    g.cls(1);
    g.rectfill(2, 9, 31, 16, playing >= 0 ? 8 : 11);
    g.print(playing >= 0 ? 'STOP' : 'PLAY', 6, 11, 7);
    g.print('PATTERN ' + String(this.row).padStart(2, '0'), 40, 11, 7);
    g.print('<>X', 14, 11, 6);
    for (let i = 0; i < VIS; i++) {
      const r = this.top + i, y = Y0 + i * RH;
      if (r > 63) break;
      if (r === playing) g.rectfill(0, y, 127, y + 7, 2);
      else if (r === this.row) g.rectfill(0, y, 127, y + 7, 5);
      g.print(String(r).padStart(2, '0'), 1, y + 1, r === this.row ? 7 : 6);
      const b0 = mem[this.addr(r, 0)], b1 = mem[this.addr(r, 1)], b2 = mem[this.addr(r, 2)];
      [[b0, '<', 10], [b1, '>', 11], [b2, 'X', 8]].forEach(([b, s, col], f) => {
        const x = 14 + f * 9;
        g.rectfill(x, y, x + 7, y + 6, b & 0x80 ? col : 0);
        g.print(s, x + 2, y + 1, b & 0x80 ? 0 : 5);
      });
      for (let c = 0; c < 4; c++) {
        const b = mem[this.addr(r, c)], x = 40 + c * 22, off = b & 0x40;
        g.rectfill(x, y, x + 20, y + 6, off ? 0 : 13);
        g.print(off ? '--' : String(b & 63).padStart(2, '0'), x + 6, y + 1, off ? 5 : 7);
        if (r === this.row && c === this.ch) g.rect(x - 1, y - 1, x + 21, y + 7, 7);
      }
    }
    topBar(m, 'music');
    bottomBar(m, 'SPACE:PLAY CLICK:EDIT RMB:MUTE', playing >= 0 ? 'PLAYING ' + playing : '', 5);
  }
}
