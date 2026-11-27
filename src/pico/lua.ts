// @ts-nocheck
/* Lua (PICO-8 dialect) -> JavaScript compiler + runtime values.
   Supports: != += -= etc, shorthand if/while, ? print, \ int-div, bit ops,
   @ % $ peek operators, 0b literals, // comments, coroutines (generator mode). */

export class LuaError extends Error {
  value: any;
  line: number;
  constructor(value: any, line = 0) {
    super(typeof value === 'string' ? value : String(tostr(value)));
    this.value = value;
    this.line = line;
  }
}
export class MR {
  v: any[];
  constructor(v: any[]) { this.v = v; }
}
export const L = { v: 0 }; // current line (shared)

export class LuaTable {
  arr: any[] = [];
  hash: Map<any, any> | null = null;
  meta: LuaTable | null = null;
  getRaw(k: any) {
    if (typeof k === 'number') {
      const a = this.arr;
      if (k > 0 && k <= a.length && (k | 0) === k) return a[k - 1];
    }
    return this.hash === null ? undefined : this.hash.get(k);
  }
  setRaw(k: any, v: any) {
    const a = this.arr;
    if (typeof k === 'number' && k > 0 && (k | 0) === k) {
      const n = a.length;
      if (k <= n) {
        if (v === undefined && k === n) {
          a.pop();
          while (a.length && a[a.length - 1] === undefined) a.pop();
        } else a[k - 1] = v;
        return;
      }
      if (k === n + 1) {
        if (v === undefined) { if (this.hash) this.hash.delete(k); return; }
        a.push(v);
        if (this.hash !== null && this.hash.size > 0) {
          if (this.hash.has(k)) this.hash.delete(k);
          let nk = k + 1, x;
          while ((x = this.hash.get(nk)) !== undefined) { a.push(x); this.hash.delete(nk); nk++; }
        }
        return;
      }
    }
    if (k === undefined) throw rtError('table index is nil');
    if (v === undefined) { if (this.hash) this.hash.delete(k); return; }
    if (this.hash === null) this.hash = new Map();
    this.hash.set(k, v);
  }
}

export class Coroutine {
  fn: any; it: any = null; status = 'suspended';
  constructor(fn: any) { this.fn = fn; }
}

export const rtError = (msg: string) => new LuaError(msg, L.v);
const GenFn = (function* () {}).constructor;

export function typeName(v: any) {
  switch (typeof v) {
    case 'undefined': return 'nil';
    case 'number': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'function': return 'function';
  }
  if (v instanceof LuaTable) return 'table';
  if (v instanceof Coroutine) return 'thread';
  return 'userdata';
}

