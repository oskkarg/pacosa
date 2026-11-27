// @ts-nocheck
import { ICONS } from './font';

export const MODES = ['code', 'sprite', 'map', 'sfx', 'music'];
const BAR = [8, 12, 3, 14, 13];
const DIM = [2, 1, 1, 2, 5];
const TITLES = ['CODE', 'SPRITE', 'MAP', 'SFX', 'MUSIC'];

export function drawIcon(g: any, rows: string[], x: number, y: number, c: number) {
  for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) if (rows[j][i] === '#') g.raw(x + i, y + j, g.mem[0x5f00 + c] & 15);
}
export const inRect = (mx: number, my: number, x: number, y: number, w: number, h: number) => mx >= x && my >= y && mx < x + w && my < y + h;

export function topBar(m: any, mode: string, extra = '') {
  const g = m.g, idx = MODES.indexOf(mode);
  g.rectfill(0, 0, 127, 7, BAR[idx]);
  const text = m.toastActive ? m.toastText : (m.cartName ? m.cartName.toUpperCase() + '.P8' : TITLES[idx]) + extra;
  g.print(text.slice(0, 19), 2, 1, 7);
  for (let i = 0; i < 5; i++) {
    const x = 83 + i * 9;
    if (i === idx) g.rectfill(x - 1, 0, x + 7, 7, DIM[idx]);
    drawIcon(g, ICONS[i], x, 1, i === idx ? 7 : 6);
  }
}
export function topBarClick(m: any): boolean {
  const ms = m.mouse;
  if (ms.edgeL && ms.y < 8 && ms.x >= 82) {
    const i = Math.floor((ms.x - 82) / 9);
    if (i >= 0 && i < 5) { m.setMode(MODES[i]); return true; }
  }
  return false;
}
export function bottomBar(m: any, left: string, right = '', color = 5) {
  const g = m.g;
  g.rectfill(0, 120, 127, 127, color);
  g.print(left, 2, 122, 6);
  if (right) g.print(right, 126 - g.textWidth(right), 122, 7);
}
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const hex2 = (n: number) => n.toString(16).padStart(2, '0');
