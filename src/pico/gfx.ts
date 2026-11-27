// @ts-nocheck
import { glyphFor } from './font';
import { LuaTable, tostr } from './lua';
export const PALETTE = [
  '#000000', '#1D2B53', '#7E2553', '#008751', '#AB5236', '#5F574F', '#C2C3C7', '#FFF1E8',
  '#FF004D', '#FFA300', '#FFEC27', '#00E436', '#29ADFF', '#83769C', '#FF77A8', '#FFCCAA',
  '#291814', '#111D35', '#422136', '#125359', '#742F29', '#49333B', '#A28879', '#F3EF7D',
  '#BE1250', '#FF6C24', '#A8E72E', '#00B543', '#065AB5', '#754665', '#FF6E59', '#FF9D81',
];
export const RGBA = PALETTE.map((h) => {
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
});
export const SCREEN = 0x6000;
const PAL_DRAW = 0x5f00, PAL_SCREEN = 0x5f10;
export class Gfx {
  mem: Uint8Array;
  camX = 0; camY = 0; cx0 = 0; cy0 = 0; cx1 = 128; cy1 = 128;
  col = 6; fillp = 0; fillt = false; curX = 0; curY = 0; lx = 0; ly = 0;
  /* tline(bits): bits fraccionarios de mx,my,mdx,mdy. 13 = tiles (defecto), 16 = pixeles del mapa */
  tlineBits = 13;
  img: ImageData | null = null;
  px32: Uint32Array | null = null;
  constructor(mem: Uint8Array) { this.mem = mem; this.resetDraw(); }
  resetDraw() {
    const m = this.mem;
    for (let i = 0; i < 16; i++) { m[PAL_DRAW + i] = i; m[PAL_SCREEN + i] = i; }
    m[PAL_DRAW] = 0x10;
    this.camX = this.camY = 0; this.cx0 = this.cy0 = 0; this.cx1 = this.cy1 = 128;
    this.col = 6; this.fillp = 0; this.fillt = false; this.curX = this.curY = 0; this.lx = this.ly = 0;
    this.tlineBits = 13;
  }
  saveState() { return { camX: this.camX, camY: this.camY, cx0: this.cx0, cy0: this.cy0, cx1: this.cx1, cy1: this.cy1, col: this.col, fillp: this.fillp, fillt: this.fillt, curX: this.curX, curY: this.curY, tlineBits: this.tlineBits }; }
  loadState(s: any) { Object.assign(this, s); }
  setc(c?: number) { if (c !== undefined && c !== null && !isNaN(c)) this.col = Math.floor(c) & 0xff; return this.col; }
  /* raw plot: already-absolute ints, mapped color 0..15 */
  raw(x: number, y: number, c: number) {
    if (x < this.cx0 || x >= this.cx1 || y < this.cy0 || y >= this.cy1) return;
    const a = SCREEN + (y << 6) + (x >> 1);
    const m = this.mem;
    if (x & 1) m[a] = (m[a] & 0x0f) | (c << 4); else m[a] = (m[a] & 0xf0) | c;
  }
  /* plot using draw palette (sprites/text) */
  pp(x: number, y: number, c: number) { this.raw(x, y, this.mem[PAL_DRAW + (c & 15)] & 15); }
  /* plot with fill pattern (shapes) */
  pc(x: number, y: number, c: number) {
    if (x < this.cx0 || x >= this.cx1 || y < this.cy0 || y >= this.cy1) return;
    let p = c & 15;
    if (this.fillp !== 0 && (this.fillp >> (15 - ((y & 3) << 2) - (x & 3))) & 1) {
      if (this.fillt) return;
      p = (c >> 4) & 15;
    }
    p = this.mem[PAL_DRAW + p] & 15;
    const a = SCREEN + (y << 6) + (x >> 1);
    const m = this.mem;
    if (x & 1) m[a] = (m[a] & 0x0f) | (p << 4); else m[a] = (m[a] & 0xf0) | p;
  }
  cls(c = 0) {
    c = Math.floor(c) & 15;
    this.mem.fill(c | (c << 4), SCREEN, SCREEN + 8192);
    this.curX = 0; this.curY = 0;
  }
  pset(x: number, y: number, c?: number) {
    c = this.setc(c);
    this.pc(Math.floor(x - this.camX), Math.floor(y - this.camY), c);
  }
  pget(x: number, y: number) {
    x = Math.floor(x - this.camX); y = Math.floor(y - this.camY);
    if (x < 0 || x > 127 || y < 0 || y > 127) return 0;
    const v = this.mem[SCREEN + (y << 6) + (x >> 1)];
    return x & 1 ? v >> 4 : v & 15;
  }
  sget(x: number, y: number) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x > 127 || y < 0 || y > 127) return 0;
    const v = this.mem[(y << 6) + (x >> 1)];
    return x & 1 ? v >> 4 : v & 15;
  }
  sset(x: number, y: number, c: number) {
    x = Math.floor(x); y = Math.floor(y); c = Math.floor(c) & 15;
    if (x < 0 || x > 127 || y < 0 || y > 127) return;
    const a = (y << 6) + (x >> 1);
    this.mem[a] = x & 1 ? (this.mem[a] & 0x0f) | (c << 4) : (this.mem[a] & 0xf0) | c;
  }
  hline(x0: number, x1: number, y: number, c: number) {
    if (y < this.cy0 || y >= this.cy1) return;
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (x0 < this.cx0) x0 = this.cx0;
    if (x1 >= this.cx1) x1 = this.cx1 - 1;
    if (this.fillp === 0) {
      const p = this.mem[PAL_DRAW + (c & 15)] & 15;
      for (let x = x0; x <= x1; x++) this.raw(x, y, p);
    } else for (let x = x0; x <= x1; x++) this.pc(x, y, c);
  }
    line(x0?: number, y0?: number, x1?: number, y1?: number, c?: number) {
    // line(color): cambia el color e invalida el punto de continuación.
    if (y0 === undefined) {
      this.setc(x0);
      this.lineValid = false;
      return;
    }

    if (y1 === undefined) {
      // line(x1, y1 [, c]) continues from last point
      c = x1;
      x1 = x0;
      y1 = y0;
      x0 = this.lx;
      y0 = this.ly;
    }

    c = this.setc(c);

    x0 = Math.floor(x0 - this.camX);
    y0 = Math.floor(y0 - this.camY);
    x1 = Math.floor(x1 - this.camX);
    y1 = Math.floor(y1 - this.camY);

    this.lx = x1 + this.camX;
    this.ly = y1 + this.camY;

    if (!isFinite(x0 + y0 + x1 + y1)) return;

    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;

    let err = dx + dy;
    let n = 0;

    for (;;) {
      this.pc(x0, y0, c);

      if ((x0 === x1 && y0 === y1) || ++n > 40000) break;

      const e2 = 2 * err;

      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }

      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  lineValid = false;
  rect(x0: number, y0: number, x1: number, y1: number, c?: number) {
    c = this.setc(c);
    x0 = Math.floor(x0 - this.camX); y0 = Math.floor(y0 - this.camY);
    x1 = Math.floor(x1 - this.camX); y1 = Math.floor(y1 - this.camY);
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    this.hline(x0, x1, y0, c); this.hline(x0, x1, y1, c);
    for (let y = y0 + 1; y < y1; y++) { this.pc(x0, y, c); this.pc(x1, y, c); }
  }
  rectfill(x0: number, y0: number, x1: number, y1: number, c?: number) {
    c = this.setc(c);
    x0 = Math.floor(x0 - this.camX); y0 = Math.floor(y0 - this.camY);
    x1 = Math.floor(x1 - this.camX); y1 = Math.floor(y1 - this.camY);
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    y0 = Math.max(y0, this.cy0); y1 = Math.min(y1, this.cy1 - 1);
    for (let y = y0; y <= y1; y++) this.hline(x0, x1, y, c);
  }
  /*
   * Semi-ancho del circulo PICO-8 de radio r en la fila |dy| = k.
   * Pixel (x,k) pertenece si x*x + k*k <= r*r + r - 1.
   *   r=1 ->  010 / 111 / 010
   *   r=2 ->  01110 / 11111 / 11111 / 11111 / 01110
   */
  circW(r: number, k: number): number {
    if (k > r) return -1;
    const lim = r * r + r - 1;
    const rem = lim - k * k;
    if (rem < 0) return -1;
    let w = Math.floor(Math.sqrt(rem));
    while ((w + 1) * (w + 1) <= rem) w++;
    while (w * w > rem) w--;
    return w;
  }
  circ(xc: number, yc: number, r: number, c?: number) {
    c = this.setc(c);
    xc = Math.floor(xc - this.camX); yc = Math.floor(yc - this.camY); r = Math.floor(r);
    if (!isFinite(xc + yc + r) || r < 0) return;
    if (r === 0) { this.pc(xc, yc, c); return; }
    for (let k = 0; k <= r; k++) {
      const y1 = yc + k, y2 = yc - k;
      if ((y1 < this.cy0 || y1 >= this.cy1) && (y2 < this.cy0 || y2 >= this.cy1)) continue;
      const w = this.circW(r, k);
      if (w < 0) continue;
      const wn = this.circW(r, k + 1);
      const lo = wn < w ? wn + 1 : w;
      for (let dx = lo; dx <= w; dx++) {
        this.pc(xc + dx, y1, c); this.pc(xc - dx, y1, c);
        if (k !== 0) { this.pc(xc + dx, y2, c); this.pc(xc - dx, y2, c); }
      }
    }
  }
  circfill(xc: number, yc: number, r: number, c?: number) {
    c = this.setc(c);
    xc = Math.floor(xc - this.camX); yc = Math.floor(yc - this.camY); r = Math.floor(r);
    if (!isFinite(xc + yc + r) || r < 0) return;
    if (r === 0) { this.pc(xc, yc, c); return; }
    for (let k = 0; k <= r; k++) {
      const y1 = yc + k, y2 = yc - k;
      if ((y1 < this.cy0 || y1 >= this.cy1) && (y2 < this.cy0 || y2 >= this.cy1)) continue;
      const w = this.circW(r, k);
      if (w < 0) continue;
      this.hline(xc - w, xc + w, y1, c);
      if (k !== 0) this.hline(xc - w, xc + w, y2, c);
    }
  }
  oval(x0: number, y0: number, x1: number, y1: number, c?: number, fill = false) {
    c = this.setc(c);
    x0 = Math.floor(x0 - this.camX); y0 = Math.floor(y0 - this.camY);
    x1 = Math.floor(x1 - this.camX); y1 = Math.floor(y1 - this.camY);
    if (x0 > x1) { const t = x0; x0 = x1; x1 = t; }
    if (y0 > y1) { const t = y0; y0 = y1; y1 = t; }
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2 + 0.5, ry = (y1 - y0) / 2 + 0.5;
    for (let y = y0; y <= y1; y++) {
      const t = (y - cy) / ry;
      const w = rx * Math.sqrt(Math.max(0, 1 - t * t));
      const a = Math.round(cx - w + 0.0), b = Math.round(cx + w - 0.0);
      if (fill) this.hline(a, b, y, c); else { this.pc(a, y, c); this.pc(b, y, c); }
    }
    if (!fill) for (let x = x0; x <= x1; x++) {
      const t = (x - cx) / rx;
      const h = ry * Math.sqrt(Math.max(0, 1 - t * t));
      this.pc(x, Math.round(cy - h), c); this.pc(x, Math.round(cy + h), c);
    }
  }
  blit(sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, fx: boolean, fy: boolean) {
    dx = Math.floor(dx - this.camX); dy = Math.floor(dy - this.camY);
    if (dw <= 0 || dh <= 0) return;
    const m = this.mem;
    for (let j = 0; j < dh; j++) {
      const yy = dy + j;
      if (yy < this.cy0 || yy >= this.cy1) continue;
      let syy = Math.floor((j * sh) / dh);
      if (fy) syy = sh - 1 - syy;
      syy += sy;
      for (let i = 0; i < dw; i++) {
        const xx = dx + i;
        if (xx < this.cx0 || xx >= this.cx1) continue;
        let sxx = Math.floor((i * sw) / dw);
        if (fx) sxx = sw - 1 - sxx;
        sxx += sx;
        if (sxx < 0 || sxx > 127 || syy < 0 || syy > 127) continue;
        const v = m[(syy << 6) + (sxx >> 1)];
        const c = sxx & 1 ? v >> 4 : v & 15;
        const pm = m[PAL_DRAW + c];
        if (pm & 0x10) continue;
        this.raw(xx, yy, pm & 15);
      }
    }
  }
  spr(n: number, x: number, y: number, w = 1, h = 1, fx = false, fy = false) {
    n = Math.floor(n);
    if (n < 0 || n > 255) return;
    this.blit((n & 15) * 8, (n >> 4) * 8, w * 8, h * 8, x, y, w * 8, h * 8, fx, fy);
  }
  sspr(sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw?: number, dh?: number, fx = false, fy = false) {
    if (dw === undefined) dw = sw;
    if (dh === undefined) dh = sh;
    this.blit(Math.floor(sx), Math.floor(sy), Math.floor(sw), Math.floor(sh), dx, dy, Math.floor(dw), Math.floor(dh), fx, fy);
  }
  mget(x: number, y: number) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x > 127 || y < 0 || y > 63) return 0;
    return this.mem[y < 32 ? 0x2000 + y * 128 + x : 0x1000 + (y - 32) * 128 + x];
  }
  mset(x: number, y: number, v: number) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || x > 127 || y < 0 || y > 63) return;
    this.mem[y < 32 ? 0x2000 + y * 128 + x : 0x1000 + (y - 32) * 128 + x] = v & 255;
  }
  fget(n: number, b?: number) {
    n = Math.floor(n);
    if (n < 0 || n > 255) return 0;
    const f = this.mem[0x3000 + n];
    return b === undefined ? f : (f >> Math.floor(b)) & 1 ? true : false;
  }
  fset(n: number, b: any, v?: any) {
    n = Math.floor(n);
    if (n < 0 || n > 255) return;
    if (v === undefined) { this.mem[0x3000 + n] = Math.floor(b) & 255; return; }
    const bit = 1 << Math.floor(b);
    if (v !== false && v !== undefined) this.mem[0x3000 + n] |= bit; else this.mem[0x3000 + n] &= ~bit;
  }
  map(cx = 0, cy = 0, sx = 0, sy = 0, cw = 128, ch = 64, layer = 0) {
    cx = Math.floor(cx); cy = Math.floor(cy);
    sx = Math.floor(sx - this.camX); sy = Math.floor(sy - this.camY);
    for (let ty = 0; ty < ch; ty++) {
      const py = sy + ty * 8;
      if (py > 127 || py + 8 <= 0) continue;
      for (let tx = 0; tx < cw; tx++) {
        const px = sx + tx * 8;
        if (px > 127 || px + 8 <= 0) continue;
        const t = this.mget(cx + tx, cy + ty);
        if (t === 0) continue;
        if (layer && (this.mem[0x3000 + t] & layer) !== layer) continue;
        this.blit((t & 15) * 8, (t >> 4) * 8, 8, 8, px + this.camX, py + this.camY, 8, 8, false, false);
      }
    }
  }
  /* tline(bits): fija los bits fraccionarios de mx,my,mdx,mdy.
   *   13 (defecto): unidades = tiles (1.0 = 8 px del mapa)
   *   16          : unidades = pixeles del mapa (1.0 = 1 px)
   *   pixeles = valor * 2^(16 - bits)
   */
  setTlineBits(b: number) {
    b = Math.floor(Number(b));
    if (!isFinite(b)) return;
    this.tlineBits = Math.max(0, Math.min(16, b));
  }
  /* tline(x0,y0,x1,y1, mx,my, [mdx,mdy], [layers])
   * Si mdx no se indica, avanza 1 pixel del mapa por pixel de pantalla
   * (0.125 tiles con bits=13). */
  tline(x0: number, y0: number, x1: number, y1: number, mx: number, my: number, mdx?: number, mdy?: number, layers = 0) {
    x0 = Math.floor(x0 - this.camX); y0 = Math.floor(y0 - this.camY);
    x1 = Math.floor(x1 - this.camX); y1 = Math.floor(y1 - this.camY);
    // a pixeles del mapa
    const k = Math.pow(2, 16 - this.tlineBits);
    mx *= k; my *= k;
    mdx = mdx === undefined ? 1 : mdx * k;
    mdy = mdy === undefined ? 0 : mdy * k;
    if (!isFinite(x0 + y0 + x1 + y1 + mx + my + mdx + mdy)) return;
    layers = Math.floor(layers || 0);
    const m = this.mem;
    const mw = m[0x5f38] || 128;
    const mh = m[0x5f39] || 64;
    const ox = m[0x5f3a];
    const oy = m[0x5f3b];
    const fastWrap = mw === 128 && mh === 64 && ox === 0 && oy === 0;
    // mapX/mapY en pixeles del mapa
    const plotSample = (x: number, y: number, mapX: number, mapY: number) => {
      const px = Math.floor(mapX);
      const py = Math.floor(mapY);
      const tx = fastWrap ? (px >> 3) & 127 : (ox + ((((px >> 3) % mw) + mw) % mw)) & 127;
      const ty = fastWrap ? (py >> 3) & 63 : (oy + ((((py >> 3) % mh) + mh) % mh)) & 63;
      const t = m[ty < 32 ? 0x2000 + (ty << 7) + tx : 0x1000 + ((ty - 32) << 7) + tx];
      if (t === 0) return;
      if (layers && (m[0x3000 + t] & layers) !== layers) return;
      const sxx = ((t & 15) << 3) + (px & 7);
      const syy = ((t >> 4) << 3) + (py & 7);
      const v = m[(syy << 6) + (sxx >> 1)];
      const c = sxx & 1 ? v >> 4 : v & 15;
      const pm = m[PAL_DRAW + c];
      if (pm & 0x10) return;
      const a = SCREEN + (y << 6) + (x >> 1);
      const p = pm & 15;
      if (x & 1) m[a] = (m[a] & 0x0f) | (p << 4);
      else m[a] = (m[a] & 0xf0) | p;
    };
    if (y0 === y1) {
      if (y0 < this.cy0 || y0 >= this.cy1) return;
      if (x0 <= x1) {
        if (x1 < this.cx0 || x0 >= this.cx1) return;
        if (x0 < this.cx0) {
          const skip = this.cx0 - x0;
          mx += skip * mdx; my += skip * mdy;
          x0 = this.cx0;
        }
        const endX = Math.min(x1, this.cx1 - 1);
        for (let x = x0; x <= endX; x++, mx += mdx, my += mdy) {
          plotSample(x, y0, mx, my);
        }
      } else {
        if (x0 < this.cx0 || x1 >= this.cx1) return;
        if (x0 >= this.cx1) {
          const skip = x0 - (this.cx1 - 1);
          mx += skip * mdx; my += skip * mdy;
          x0 = this.cx1 - 1;
        }
        const endX = Math.max(x1, this.cx0);
        for (let x = x0; x >= endX; x--, mx += mdx, my += mdy) {
          plotSample(x, y0, mx, my);
        }
      }
      return;
    }
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, n = 0;
    for (;;) {
      if (x0 >= this.cx0 && x0 < this.cx1 && y0 >= this.cy0 && y0 < this.cy1) {
        plotSample(x0, y0, mx, my);
      }
      if ((x0 === x1 && y0 === y1) || ++n > 40000) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
      mx += mdx;
      my += mdy;
    }
  }
  scroll(rows: number) {
    this.mem.copyWithin(SCREEN, SCREEN + rows * 64, SCREEN + 8192);
    this.mem.fill(0, SCREEN + 8192 - rows * 64, SCREEN + 8192);
  }
  glyph(ch: string, x: number, y: number, c: number): number {
    const g = glyphFor(ch);
    if (!g) return 4;
    const [rows, w, wide] = g;
    for (let r = 0; r < 5; r++) {
      const bits = rows[r];
      if (!bits) continue;
      for (let k = 0; k < w; k++) if ((bits >> (w - 1 - k)) & 1) this.pp(x + k, y + r, c);
    }
    return wide ? 8 : 4;
  }
  textWidth(s: string) { let w = 0; for (const ch of s) { const g = glyphFor(ch); w += g && g[2] ? 8 : 4; } return w; }
  print(s: any, x?: number, y?: number, c?: number): number {
    const str = typeof s === 'string' ? s : tostr(s);
    c = this.setc(c);
    let px: number, py: number;
    const useCursor = x === undefined;
    if (useCursor) { px = this.curX; py = this.curY; }
    else { px = Math.floor(x - this.camX); py = Math.floor((y ?? 0) - this.camY); }
    const startX = px;
    if (useCursor) while (py > 122) { this.scroll(6); py -= 6; }
    for (const ch of str) {
      if (ch === '\n') {
        px = startX; py += 6;
        if (useCursor) while (py > 122) { this.scroll(6); py -= 6; }
        continue;
      }
      if (ch === '\r' || ch === '\uFE0F') continue;
      px += this.glyph(ch, px, py, c);
    }
    if (useCursor) { this.curY = py + 6; this.curX = startX; }
    else { this.curX = Math.floor(x); this.curY = Math.floor((y ?? 0)) + 6; }
    return px + this.camX;
  }
  pal(a?: any, b?: any, p?: any) {
    const m = this.mem;
    if (a === undefined) {
      for (let i = 0; i < 16; i++) { m[PAL_DRAW + i] = i; m[PAL_SCREEN + i] = i; }
      m[PAL_DRAW] = 0x10;
      return;
    }
    if (a instanceof LuaTable) {
      const pp = b;
      const set = (k: number, v: number) => this.pal(k, v, pp);
      a.arr.forEach((v: any, i: number) => { if (v !== undefined) set(i, v); });
      if (a.hash) for (const [k, v] of a.hash) if (typeof k === 'number') set(k, v);
      return;
    }
    if (b === undefined) return;
    a = Math.floor(a) & 15; b = Math.floor(b);
    if (p === 1 || p === true) m[PAL_SCREEN + a] = b & 0xff;
    else m[PAL_DRAW + a] = (m[PAL_DRAW + a] & 0x10) | (b & 15);
  }
  palt(a?: any, t?: any) {
    const m = this.mem;
    if (a === undefined) { for (let i = 0; i < 16; i++) m[PAL_DRAW + i] = (m[PAL_DRAW + i] & 15) | (i === 0 ? 0x10 : 0); return; }
    if (t === undefined) {
      const mask = Math.floor(a) & 0xffff;
      for (let i = 0; i < 16; i++) m[PAL_DRAW + i] = (m[PAL_DRAW + i] & 15) | ((mask >> (15 - i)) & 1 ? 0x10 : 0);
      return;
    }
    a = Math.floor(a) & 15;
    m[PAL_DRAW + a] = (m[PAL_DRAW + a] & 15) | (t !== false && t !== undefined ? 0x10 : 0);
  }
  clip(x?: number, y?: number, w?: number, h?: number) {
    if (x === undefined) { this.cx0 = this.cy0 = 0; this.cx1 = this.cy1 = 128; return; }
    x = Math.floor(x); y = Math.floor(y!);
    this.cx0 = Math.max(0, x); this.cy0 = Math.max(0, y);
    this.cx1 = Math.min(128, x + Math.floor(w!)); this.cy1 = Math.min(128, y + Math.floor(h!));
  }
  fillpat(p: number) {
    p = p || 0;
    this.fillp = Math.floor(p) & 0xffff;
    this.fillt = p % 1 >= 0.5 || (p < 0 && false);
  }
  present(ctx: CanvasRenderingContext2D) {
    if (!this.img) { this.img = ctx.createImageData(128, 128); this.px32 = new Uint32Array(this.img.data.buffer); }
    const sp = new Uint32Array(16), m = this.mem, px = this.px32!;
    for (let i = 0; i < 16; i++) { const v = m[PAL_SCREEN + i]; sp[i] = RGBA[v >= 128 ? 16 + (v & 15) : v & 15]; }
    let o = 0;
    for (let a = SCREEN; a < SCREEN + 8192; a++) { const b = m[a]; px[o++] = sp[b & 15]; px[o++] = sp[b >> 4]; }
    ctx.putImageData(this.img, 0, 0);
  }
}