/* ---------- number formatting / conversion ---------- */
export function fmtnum(n: number) {
  if (Number.isInteger(n)) return String(n);
  if (n !== n) return '0';
  if (n === Infinity) return '32767.99999';
  if (n === -Infinity) return '-32768';
  let s = n.toFixed(4);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
export function hexnum(v: number) {
  const x = Math.round(v * 65536) >>> 0;
  return '0x' + (x >>> 16).toString(16).padStart(4, '0') + '.' + (x & 0xffff).toString(16).padStart(4, '0');
}
export function tostr(v: any, hex?: any): string {
  switch (typeof v) {
    case 'string': return v;
    case 'number': return hex ? hexnum(v) : fmtnum(v);
    case 'boolean': return v ? 'true' : 'false';
    case 'undefined': return '[nil]';
    case 'function': return '[function]';
  }
  if (v instanceof LuaTable) return '[table]';
  if (v instanceof Coroutine) return '[thread]';
  return '[' + typeName(v) + ']';
}
export function str2num(s: string): number | undefined {
  s = s.trim();
  if (/^[-+]?0[xX][0-9a-fA-F]*\.?[0-9a-fA-F]*$/.test(s)) {
    let neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    const [ip, fp = ''] = s.slice(2).split('.');
    let v = parseInt(ip || '0', 16);
    if (fp) v += parseInt(fp, 16) / Math.pow(16, fp.length);
    if (isNaN(v)) return undefined;
    return neg ? -v : v;
  }
  if (/^[-+]?0[bB][01]+$/.test(s)) return parseInt(s.replace(/^([-+]?)0[bB]/, '$1'), 2);
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return Number(s);
  return undefined;
}

/* ---------- operations ---------- */
export const S = (r: any) => (r instanceof MR ? r.v[0] : r);
export const M = (r: any) => (r instanceof MR ? r.v : [r]);
export const pk = (a: any[]) => (a.length === 0 ? undefined : a.length === 1 ? a[0] : new MR(a));
export const T = (v: any) => v !== undefined && v !== false;

/* flip(): en modo generador hace yield de FLIP_MARK; fuera de él no hace nada */
export const FLIP_MARK = { flip: true };
export function FLIP() {}

export function callSync(f: any, ...args: any[]) {
  if (typeof f !== 'function') f = callable(f);
  if (f.constructor === GenFn) {
    const it = f(...args);
    let r = it.next();
    while (!r.done) {
      // flip() dentro de _update/_draw/consola: no se puede esperar, se ignora
      if (r.value !== FLIP_MARK) throw rtError('attempt to yield from outside a coroutine');
      r = it.next();
    }
    return r.value;
  }
  return f(...args);
}
function callable(f: any) {
  if (f instanceof LuaTable && f.meta) {
    const h = f.meta.getRaw('__call');
    if (h !== undefined) return (...a: any[]) => callSync(h, f, ...a);
  }
  throw rtError('attempt to call a ' + typeName(f) + ' value');
}
export const call = (f: any) => (typeof f === 'function' ? f : callable(f));
export function YIELD() { throw rtError('attempt to yield from outside a coroutine'); }
export function* callg(f: any, ...args: any[]) {
  if (typeof f !== 'function') {
    if (f instanceof LuaTable && f.meta && f.meta.getRaw('__call') !== undefined) { args.unshift(f); f = f.meta.getRaw('__call'); }
    else throw rtError('attempt to call a ' + typeName(f) + ' value');
  }
  if (f === YIELD) { return yield args; }
  if (f === FLIP) { yield FLIP_MARK; return; }
  if (f.constructor === GenFn) return yield* f(...args);
  return f(...args);
}

const strlib: any = {
  sub: (s: string, i?: number, j?: number) => substr(s, i, j),
  len: (s: string) => s.length,
  upper: (s: string) => s.toUpperCase(),
  lower: (s: string) => s.toLowerCase(),
};
export function substr(s: string, i?: number, j?: number) {
  const l = s.length;
  i = i === undefined ? 1 : Math.floor(i);
  j = j === undefined ? -1 : Math.floor(j);
  if (i < 0) i = Math.max(l + i + 1, 1); else if (i === 0) i = 1;
  if (j < 0) j = l + j + 1; else if (j > l) j = l;
  return i > j ? '' : s.slice(i - 1, j);
}

export function index(o: any, k: any): any {
  if (o instanceof LuaTable) {
    const v = o.getRaw(k);
    if (v !== undefined || o.meta === null) return v;
    const h = o.meta.getRaw('__index');
    if (h === undefined) return undefined;
    if (typeof h === 'function') return S(callSync(h, o, k));
    return index(h, k);
  }
  if (typeof o === 'string') return strlib[k];
  throw rtError('attempt to index a ' + typeName(o) + ' value');
}
export function setindex(o: any, k: any, v: any) {
  if (o instanceof LuaTable) {
    if (o.meta === null) { o.setRaw(k, v); return; }
    const h = o.meta.getRaw('__newindex');
    if (h === undefined || o.getRaw(k) !== undefined) { o.setRaw(k, v); return; }
    if (typeof h === 'function') { callSync(h, o, k, v); return; }
    setindex(h, k, v); return;
  }
  throw rtError('attempt to index a ' + typeName(o) + ' value');
}

function metaOf(a: any, b: any, name: string) {
  if (a instanceof LuaTable && a.meta) { const h = a.meta.getRaw(name); if (h !== undefined) return h; }
  if (b instanceof LuaTable && b.meta) { const h = b.meta.getRaw(name); if (h !== undefined) return h; }
  return undefined;
}
const numOf = (v: any) => (typeof v === 'number' ? v : typeof v === 'string' ? str2num(v) : undefined);
function arith(name: string, a: any, b: any, f: (x: number, y: number) => number) {
  const x = numOf(a), y = numOf(b);
  if (x === undefined || y === undefined) {
    const mm = metaOf(a, b, '__' + name);
    if (mm !== undefined) return S(callSync(mm, a, b));
    throw rtError('attempt to perform arithmetic on a ' + typeName(x === undefined ? a : b) + ' value');
  }
  return f(x, y);
}
const fdiv = (x: number, y: number) => (y === 0 ? (x === 0 ? 0 : x > 0 ? 32767.99998 : -32768) : x / y);
const fmod = (x: number, y: number) => (y === 0 ? 0 : x - Math.floor(x / y) * y);
const fidiv = (x: number, y: number) => (y === 0 ? (x === 0 ? 0 : x > 0 ? 32767.99998 : -32768) : Math.floor(x / y));
export const add = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a + b : arith('add', a, b, (x, y) => x + y));
export const sub = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a - b : arith('sub', a, b, (x, y) => x - y));
export const mul = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a * b : arith('mul', a, b, (x, y) => x * y));
export const div = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? fdiv(a, b) : arith('div', a, b, fdiv));
export const mod = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? fmod(a, b) : arith('mod', a, b, fmod));
export const idiv = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? fidiv(a, b) : arith('idiv', a, b, fidiv));
export const pow = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? Math.pow(a, b) : arith('pow', a, b, Math.pow));
export const neg = (a: any) => {
  if (typeof a === 'number') return -a;
  const x = numOf(a);
  if (x !== undefined) return -x;
  const mm = metaOf(a, a, '__unm');
  if (mm !== undefined) return S(callSync(mm, a, a));
  throw rtError('attempt to perform arithmetic on a ' + typeName(a) + ' value');
};
export function len(a: any) {
  if (typeof a === 'string') return a.length;
  if (a instanceof LuaTable) {
    if (a.meta) { const h = a.meta.getRaw('__len'); if (h !== undefined) return S(callSync(h, a)); }
    return a.arr.length;
  }
  throw rtError('attempt to get length of a ' + typeName(a) + ' value');
}
export function cat(a: any, b: any) {
  const ta = typeof a, tb = typeof b;
  if ((ta === 'string' || ta === 'number') && (tb === 'string' || tb === 'number'))
    return (ta === 'string' ? a : fmtnum(a)) + (tb === 'string' ? b : fmtnum(b));
  const mm = metaOf(a, b, '__concat');
  if (mm !== undefined) return S(callSync(mm, a, b));
  throw rtError('attempt to concatenate a ' + typeName(ta === 'string' || ta === 'number' ? b : a) + ' value');
}
export function eq(a: any, b: any) {
  if (a === b) return true;
  if (a instanceof LuaTable && b instanceof LuaTable) {
    const mm = metaOf(a, b, '__eq');
    if (mm !== undefined) return T(S(callSync(mm, a, b)));
  }
  return false;
}
function cmp(a: any, b: any, name: string, f: (x: any, y: any) => boolean) {
  if (typeof a === 'string' && typeof b === 'string') return f(a, b);
  const mm = metaOf(a, b, name);
  if (mm !== undefined) return T(S(callSync(mm, a, b)));
  throw rtError('attempt to compare ' + typeName(a) + ' with ' + typeName(b));
}
export const lt = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a < b : cmp(a, b, '__lt', (x, y) => x < y));
export const le = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a <= b : cmp(a, b, '__le', (x, y) => x <= y));
export const gt = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a > b : cmp(b, a, '__lt', (x, y) => x < y));
export const ge = (a: any, b: any) => (typeof a === 'number' && typeof b === 'number' ? a >= b : cmp(b, a, '__le', (x, y) => x <= y));

/* 16.16 fixed point bit ops */
const fx = (v: any) => {
  const n = numOf(v);
  if (n === undefined) throw rtError('attempt to perform bitwise operation on a ' + typeName(v) + ' value');
  return Math.round(n * 65536) | 0;
};
const ff = (i: number) => i / 65536;
export const band = (a: any, b: any) => ff(fx(a) & fx(b));
export const bor = (a: any, b: any) => ff(fx(a) | fx(b));
export const bxor = (a: any, b: any) => ff(fx(a) ^ fx(b));
export const bnot = (a: any) => ff(~fx(a));
const sh = (b: any) => Math.floor(numOf(b) || 0);
export const shl = (a: any, b: any) => { const n = sh(b); return n >= 32 || n <= -32 ? 0 : n < 0 ? ff(fx(a) >> -n) : ff(fx(a) << n); };
export const shr = (a: any, b: any) => { const n = sh(b); return n >= 32 ? (fx(a) < 0 ? -1 / 65536 : 0) : n <= -32 ? 0 : n < 0 ? ff(fx(a) << -n) : ff(fx(a) >> n); };
export const lshr = (a: any, b: any) => { const n = sh(b); return n >= 32 || n <= -32 ? 0 : n < 0 ? ff(fx(a) << -n) : ff((fx(a) >>> n) | 0); };
export const rotl = (a: any, b: any) => { const x = fx(a), n = ((sh(b) % 32) + 32) % 32; return ff(((x << n) | (x >>> (32 - n))) | 0); };
export const rotr = (a: any, b: any) => { const x = fx(a), n = ((sh(b) % 32) + 32) % 32; return ff(((x >>> n) | (x << (32 - n))) | 0); };

export function tbl(arr?: any[], pairs?: any[]) {
  const t = new LuaTable();
  if (arr) {
    let n = arr.length;
    while (n > 0 && arr[n - 1] === undefined) n--;
    arr.length = n;
    t.arr = arr;
  }
  if (pairs) for (let i = 0; i < pairs.length; i += 2) t.setRaw(pairs[i], pairs[i + 1]);
  return t;
}

