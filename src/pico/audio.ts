// @ts-nocheck
/* PICO-8 style 4-channel synthesizer (sfx + music patterns), driven directly by cart memory. */
const SFX = 0x3200, MUSIC = 0x3100;

class Chan {
  sfx = -1; base = 0; note = 0; t = 0; ph = 0; prevP = 0; prevV = 0; noise = 0; end = 32; total = 0;
  speed = 1; noteLen = 1; loopStart = 0; loopEnd = 0; pitch = 0; wave = 0; vol = 0; fx = 0;
  fromMusic = false; master = false; released = false; lp = 0;
}

const tri = (p: number) => Math.abs(p * 4 - 2) - 1;

export class Audio {
  mem: Uint8Array;
  ctx: AudioContext | null = null;
  node: any = null;
  sr = 44100;
  chans: Chan[] = [new Chan(), new Chan(), new Chan(), new Chan()];
  music = { playing: false, pat: -1, loopStart: 0, mask: 0, count: 0 };
  volume = 1;
  muted = false;

  constructor(mem: Uint8Array) { this.mem = mem; }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AC();
      this.sr = this.ctx.sampleRate;
      this.node = this.ctx.createScriptProcessor(2048, 0, 1);
      this.node.onaudioprocess = (e: any) => this.process(e.outputBuffer.getChannelData(0));
      this.node.connect(this.ctx.destination);
    } catch { this.ctx = null; }
  }
  dispose() { try { this.node && this.node.disconnect(); this.ctx && this.ctx.close(); } catch {} this.ctx = null; this.node = null; }

  loadNote(c: Chan) {
    const a = c.base + c.note * 2, m = this.mem;
    const w = m[a] | (m[a + 1] << 8);
    c.pitch = w & 63; c.wave = (w >> 6) & 7; c.vol = (w >> 9) & 7; c.fx = (w >> 12) & 7;
  }
  start(i: number, id: number, offset = 0, length = 0, fromMusic = false) {
    const c = this.chans[i], m = this.mem;
    c.sfx = id; c.base = SFX + id * 68;
    c.speed = Math.max(1, m[c.base + 65]);
    c.noteLen = (c.speed * 183 * this.sr) / 22050;
    c.loopStart = m[c.base + 66]; c.loopEnd = m[c.base + 67];
    c.note = Math.max(0, Math.min(31, offset | 0)); c.t = 0; c.total = 0;
    c.end = length > 0 ? Math.min(32, c.note + length) : 32;
    c.released = false; c.fromMusic = fromMusic; c.master = false; c.ph = 0;
    this.loadNote(c);
    c.prevP = c.pitch; c.prevV = c.vol;
  }
  stopChan(i: number) { const c = this.chans[i]; c.sfx = -1; c.master = false; }

  sfx(n: number, ch = -1, offset = 0, length = 0) {
    n = Math.floor(n); ch = Math.floor(ch);
    if (n === -1) { if (ch < 0) for (let i = 0; i < 4; i++) this.stopChan(i); else if (ch < 4) this.stopChan(ch); return; }
    if (n === -2) { if (ch < 0) this.chans.forEach((c) => (c.released = true)); else if (ch < 4) this.chans[ch].released = true; return; }
    if (n < 0 || n > 63) return;
    if (ch < 0) {
      let k = this.chans.findIndex((c, i) => c.sfx < 0 && !this.reserved(i));
      if (k < 0) k = this.chans.findIndex((c) => c.sfx < 0);
      if (k < 0) k = this.chans.findIndex((c, i) => !c.fromMusic && !this.reserved(i));
      if (k < 0) k = 0;
      ch = k;
    }
    if (ch > 3) return;
    this.ensure();
    this.start(ch, n, offset, length, false);
  }
  reserved(i: number) { return this.music.playing && (this.music.mask === 0 || (this.music.mask >> i) & 1); }

  playMusic(n: number, fade = 0, mask = 0) {
    n = Math.floor(n);
    if (n < 0) { this.music.playing = false; for (const c of this.chans) if (c.fromMusic) { c.sfx = -1; c.master = false; } return; }
    this.ensure();
    this.music.playing = true; this.music.mask = Math.floor(mask) & 15; this.music.loopStart = 0;
    this.startPattern(Math.min(63, n));
  }
  startPattern(n: number) {
    const m = this.mem, base = MUSIC + n * 4;
    this.music.pat = n;
    if (m[base] & 0x80) this.music.loopStart = n;
    let any = false, master = -1, masterLoop = -1;
    for (let i = 0; i < 4; i++) {
      const b = m[base + i];
      if (b & 0x40) { if (this.chans[i].fromMusic) this.chans[i].sfx = -1; continue; }
      if (this.music.mask && !((this.music.mask >> i) & 1)) continue;
      any = true;
      this.start(i, b & 63, 0, 0, true);
      const lp = m[SFX + (b & 63) * 68 + 67] > m[SFX + (b & 63) * 68 + 66];
      if (!lp && master < 0) master = i;
      if (lp && masterLoop < 0) masterLoop = i;
    }
    if (!any) { this.music.playing = false; return; }
    const mi = master >= 0 ? master : masterLoop;
    if (mi >= 0) this.chans[mi].master = true;
  }
  nextPattern() {
    const m = this.mem, cur = this.music.pat, base = MUSIC + cur * 4;
    if (m[base + 2] & 0x80) { this.music.playing = false; return; }
    let next = cur + 1;
    if (m[base + 1] & 0x80) next = this.music.loopStart;
    if (next > 63) { this.music.playing = false; return; }
    this.startPattern(next);
  }

  nextNote(c: Chan) {
    c.prevP = c.pitch; c.prevV = c.vol;
    c.note++;
    const looping = c.loopEnd > c.loopStart;
    if (looping && !c.released && !c.master && c.note >= c.loopEnd) c.note = c.loopStart;
    const end = c.master && looping ? c.loopEnd : c.end;
    if (c.note >= end) {
      const wasMaster = c.master;
      c.sfx = -1; c.master = false;
      if (wasMaster && this.music.playing) this.nextPattern();
      return;
    }
    this.loadNote(c);
  }

  process(out: Float32Array) {
    const n = out.length, sr = this.sr;
    const vol = this.muted ? 0 : this.volume;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        const c = this.chans[k];
        if (c.sfx < 0) continue;
        if (c.t >= c.noteLen) {
          c.t -= c.noteLen;
          this.nextNote(c);
          if (c.sfx < 0) continue;
        }
        c.t++; c.total++;
        let v = c.vol / 7;
        if (v === 0 && c.fx !== 1) continue;
        const frac = c.t / c.noteLen;
        let p = c.pitch, mul = 1;
        switch (c.fx) {
          case 1: p = c.prevP + (c.pitch - c.prevP) * frac; v = (c.prevV + (c.vol - c.prevV) * frac) / 7; break;
          case 2: p += Math.sin((c.total * Math.PI * 2 * 7.5) / sr) * 0.5; break;
          case 3: mul = 1 - frac; break;
          case 4: v *= frac; break;
          case 5: v *= 1 - frac; break;
          case 6: case 7: {
            const step = (c.fx === 6 ? 2 : 4) * (c.speed <= 8 ? 1 : 1);
            const idx = Math.floor(Math.floor(frac * c.speed) / step) % 4;
            const a = c.base + ((c.note & ~3) + idx) * 2;
            p = this.mem[a] & 63;
            break;
          }
        }
        const freq = 440 * Math.pow(2, (p - 33) / 12) * mul;
        c.ph += freq / sr;
        if (c.ph >= 1) { c.ph -= 1; if (c.wave === 6) c.noise = Math.random() * 2 - 1; }
        const ph = c.ph;
        let w: number;
        switch (c.wave) {
          case 0: w = tri(ph) * 0.9; break;
          case 1: w = (ph < 0.875 ? (ph / 0.875) * 2 - 1 : ((1 - ph) / 0.125) * 2 - 1) * 0.7; break;
          case 2: w = (ph * 2 - 1) * 0.6; break;
          case 3: w = ph < 0.5 ? 0.45 : -0.45; break;
          case 4: w = ph < 0.33 ? 0.45 : -0.45; break;
          case 5: w = (tri(ph) + tri((ph * 2) % 1) * 0.5) * 0.55; break;
          case 6: c.lp += (c.noise - c.lp) * 0.45; w = c.lp * 0.9; break;
          default: w = (tri(ph) + tri((ph * 1.007 + 0.25) % 1)) * 0.45;
        }
        s += w * v;
      }
      out[i] = Math.max(-1, Math.min(1, s * 0.3 * vol));
    }
  }

  // stat helpers
  chanSfx(i: number) { return this.chans[i].sfx; }
  chanNote(i: number) { return this.chans[i].sfx < 0 ? -1 : this.chans[i].note; }
  playingNote(sfxId: number) {
    for (const c of this.chans) if (c.sfx === sfxId) return c.note;
    return -1;
  }
  stopAll() { for (let i = 0; i < 4; i++) this.stopChan(i); this.music.playing = false; }
}