/* ---------- loop guard ---------- */
let chkCount = 0;
export const guard = { start: 0, limit: 6000 };
export function chk() {
  if ((++chkCount & 0x3fff) === 0 && guard.start && performance.now() - guard.start > guard.limit)
    throw rtError('program ran too long (infinite loop?)');
}

/* ---------- lexer ---------- */
const KEYWORDS = new Set(['and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function', 'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then', 'true', 'until', 'while']);
const OPS = new Set(['>>>=', '<<>=', '>><=', '...', '>>>', '<<>', '>><', '^^=', '..=', '<<=', '>>=', '==', '~=', '!=', '<=', '>=', '..', '::', '+=', '-=', '*=', '/=', '\\=', '%=', '^=', '|=', '&=', '<<', '>>', '^^']);
const SINGLE = '+-*/%^#&|~<>=(){}[];:,.\\@$?';
const GLYPH_BTN: Record<number, number> = { 0x2b05: 0, 0x27a1: 1, 0x2b06: 2, 0x2b07: 3, 0x1f17e: 4, 0x274e: 5 };

interface Tok { t: string; v: any; line: number; }

export function lex(src: string): Tok[] {
  const toks: Tok[] = [];
  const n = src.length;
  let i = 0, line = 1;
  const reNum = /0[xX][0-9a-fA-F]*(?:\.[0-9a-fA-F]*)?|0[bB][01]*(?:\.[01]*)?|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  const reName = /[A-Za-z_][A-Za-z0-9_]*/y;
  const reLong = /\[(=*)\[/y;
  const err = (m: string) => { throw new LuaError(m, line); };
  const longStr = (start: number): string => {
    reLong.lastIndex = start;
    const m = reLong.exec(src)!;
    const close = ']' + m[1] + ']';
    const from = start + m[0].length;
    const e = src.indexOf(close, from);
    if (e < 0) err('unfinished long string/comment');
    let s = src.slice(from, e);
    for (let k = 0; k < s.length; k++) if (s[k] === '\n') line++;
    i = e + close.length;
    return s[0] === '\n' ? s.slice(1) : s;
  };
  const startsLong = (p: number) => { reLong.lastIndex = p; return src[p] === '[' && reLong.test(src); };
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\uFE0F') { i++; continue; }
    if ((c === '-' && src[i + 1] === '-') || (c === '/' && src[i + 1] === '/')) {
      const isDash = c === '-';
      i += 2;
      if (isDash && startsLong(i)) { longStr(i); continue; }
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      let s = '';
      i++;
      for (;;) {
        if (i >= n || src[i] === '\n') err('unfinished string');
        const d = src[i];
        if (d === c) { i++; break; }
        if (d === '\\') {
          const e = src[i + 1];
          i += 2;
          switch (e) {
            case 'n': s += '\n'; break;
            case 'r': s += '\r'; break;
            case 't': s += '\t'; break;
            case 'a': s += '\x07'; break;
            case 'b': s += '\b'; break;
            case 'f': s += '\f'; break;
            case 'v': s += '\v'; break;
            case '\\': s += '\\'; break;
            case '"': s += '"'; break;
            case "'": s += "'"; break;
            case '\n': s += '\n'; line++; break;
            case 'x': s += String.fromCharCode(parseInt(src.substr(i, 2), 16)); i += 2; break;
            case 'z': while (i < n && /\s/.test(src[i])) { if (src[i] === '\n') line++; i++; } break;
            default:
              if (e >= '0' && e <= '9') {
                let k = e;
                while (k.length < 3 && src[i] >= '0' && src[i] <= '9') k += src[i++];
                s += String.fromCharCode(parseInt(k, 10));
              } else s += '\\' + e;
          }
          continue;
        }
        s += d; i++;
      }
      toks.push({ t: 'str', v: s, line });
      continue;
    }
    if (c === '[' && startsLong(i)) { const l0 = line; const s = longStr(i); toks.push({ t: 'str', v: s, line: l0 }); continue; }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      reNum.lastIndex = i;
      const m = reNum.exec(src)![0];
      i += m.length;
      let v: number;
      if (/^0[xXbB]/.test(m)) {
        const bin = m[1] === 'b' || m[1] === 'B';
        const [ip, fp = ''] = m.slice(2).split('.');
        let a = parseInt(ip || '0', bin ? 2 : 16) & 0xffff;
        if (a >= 0x8000) a -= 0x10000;
        const base = bin ? 2 : 16;
        v = a + (fp ? parseInt(fp, base) / Math.pow(base, fp.length) : 0);
      } else v = Number(m);
      toks.push({ t: 'num', v, line });
      continue;
    }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      reName.lastIndex = i;
      const m = reName.exec(src)![0];
      i += m.length;
      toks.push({ t: KEYWORDS.has(m) ? 'kw' : 'name', v: m, line });
      continue;
    }
    const cp = src.codePointAt(i)!;
    if (GLYPH_BTN[cp] !== undefined) { toks.push({ t: 'num', v: GLYPH_BTN[cp], line }); i += cp > 0xffff ? 2 : 1; continue; }
    const s4 = src.substr(i, 4), s3 = src.substr(i, 3), s2 = src.substr(i, 2);
    if (OPS.has(s4)) { toks.push({ t: 'op', v: s4, line }); i += 4; continue; }
    if (OPS.has(s3)) { toks.push({ t: 'op', v: s3, line }); i += 3; continue; }
    if (OPS.has(s2)) { toks.push({ t: 'op', v: s2, line }); i += 2; continue; }
    if (SINGLE.includes(c)) { toks.push({ t: 'op', v: c, line }); i++; continue; }
    err("unexpected symbol near '" + c + "'");
  }
  toks.push({ t: 'eof', v: '<eof>', line });
  return toks;
}

/* PICO-8 style token counter */
export function countTokens(src: string): number {
  try {
    const t = lex(src);
    let n = 0;
    for (const k of t) {
      if (k.t === 'eof') continue;
      if (k.t === 'kw' && (k.v === 'end' || k.v === 'local')) continue;
      if (k.t === 'op' && '(){}[],.:;'.includes(k.v) && k.v.length === 1) continue;
      if (k.t === 'op' && k.v === '::') continue;
      n++;
    }
    return n;
  } catch { return 0; }
}

/* ---------- compiler ---------- */
interface Ex { c: string; m?: boolean; b?: boolean; va?: boolean; call?: boolean; num?: number; lv?: any; }

class FS {
  parent: FS | null; scopes: Map<string, string>[] = [new Map()]; tmp = 0; vararg = false;
  constructor(p: FS | null) { this.parent = p; }
}

const BIN: Record<string, [number, number]> = {
  or: [1, 1], and: [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '!=': [3, 3], '==': [3, 3],
  '|': [4, 4], '~': [5, 5], '^^': [5, 5], '&': [6, 6],
  '<<': [7, 7], '>>': [7, 7], '>>>': [7, 7], '<<>': [7, 7], '>><': [7, 7],
  '..': [9, 8], '+': [10, 10], '-': [10, 10], '*': [11, 11], '/': [11, 11], '\\': [11, 11], '%': [11, 11], '^': [14, 13],
};
const FN: Record<string, string> = {
  '+': '$add', '-': '$sub', '*': '$mul', '/': '$div', '%': '$mod', '^': '$pow', '\\': '$idiv', '..': '$cat',
  '&': '$band', '|': '$bor', '~': '$bxor', '^^': '$bxor', '<<': '$shl', '>>': '$shr', '>>>': '$lshr', '<<>': '$rotl', '>><': '$rotr',
  '<': '$lt', '<=': '$le', '>': '$gt', '>=': '$ge',
};
const COMPOUND: Record<string, string> = {
  '+=': '+', '-=': '-', '*=': '*', '/=': '/', '\\=': '\\', '%=': '%', '^=': '^', '..=': '..', '|=': '|', '&=': '&', '^^=': '^^',
  '<<=': '<<', '>>=': '>>', '>>>=': '>>>', '<<>=': '<<>', '>><=': '>><',
};
const BLOCK_END = new Set(['end', 'else', 'elseif', 'until']);
const J = JSON.stringify;

class Compiler {
  toks: Tok[]; p = 0; gen: boolean; fs: FS; uid = 0;
  constructor(src: string, gen: boolean) {
    this.toks = lex(src); this.gen = gen; this.fs = new FS(null); this.fs.vararg = true;
  }
  get tk() { return this.toks[this.p]; }
  next() { return this.toks[this.p++]; }
  err(msg?: string): never {
    const t = this.tk;
    throw new LuaError(msg || "syntax error near '" + (t.t === 'eof' ? '<eof>' : String(t.v)) + "'", t.line);
  }
  isOp(v: string) { const t = this.tk; return t.t === 'op' && t.v === v; }
  isKw(v: string) { const t = this.tk; return t.t === 'kw' && t.v === v; }
  acceptOp(v: string) { if (this.isOp(v)) { this.p++; return true; } return false; }
  acceptKw(v: string) { if (this.isKw(v)) { this.p++; return true; } return false; }
  expectOp(v: string) { if (!this.acceptOp(v)) this.err(); }
  expectKw(v: string) { if (!this.acceptKw(v)) this.err("'" + v + "' expected near '" + String(this.tk.v) + "'"); }
  expectName(): string { const t = this.tk; if (t.t !== 'name') this.err(); this.p++; return t.v; }
  tmp() { return '$' + ++this.fs.tmp; }
  tempDecl(fs: FS) { if (!fs.tmp) return ''; const a = []; for (let i = 1; i <= fs.tmp; i++) a.push('$' + i); return 'let ' + a.join(',') + ';'; }

  declare(name: string) {
    const js = name.replace(/[^A-Za-z0-9_]/g, '_') + '$' + this.uid++;
    this.fs.scopes[this.fs.scopes.length - 1].set(name, js);
    return js;
  }
  resolve(name: string): string | null {
    for (let f: FS | null = this.fs; f; f = f.parent)
      for (let i = f.scopes.length - 1; i >= 0; i--) { const v = f.scopes[i].get(name); if (v) return v; }
    return null;
  }
  push() { this.fs.scopes.push(new Map()); }
  pop() { this.fs.scopes.pop(); }

  chunk() {
    const body = this.stats();
    if (this.tk.t !== 'eof') this.err();
    const names = ['$idx', '$setidx', '$call', '$cg', '$S', '$M', '$pk', '$T', '$tbl', '$MR', '$chk', '$add', '$sub', '$mul', '$div', '$mod', '$pow', '$idiv', '$cat', '$band', '$bor', '$bxor', '$shl', '$shr', '$lshr', '$rotl', '$rotr', '$lt', '$le', '$gt', '$ge', '$eq', '$neg', '$len', '$bnot', '$peek', '$peek2', '$peek4', '$G', '$L'];
    return '"use strict";const {' + names.join(',') + '}=$r;return function' + (this.gen ? '*' : '') + '(...$va){' + this.tempDecl(this.fs) + body + '}';
  }

  stats(): string {
    let out = '';
    for (;;) {
      const t = this.tk;
      if (t.t === 'eof' || (t.t === 'kw' && BLOCK_END.has(t.v))) break;
      if (this.acceptOp(';')) continue;
      out += this.statement();
    }
    return out;
  }
  block() { this.push(); const c = this.stats(); this.pop(); return c; }
  stmtsOnLine(line: number) {
    let out = '';
    this.push();
    for (;;) {
      const t = this.tk;
      if (t.t === 'eof' || t.line !== line || (t.t === 'kw' && BLOCK_END.has(t.v))) break;
      if (this.acceptOp(';')) continue;
      out += this.statement();
    }
    this.pop();
    return out;
  }

  single(e: Ex) { return e.m ? (e.va ? '$va[0]' : '$S(' + e.c + ')') : e.c; }
  listCode(list: Ex[]) {
    return list.map((e, i) => (i < list.length - 1 ? this.single(e) : e.m ? (e.va ? '...$va' : '...$M(' + e.c + ')') : e.c)).join(',');
  }
  cond(e: Ex) { return e.b ? e.c : '$T(' + this.single(e) + ')'; }
  varRef(name: string): Ex {
    const l = this.resolve(name);
    const c = l || '$G[' + J(name) + ']';
    return { c, lv: { k: 'var', c } };
  }
  assign(lv: any, val: string) {
    return lv.k === 'var' ? lv.c + '=' + val + ';' : '$setidx(' + lv.o + ',' + lv.key + ',' + val + ');';
  }

  statement(): string {
    const t = this.tk;
    const pre = '$L.v=' + t.line + ';';
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': return pre + this.ifStat();
        case 'while': {
          this.next();
          const c = this.cond(this.expr());
          let body: string;
          if (this.acceptKw('do')) { body = this.block(); this.expectKw('end'); }
          else body = this.stmtsOnLine(this.toks[this.p - 1].line);
          return pre + 'while(' + c + '){$chk();' + body + '}';
        }
        case 'for': return pre + this.forStat();
        case 'repeat': {
          this.next();
          this.push();
          const body = this.stats();
          this.expectKw('until');
          const c = this.cond(this.expr());
          this.pop();
          return pre + 'do{$chk();' + body + 'if(' + c + ')break;}while(true);';
        }
        case 'do': { this.next(); const b = this.block(); this.expectKw('end'); return '{' + b + '}'; }
        case 'function': return pre + this.funcStat();
        case 'local': return pre + this.localStat();
        case 'return': return pre + this.returnStat();
        case 'break': this.next(); return 'break;';
        case 'goto': this.err('goto is not supported');
      }
      this.err();
    }
    if (t.t === 'op' && t.v === '?') {
      this.next();
      const list = this.explist();
      return pre + this.makeCall({ c: '$G["print"]' }, [this.listCode(list)].filter((x) => x)).c + ';';
    }
    return pre + this.exprStat();
  }

  ifStat(): string {
    this.next();
    const c = this.cond(this.expr());
    if (this.acceptKw('then')) {
      let out = 'if(' + c + '){' + this.block() + '}';
      for (;;) {
        if (this.acceptKw('elseif')) {
          const c2 = this.cond(this.expr());
          this.expectKw('then');
          out += 'else if(' + c2 + '){' + this.block() + '}';
        } else if (this.acceptKw('else')) {
          out += 'else{' + this.block() + '}';
          this.expectKw('end');
          break;
        } else { this.expectKw('end'); break; }
      }
      return out;
    }
    const ln = this.toks[this.p - 1].line;
    let out = 'if(' + c + '){' + this.stmtsOnLine(ln) + '}';
    if (this.isKw('else') && this.tk.line === ln) { this.next(); out += 'else{' + this.stmtsOnLine(ln) + '}'; }
    return out;
  }

  forStat(): string {
    this.next();
    const n1 = this.expectName();
    const u = this.uid++;
    if (this.acceptOp('=')) {
      const e1 = this.single(this.expr());
      this.expectOp(',');
      const e2 = this.single(this.expr());
      let step: Ex | null = null;
      if (this.acceptOp(',')) step = this.expr();
      this.expectKw('do');
      this.push();
      const jn = this.declare(n1);
      const body = this.stats();
      this.pop();
      this.expectKw('end');
      const i = '$i' + u, l = '$l' + u, s = '$s' + u;
      const sc = step ? this.single(step) : '1';
      let test: string;
      if (!step || (step.num !== undefined && step.num > 0)) test = i + '<=' + l;
      else if (step.num !== undefined && step.num < 0) test = i + '>=' + l;
      else test = '(' + s + '>0?' + i + '<=' + l + ':' + i + '>=' + l + ')';
      return 'for(let ' + i + '=' + e1 + ',' + l + '=' + e2 + ',' + s + '=' + sc + ';' + test + ';' + i + '+=' + s + '){let ' + jn + '=' + i + ';' + body + '}';
    }
    const names = [n1];
    while (this.acceptOp(',')) names.push(this.expectName());
    this.expectKw('in');
    const exps = this.explist();
    this.expectKw('do');
    this.push();
    const jns = names.map((n) => this.declare(n));
    const body = this.stats();
    this.pop();
    this.expectKw('end');
    const f = '$f' + u, s = '$s' + u, c = '$c' + u, r = '$r' + u, a = '$a' + u;
    const callc = this.gen ? '(yield* $cg(' + f + ',' + s + ',' + c + '))' : '$call(' + f + ')(' + s + ',' + c + ')';
    let assigns = '';
    jns.forEach((jn, k) => { assigns += 'let ' + jn + '=' + r + ' instanceof $MR?' + r + '.v[' + k + ']:' + (k === 0 ? r : 'undefined') + ';'; });
    return '{const ' + a + '=[' + this.listCode(exps) + '];const ' + f + '=' + a + '[0],' + s + '=' + a + '[1];let ' + c + '=' + a + '[2];for(;;){const ' + r + '=' + callc + ';' + assigns + 'if(' + jns[0] + '===undefined)break;' + c + '=' + jns[0] + ';' + body + '}}';
  }

  funcStat(): string {
    this.next();
    const n1 = this.expectName();
    let lv = this.varRef(n1).lv;
    let cur = lv.c;
    let isMethod = false;
    while (this.isOp('.') || this.isOp(':')) {
      const colon = this.isOp(':');
      this.next();
      const k = this.expectName();
      lv = { k: 'idx', o: cur, key: J(k) };
      cur = '$idx(' + cur + ',' + J(k) + ')';
      if (colon) { isMethod = true; break; }
    }
    return this.assign(lv, this.funcBody(isMethod));
  }

  localStat(): string {
    this.next();
    if (this.acceptKw('function')) {
      const name = this.expectName();
      const js = this.declare(name);
      return 'let ' + js + ';' + js + '=' + this.funcBody(false) + ';';
    }
    const names = [this.expectName()];
    while (this.acceptOp(',')) names.push(this.expectName());
    const exps = this.acceptOp('=') ? this.explist() : [];
    const jns = names.map((n) => this.declare(n));
    if (exps.length === 0) return 'let ' + jns.join(',') + ';';
    if (exps.length === names.length) return 'let ' + jns.map((j, i) => j + '=' + this.single(exps[i])).join(',') + ';';
    const t = this.tmp();
    return t + '=[' + this.listCode(exps) + '];let ' + jns.map((j, i) => j + '=' + t + '[' + i + ']').join(',') + ';';
  }

  returnStat(): string {
    const rt = this.next();
    const t = this.tk;
    if (t.t === 'eof' || t.line !== rt.line || (t.t === 'kw' && BLOCK_END.has(t.v)) || (t.t === 'op' && t.v === ';')) return 'return;';
    const list = this.explist();
    if (list.length === 1) {
      const e = list[0];
      if (e.va) return 'return $pk($va);';
      return 'return ' + e.c + ';';
    }
    return 'return new $MR([' + this.listCode(list) + ']);';
  }

  exprStat(): string {
    const e = this.suffixed();
    if (this.isOp('=') || this.isOp(',')) {
      const targets = [e];
      while (this.acceptOp(',')) targets.push(this.suffixed());
      this.expectOp('=');
      const exps = this.explist();
      for (const x of targets) if (!x.lv) this.err('cannot assign to expression');
      if (targets.length === 1 && exps.length === 1) return this.assign(e.lv, this.single(exps[0]));
      const t = this.tmp();
      let out = t + '=[' + this.listCode(exps) + '];';
      targets.forEach((x, i) => { out += this.assign(x.lv, t + '[' + i + ']'); });
      return out;
    }
    const t = this.tk;
    if (t.t === 'op' && COMPOUND[t.v]) {
      this.next();
      const op = COMPOUND[t.v];
      const rhs = this.single(this.expr());
      if (!e.lv) this.err('cannot assign to expression');
      if (e.lv.k === 'var') return e.lv.c + '=' + FN[op] + '(' + e.lv.c + ',' + rhs + ');';
      const a = this.tmp(), b = this.tmp();
      return a + '=' + e.lv.o + ';' + b + '=' + e.lv.key + ';$setidx(' + a + ',' + b + ',' + FN[op] + '($idx(' + a + ',' + b + '),' + rhs + '));';
    }
    if (!e.call) this.err();
    return e.c + ';';
  }

  explist(): Ex[] {
    const l = [this.expr()];
    while (this.acceptOp(',')) l.push(this.expr());
    return l;
  }
  expr(): Ex { return this.subexpr(0); }

  subexpr(limit: number): Ex {
    let left: Ex;
    const t = this.tk;
    if ((t.t === 'kw' && t.v === 'not') || (t.t === 'op' && (t.v === '-' || t.v === '#' || t.v === '~' || t.v === '@' || t.v === '%' || t.v === '$'))) {
      this.next();
      const o = this.subexpr(12);
      switch (t.v) {
        case 'not': left = { c: '!' + this.cond(o), b: true }; break;
        case '-': left = o.num !== undefined ? { c: '(' + -o.num + ')', num: -o.num } : { c: '$neg(' + this.single(o) + ')' }; break;
        case '#': left = { c: '$len(' + this.single(o) + ')' }; break;
        case '~': left = { c: '$bnot(' + this.single(o) + ')' }; break;
        case '@': left = { c: '$peek(' + this.single(o) + ')' }; break;
        case '%': left = { c: '$peek2(' + this.single(o) + ')' }; break;
        default: left = { c: '$peek4(' + this.single(o) + ')' };
      }
    } else left = this.simple();
    for (;;) {
      const o = this.tk;
      const key = o.t === 'op' || (o.t === 'kw' && (o.v === 'and' || o.v === 'or')) ? o.v : null;
      const pr = key !== null ? BIN[key] : undefined;
      if (!pr || pr[0] <= limit) break;
      this.next();
      const right = this.subexpr(pr[1]);
      left = this.bin(key!, left, right);
    }
    return left;
  }

  bin(op: string, a: Ex, b: Ex): Ex {
    if (op === 'and' || op === 'or') {
      if (a.b) return { c: '(' + a.c + (op === 'and' ? '&&' : '||') + this.single(b) + ')', b: !!b.b };
      const t = this.tmp();
      const A = this.single(a), B = this.single(b);
      return op === 'and'
        ? { c: '((' + t + '=' + A + ')===undefined||' + t + '===false?' + t + ':' + B + ')' }
        : { c: '((' + t + '=' + A + ')!==undefined&&' + t + '!==false?' + t + ':' + B + ')' };
    }
    const A = this.single(a), B = this.single(b);
    if (op === '==') return { c: '$eq(' + A + ',' + B + ')', b: true };
    if (op === '~=' || op === '!=') return { c: '!$eq(' + A + ',' + B + ')', b: true };
    const f = FN[op];
    return { c: f + '(' + A + ',' + B + ')', b: op === '<' || op === '<=' || op === '>' || op === '>=' };
  }

  simple(): Ex {
    const t = this.tk;
    switch (t.t) {
      case 'num': this.next(); return { c: t.v < 0 ? '(' + t.v + ')' : String(t.v), num: t.v };
      case 'str': this.next(); return { c: J(t.v) };
      case 'kw':
        if (t.v === 'nil') { this.next(); return { c: 'undefined' }; }
        if (t.v === 'true') { this.next(); return { c: 'true', b: true }; }
        if (t.v === 'false') { this.next(); return { c: 'false', b: true }; }
        if (t.v === 'function') { this.next(); return { c: this.funcBody(false) }; }
        break;
      case 'op':
        if (t.v === '...') { this.next(); return { c: '$va', m: true, va: true }; }
        if (t.v === '{') return this.tableCons();
        break;
    }
    return this.suffixed();
  }

  tableCons(): Ex {
    this.expectOp('{');
    const pos: Ex[] = [];
    const pairs: string[] = [];
    let lastPos = false;
    while (!this.isOp('}')) {
      lastPos = false;
      if (this.isOp('[')) {
        this.next();
        const k = this.expr();
        this.expectOp(']'); this.expectOp('=');
        const v = this.expr();
        pairs.push(this.single(k), this.single(v));
      } else if (this.tk.t === 'name' && this.toks[this.p + 1].t === 'op' && this.toks[this.p + 1].v === '=') {
        const name = this.next().v;
        this.next();
        pairs.push(J(name), this.single(this.expr()));
      } else { pos.push(this.expr()); lastPos = true; }
      if (!this.acceptOp(',') && !this.acceptOp(';')) break;
    }
    this.expectOp('}');
    const items = pos.map((e, i) => (i < pos.length - 1 || !lastPos ? this.single(e) : e.m ? (e.va ? '...$va' : '...$M(' + e.c + ')') : e.c));
    if (!items.length && !pairs.length) return { c: '$tbl()' };
    return { c: '$tbl([' + items.join(',') + ']' + (pairs.length ? ',[' + pairs.join(',') + ']' : '') + ')' };
  }

  callArgs(): string[] {
    const t = this.tk;
    if (t.t === 'str') { this.next(); return [J(t.v)]; }
    if (t.t === 'op' && t.v === '{') return [this.tableCons().c];
    this.expectOp('(');
    if (this.acceptOp(')')) return [];
    const l = this.explist();
    this.expectOp(')');
    return [this.listCode(l)];
  }
  makeCall(f: Ex, args: string[]): Ex {
    const fc = this.single(f);
    const c = this.gen ? '(yield* $cg(' + [fc, ...args].join(',') + '))' : '$call(' + fc + ')(' + args.join(',') + ')';
    return { c, m: true, call: true };
  }

  suffixed(): Ex {
    let e: Ex;
    const t = this.tk;
    if (t.t === 'name') { this.next(); e = this.varRef(t.v); }
    else if (t.t === 'op' && t.v === '(') {
      this.next();
      const inner = this.expr();
      this.expectOp(')');
      e = { c: '(' + this.single(inner) + ')', b: inner.b };
    } else this.err();
    for (;;) {
      const o = this.tk;
      if (o.t === 'op') {
        if (o.v === '.') {
          this.next();
          const k = J(this.expectName());
          const b = this.single(e);
          e = { c: '$idx(' + b + ',' + k + ')', lv: { k: 'idx', o: b, key: k } };
          continue;
        }
        if (o.v === '[') {
          this.next();
          const ke = this.single(this.expr());
          this.expectOp(']');
          const b = this.single(e);
          e = { c: '$idx(' + b + ',' + ke + ')', lv: { k: 'idx', o: b, key: ke } };
          continue;
        }
        if (o.v === ':') {
          this.next();
          const k = J(this.expectName());
          const args = this.callArgs();
          const t1 = this.tmp();
          const b = this.single(e);
          const fn = '$idx(' + t1 + ',' + k + ')';
          const all = [t1, ...args].join(',');
          e = { c: this.gen ? '(' + t1 + '=' + b + ',yield* $cg(' + fn + ',' + all + '))' : '(' + t1 + '=' + b + ',$call(' + fn + ')(' + all + '))', m: true, call: true };
          continue;
        }
        if ((o.v === '(' && o.line === this.toks[this.p - 1].line) || o.v === '{') { e = this.makeCall(e, this.callArgs()); continue; }
      } else if (o.t === 'str') { e = this.makeCall(e, this.callArgs()); continue; }
      break;
    }
    return e;
  }

  funcBody(isMethod: boolean): string {
    this.expectOp('(');
    const params: string[] = isMethod ? ['self'] : [];
    let vararg = false;
    if (!this.isOp(')')) {
      do {
        if (this.acceptOp('...')) { vararg = true; break; }
        params.push(this.expectName());
      } while (this.acceptOp(','));
    }
    this.expectOp(')');
    const fs = new FS(this.fs);
    fs.vararg = vararg;
    this.fs = fs;
    const jps = params.map((n) => this.declare(n));
    const body = this.stats();
    this.expectKw('end');
    this.fs = fs.parent!;
    if (vararg) jps.push('...$va');
    return 'function' + (this.gen ? '*' : '') + '(' + jps.join(',') + '){' + this.tempDecl(fs) + body + '}';
  }
}

export const HELPERS: any = {
  $idx: index, $setidx: setindex, $call: call, $cg: callg, $S: S, $M: M, $pk: pk, $T: T, $tbl: tbl, $MR: MR, $chk: chk,
  $add: add, $sub: sub, $mul: mul, $div: div, $mod: mod, $pow: pow, $idiv: idiv, $cat: cat,
  $band: band, $bor: bor, $bxor: bxor, $shl: shl, $shr: shr, $lshr: lshr, $rotl: rotl, $rotr: rotr,
  $lt: lt, $le: le, $gt: gt, $ge: ge, $eq: eq, $neg: neg, $len: len, $bnot: bnot, $L: L,
  $peek: (a: any) => 0, $peek2: (a: any) => 0, $peek4: (a: any) => 0,
};

export const usesCoroutines = (src: string) => /\b(cocreate|coresume|costatus|yield|coroutine|flip)\b/.test(src);

/** Chunk principal + _init como un único generador (permite flip() en ambos). */
export function* bootSeq(main: any, G: any) {
  yield* callg(main);
  if (typeof G._init === 'function') yield* callg(G._init);
}

/** Compile Lua source; returns a function to run (generator function in coroutine mode). */
export function compileLua(src: string, G: any, gen: boolean) {
  const js = new Compiler(src, gen).chunk();
  const r = Object.assign({}, HELPERS, { $G: G });
  let factory: any;
  try { factory = new Function('$r', js); }
  catch (e: any) { throw new LuaError('internal compile error: ' + e.message, 0); }
  return factory(r);
}
export function setPeekers(p: any) { HELPERS.$peek = p.peek; HELPERS.$peek2 = p.peek2; HELPERS.$peek4 = p.peek4; }

/* ---------- globals table & stdlib ---------- */
export function errValue(e: any) {
  if (e instanceof LuaError) return e.value;
  if (e instanceof RangeError) return 'stack overflow';
  return String(e && e.message ? e.message : e);
}


let rngHi = 0;
let rngLo = 0;

function picoRnd(n = 1): number {
  // Intercambiar las dos mitades de 16 bits de hi.
  rngHi = (((rngHi << 16) | (rngHi >>> 16)) + rngLo) >>> 0;

  // Actualizar lo.
  rngLo = (rngLo + rngHi) >>> 0;

  const hiSigned = rngHi | 0;
  const hiValue = hiSigned / 65536;

  // Compatibilidad con límites negativos.
  if (n < 0) {
    return n <= hiValue && hiValue < 0
      ? hiValue - n
      : hiValue;
  }

  // hi % n considerando hi como entero sin signo.
  const positiveHi = (rngHi & 0x7fffffff) / 65536;

  return ((hiValue < 0 ? 32768 - n : 0) + positiveHi) % n;
}

export function rand() {
  return picoRnd(1);
}

export function srand(s: number) {
  const seed = Math.floor(s * 65536);

  rngLo = seed === 0
    ? 0xdeadbeef
    : (seed & 0x7fffffff) >>> 0;

  rngHi = (rngLo ^ 0xbead29ba) >>> 0;

  // 32 iteraciones de inicialización.
  for (let i = 0; i < 32; i++) {
    picoRnd();
  }
}




const P8CHARS = ['█', '▒', '🐱', '⬇️', '░', '✽', '●', '♥', '☉', '웃', '⌂', '⬅️', '😐', '♪', '🅾️', '◆', '…', '➡️', '★', '⧗', '⬆️', 'ˇ', '∧', '❎', '▤', '▥'];
export const p8char = (n: number) => (n >= 128 && n - 128 < P8CHARS.length ? P8CHARS[n - 128] : String.fromCharCode(n));

function allIter(t: any) {
  let i = 0, last: any;
  return () => {
    if (!(t instanceof LuaTable)) return undefined;
    const a = t.arr;
    if (i > 0 && a[i - 1] !== last) i--;
    while (i < a.length) {
      last = a[i++];
      if (last !== undefined) return last;
    }
    last = undefined;
    return undefined;
  };
}

export function makeGlobals() {
  srand(0);
  const G: any = Object.create(null);
  
  const num = (v: any, d = 0) => { const n = numOf(v); return n === undefined ? d : n; };
  G.type = (v: any) => typeName(v);
  G.tostr = (...a: any[]) => (a.length === 0 ? '' : tostr(a[0], a[1]));
  G.tostring = G.tostr;
  G.tonum = (v: any, f?: any) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') return str2num(v);
    if (typeof v === 'boolean') return v ? 1 : 0;
    return undefined;
  };
  G.tonumber = G.tonum;
  G.add = (t: any, v: any, i?: any) => {
    if (!(t instanceof LuaTable)) throw rtError('attempt to index a ' + typeName(t) + ' value');
    if (v === undefined) return undefined;
    if (i !== undefined) { t.arr.splice(Math.max(0, Math.floor(i) - 1), 0, v); return v; }
    t.setRaw(t.arr.length + 1, v);
    return v;
  };
  G.del = (t: any, v: any) => {
    if (!(t instanceof LuaTable)) return undefined;
    const i = t.arr.indexOf(v);
    if (i >= 0) { t.arr.splice(i, 1); while (t.arr.length && t.arr[t.arr.length - 1] === undefined) t.arr.pop(); return v; }
    return undefined;
  };
  G.deli = (t: any, i?: any) => {
    if (!(t instanceof LuaTable)) return undefined;
    const n = t.arr.length;
    i = i === undefined ? n : Math.floor(i);
    if (i < 1 || i > n) return undefined;
    const v = t.arr.splice(i - 1, 1)[0];
    while (t.arr.length && t.arr[t.arr.length - 1] === undefined) t.arr.pop();
    return v;
  };
  G.count = (t: any, v?: any) => {
    if (!(t instanceof LuaTable)) return 0;
    if (v === undefined) { let n = 0; for (const x of t.arr) if (x !== undefined) n++; return n; }
    let n = 0; for (const x of t.arr) if (x === v) n++; return n;
  };
  G.all = (t: any) => allIter(t);
  G.foreach = (t: any, f: any) => {
    const it = allIter(t);
    for (;;) { const v = it(); if (v === undefined) break; callSync(f, v); }
  };
  G.pairs = (t: any) => {
    let i = 0, it: any = null;
    return () => {
      if (!(t instanceof LuaTable)) return undefined;
      const a = t.arr;
      while (i < a.length) { const v = a[i++]; if (v !== undefined) return new MR([i, v]); }
      if (t.hash === null) return undefined;
      if (!it) it = t.hash.entries();
      const n = it.next();
      return n.done ? undefined : new MR(n.value);
    };
  };
  G.ipairs = (t: any) => {
    let i = 0;
    return () => {
      if (!(t instanceof LuaTable)) return undefined;
      const v = t.arr[i++];
      return v === undefined ? undefined : new MR([i, v]);
    };
  };
  G.next = (t: any, k?: any) => {
    if (!(t instanceof LuaTable)) return undefined;
    const keys: any[] = [];
    t.arr.forEach((v: any, i: number) => { if (v !== undefined) keys.push(i + 1); });
    if (t.hash) for (const kk of t.hash.keys()) keys.push(kk);
    const idx = k === undefined ? 0 : keys.indexOf(k) + 1;
    if (idx >= keys.length) return undefined;
    return new MR([keys[idx], t.getRaw(keys[idx])]);
  };
  G.select = (n: any, ...a: any[]) => {
    if (n === '#') return a.length;
    n = Math.floor(num(n));
    if (n < 0) n = a.length + n + 1;
    return new MR(a.slice(n - 1));
  };
  G.unpack = (t: any, i?: any, j?: any) => {
    const s = i === undefined ? 1 : Math.floor(i), e = j === undefined ? t.arr.length : Math.floor(j);
    const r = [];
    for (let k = s; k <= e; k++) r.push(t.getRaw(k));
    return new MR(r);
  };
  G.pack = (...a: any[]) => { const t = tbl(a.slice()); t.setRaw('n', a.length); return t; };
  G.setmetatable = (t: any, m: any) => { if (t instanceof LuaTable) t.meta = m instanceof LuaTable ? m : null; return t; };
  G.getmetatable = (t: any) => (t instanceof LuaTable && t.meta ? t.meta : undefined);
  G.rawget = (t: any, k: any) => t.getRaw(k);
  G.rawset = (t: any, k: any, v: any) => { t.setRaw(k, v); return t; };
  G.rawequal = (a: any, b: any) => a === b;
  G.rawlen = (t: any) => (t instanceof LuaTable ? t.arr.length : len(t));
  G.assert = (v: any, msg?: any) => { if (v === undefined || v === false) throw rtError(msg === undefined ? 'assertion failed!' : msg); return v; };
  G.error = (msg: any) => { throw new LuaError(msg, L.v); };
  G.pcall = (f: any, ...a: any[]) => {
    try { return new MR([true, ...M(callSync(f, ...a))]); }
    catch (e: any) { return new MR([false, errValue(e)]); }
  };
  G.cocreate = (f: any) => new Coroutine(f);
  G.coresume = (co: any, ...args: any[]) => {
    if (!(co instanceof Coroutine)) return new MR([false, 'invalid coroutine']);
    if (co.status === 'dead') return new MR([false, 'cannot resume dead coroutine']);
    if (co.status !== 'suspended') return new MR([false, 'cannot resume non-suspended coroutine']);
    co.status = 'running';
    try {
      let r;
      if (!co.it) {
        const f = co.fn;
        co.it = f.constructor === GenFn ? f(...args) : (function* () { return f(...args); })();
        r = co.it.next();
      } else r = co.it.next(pk(args));
      while (!r.done && r.value === FLIP_MARK) r = co.it.next();
      if (r.done) { co.status = 'dead'; return new MR([true, ...(r.value === undefined ? [] : M(r.value))]); }
      co.status = 'suspended';
      return new MR([true, ...r.value]);
    } catch (e: any) {
      co.status = 'dead';
      return new MR([false, errValue(e)]);
    }
  };
  G.costatus = (co: any) => (co instanceof Coroutine ? co.status : 'dead');
  G.yield = YIELD;
  G.sub = (s: any, i?: any, j?: any) => substr(tostr(s), i, j);
  G.split = (s: any, sep?: any, conv?: any) => {
    s = tostr(s);
    const out: any[] = [];
    const doConv = conv === undefined ? true : T(conv);
    const cv = (x: string) => { if (!doConv) return x; const n = str2num(x); return x !== '' && n !== undefined ? n : x; };
    if (typeof sep === 'number') { for (let i = 0; i < s.length; i += sep) out.push(cv(s.substr(i, sep))); }
    else if (sep === '') { for (const ch of s) out.push(cv(ch)); }
    else { const parts = s.split(sep === undefined ? ',' : sep); for (const x of parts) out.push(cv(x)); }
    return tbl(out);
  };
  G.chr = (...a: any[]) => a.map((n) => p8char(Math.floor(num(n)) & 0xffff)).join('');
  G.ord = (s: any, i?: any, n?: any) => {
    s = tostr(s);
    const ch = [...s][Math.floor(num(i, 1)) - 1];
    if (ch === undefined) return undefined;
    const k = P8CHARS.indexOf(ch.replace(/\uFE0F/g, ''));
    const k2 = k >= 0 ? k : P8CHARS.findIndex((x) => x.replace(/\uFE0F/g, '') === ch);
    return k2 >= 0 ? 128 + k2 : ch.codePointAt(0);
  };
  /* math */
  G.flr = (x: any) => Math.floor(num(x));
  G.ceil = (x: any) => Math.ceil(num(x));
  G.abs = (x: any) => Math.abs(num(x));
  G.sqrt = (x: any) => { const n = num(x); return n < 0 ? 0 : Math.sqrt(n); };
  G.sgn = (x: any) => (num(x) < 0 ? -1 : 1);
  G.min = (a: any, b: any) => { a = num(a); b = num(b); return a < b ? a : b; };
  G.max = (a: any, b: any) => { a = num(a); b = num(b); return a > b ? a : b; };
  G.mid = (a: any, b: any, c: any) => { a = num(a); b = num(b); c = num(c); return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c)); };
  G.sin = (x: any) => -Math.sin(num(x) * Math.PI * 2);
  G.cos = (x: any) => Math.cos(num(x) * Math.PI * 2);
  G.atan2 = (dx: any, dy: any) => {
    dx = num(dx);
    dy = num(dy);

    if (dx === 0 && dy === 0) return 0.25;

    let a = Math.atan2(-dy, dx) / (Math.PI * 2);
    if (a < 0) a += 1;
    return a;
  }; 

  G.rnd = (x?: any) => {
    if (x instanceof LuaTable) {
      return x.arr[Math.floor(picoRnd(x.arr.length))];
    }

    return picoRnd(x === undefined ? 1 : num(x));
  };

  G.srand = (x: any) => {srand(num(x)); };

  G.band = band; G.bor = bor; G.bxor = bxor; G.bnot = bnot; G.shl = shl; G.shr = shr; G.lshr = lshr; G.rotl = rotl; G.rotr = rotr;
  return G;
}

/** Table exposing the globals as a Lua table (_G). */
export function globalsTable(G: any) {
  const t = new LuaTable();
  t.getRaw = (k: any) => G[k];
  t.setRaw = (k: any, v: any) => { G[k] = v; };
  Object.defineProperty(t, 'hash', { get: () => { const m = new Map(); for (const k in G) if (G[k] !== undefined) m.set(k, G[k]); return m; }, set: () => {} });
  return t;
}