// @ts-nocheck
import { countTokens } from './lua';

export const SCREEN_START = 0x6000;
export const SCREEN_END = 0x8000;
export const TEXT_LINE_HEIGHT = 6;

const SCREEN_W = 128;
const SCREEN_H = 128;
const SCREEN_STRIDE = SCREEN_W >> 1; // dos píxeles por byte
const CELL_W = 4;
const CELL_BYTES = CELL_W >> 1;
const COLS = SCREEN_W / CELL_W;
const ROWS = Math.floor(SCREEN_H / TEXT_LINE_HEIGHT);

interface Line {
  t: string;
  c: number;
}

interface InputCell {
  ch: string;
  inverse: boolean;
  under: Uint8Array;
}

export class Terminal {
  m: any;
  lines: Line[] = []; // Solo salida pendiente. La ya impresa vive en VRAM.
  input = '';
  pos = 0;
  hist: string[] = [];
  hp = -1;

  private nextY = 0;
  private cells = new Map<number, InputCell>();

  constructor(m: any) { this.m = m; }

  get promptY() { return this.nextY; }

  intro() {
    this.input = '';
    this.pos = 0;
    this.hp = -1;
    this.clear();
    this.print('SUPER-PICO CONSOLE 0.1', 7);
    this.print('(C) FANTASY CONSOLE CLONE', 6);
    this.print('', 6);
    this.print('TYPE HELP FOR HELP', 6);
    this.print('TRY: LOAD DEMO  OR  LOAD PSEUDO3D', 6);
    this.print('', 6);
  }

  /** CLS descarta la salida pendiente y limpia la pantalla completa. */
  clear(color = 0) {
    this.cells.clear();
    this.lines.length = 0;
    this.nextY = 0;
    this.m.g.cls(color);
  }

  /** Adopta la VRAM del cart tal como está. No repinta el historial. */
  useFramebuffer(y: number) {
    this.cells.clear();
    this.nextY = Number.isFinite(y)
      ? Math.max(0, Math.min(SCREEN_H, Math.floor(y)))
      : 0;
    this.input = '';
    this.pos = 0;
    this.hp = -1;
  }

  /** Quita el prompt editable, pero deja impresas las líneas confirmadas. */
  detach() {
    this.restoreInput();
    this.flushOutput();
  }

  print(text: string, c = 6) {
    for (const part of String(text).split('\n')) {
      const chars = [...part];
      if (chars.length === 0) this.lines.push({ t: '', c });
      for (let i = 0; i < chars.length; i += COLS) {
        this.lines.push({ t: chars.slice(i, i + COLS).join(''), c });
      }
    }
    if (this.lines.length > 300) this.lines.splice(0, this.lines.length - 300);
  }

  paste(t: string) {
    const s = t.replace(/\r?\n/g, ' ');
    this.input = this.input.slice(0, this.pos) + s + this.input.slice(this.pos);
    this.pos += s.length;
  }

  private saveCell(addr: number): Uint8Array {
    const mem = this.m.mem;
    const bytes = new Uint8Array(CELL_BYTES * TEXT_LINE_HEIGHT);
    for (let dy = 0; dy < TEXT_LINE_HEIGHT; dy++) {
      for (let i = 0; i < CELL_BYTES; i++) {
        bytes[dy * CELL_BYTES + i] = mem[addr + dy * SCREEN_STRIDE + i];
      }
    }
    return bytes;
  }

  private restoreCell(addr: number, under: Uint8Array) {
    const mem = this.m.mem;
    for (let dy = 0; dy < TEXT_LINE_HEIGHT; dy++) {
      for (let i = 0; i < CELL_BYTES; i++) {
        mem[addr + dy * SCREEN_STRIDE + i] = under[dy * CELL_BYTES + i];
      }
    }
  }

  private restoreInput() {
    for (const [addr, cell] of this.cells) this.restoreCell(addr, cell.under);
    this.cells.clear();
  }

  private drawCell(x: number, y: number, ch: string, color: number, inverse = false) {
    const g = this.m.g;
    // El fondo es opaco solo dentro de esta celda, no en toda la fila.
    g.rectfill(x, y, x + CELL_W - 1, y + TEXT_LINE_HEIGHT - 1, inverse ? color : 0);
    if (ch !== ' ') {
      g.clip(x, y, CELL_W, TEXT_LINE_HEIGHT);
      g.glyph(ch, x, y, inverse ? 0 : color);
      g.clip();
    }
  }

  private makeRoom(rows: number) {
    const overflow = this.nextY + rows * TEXT_LINE_HEIGHT - SCREEN_H;
    if (overflow <= 0) return;

    // Primero restaura los píxeles bajo el prompt para no arrastrarlo
    // al desplazar la pantalla.
    this.restoreInput();
    const shift = Math.min(SCREEN_H, Math.ceil(overflow / TEXT_LINE_HEIGHT) * TEXT_LINE_HEIGHT);
    const bytes = shift * SCREEN_STRIDE;
    const mem = this.m.mem;
    mem.copyWithin(SCREEN_START, SCREEN_START + bytes, SCREEN_END);
    mem.fill(0, SCREEN_END - bytes, SCREEN_END);
    this.nextY = Math.max(0, this.nextY - shift);
  }

  private flushOutput() {
    if (!this.lines.length) return;

    this.restoreInput();
    this.m.g.resetDraw();

    const lines = this.lines.splice(0);
    for (const { t, c } of lines) {
      this.makeRoom(1);
      let x = 0;
      for (const ch of t) {
        this.drawCell(x, this.nextY, ch, c);
        x += CELL_W;
      }
      this.nextY += TEXT_LINE_HEIGHT;
    }
  }

  frame() {
    this.flushOutput();

    const chars = ['>', ...this.input, ' '];
    const caret = 1 + [...this.input.slice(0, this.pos)].length;
    const caretRow = Math.floor(caret / COLS);
    const totalRows = Math.ceil(chars.length / COLS);
    const visibleRows = Math.min(totalRows, ROWS);
    const firstRow = Math.max(0, caretRow - visibleRows + 1);
    this.makeRoom(visibleRows);

    const blink = Math.floor(this.m.frameNo / 20) % 2 === 0;
    const wanted = new Map<number, { x: number; y: number; ch: string; inverse: boolean }>();
    const first = firstRow * COLS;
    const end = Math.min(chars.length, first + visibleRows * COLS);

    for (let i = first; i < end; i++) {
      const inverse = i === caret && blink;
      // El espacio final solo está reservado para el cursor: cuando no
      // se muestra, deja visibles los píxeles originales de ese lugar.
      if (i === chars.length - 1 && !inverse) continue;

      const rel = i - first;
      const x = (rel % COLS) * CELL_W;
      const y = this.nextY + Math.floor(rel / COLS) * TEXT_LINE_HEIGHT;
      const addr = SCREEN_START + y * SCREEN_STRIDE + (x >> 1);
      wanted.set(addr, { x, y, ch: chars[i], inverse });
    }

    // Backspace, Delete o mover el cursor fuera de una celda pueden
    // dejar de ocuparla. En ese caso se recupera el dibujo original.
    for (const [addr, cell] of this.cells) {
      if (!wanted.has(addr)) {
        this.restoreCell(addr, cell.under);
        this.cells.delete(addr);
      }
    }

    for (const [addr, cell] of wanted) {
      const prev = this.cells.get(addr);
      if (prev && prev.ch === cell.ch && prev.inverse === cell.inverse) continue;

      const under = prev ? prev.under : this.saveCell(addr);
      this.drawCell(cell.x, cell.y, cell.ch, 7, cell.inverse);
      this.cells.set(addr, { ch: cell.ch, inverse: cell.inverse, under });
    }
  }

  key(e: KeyboardEvent): boolean {
    const altGraph = !!e.getModifierState?.('AltGraph');
    const ctrl = (e.ctrlKey || e.metaKey) && !altGraph;
    if (ctrl) {
      if (e.code === 'KeyV' || e.code === 'KeyC' || e.code === 'KeyX') return false;
      if (e.code === 'KeyL') { this.clear(); return true; }
      if (e.code === 'KeyU') { this.input = this.input.slice(this.pos); this.pos = 0; return true; }
      return false;
    }

    switch (e.code) {
      case 'Enter':
      case 'NumpadEnter': {
        const l = this.input;
        this.input = '';
        this.pos = 0;
        this.hp = -1;
        this.exec(l);
        return true;
      }
      case 'Backspace':
        if (this.pos > 0) {
          this.input = this.input.slice(0, this.pos - 1) + this.input.slice(this.pos);
          this.pos--;
        }
        return true;
      case 'Delete':
        this.input = this.input.slice(0, this.pos) + this.input.slice(this.pos + 1);
        return true;
      case 'ArrowLeft':
        this.pos = Math.max(0, this.pos - 1);
        return true;
      case 'ArrowRight':
        this.pos = Math.min(this.input.length, this.pos + 1);
        return true;
      case 'Home':
        this.pos = 0;
        return true;
      case 'End':
        this.pos = this.input.length;
        return true;
      case 'ArrowUp':
        if (this.hist.length) {
          this.hp = Math.min(this.hist.length - 1, this.hp + 1);
          this.input = this.hist[this.hist.length - 1 - this.hp];
          this.pos = this.input.length;
        }
        return true;
      case 'ArrowDown':
        if (this.hp >= 0) {
          this.hp--;
          this.input = this.hp < 0 ? '' : this.hist[this.hist.length - 1 - this.hp];
          this.pos = this.input.length;
        }
        return true;
      case 'Tab':
        this.complete();
        return true;
    }

    if (e.key.length === 1 && (!e.altKey || altGraph)) {
      this.input = this.input.slice(0, this.pos) + e.key + this.input.slice(this.pos);
      this.pos++;
      return true;
    }

    return false;
  }

  complete() {
    const m = /^(load|save|export|rm|del)\s+(\S*)$/i.exec(this.input);
    if (!m) return;
    const names = ['demo', 'pseudo3d', ...Object.keys(this.m.drive())]
      .filter((n) => n.toLowerCase().startsWith(m[2].toLowerCase()));
    if (names.length === 1) {
      this.input = m[1] + ' ' + names[0];
      this.pos = this.input.length;
    }
  }

  exec(line: string) {
    const m = this.m;
    this.print('>' + line, 7);
    const s = line.trim();
    if (!s) return;

    if (this.hist[this.hist.length - 1] !== s) this.hist.push(s);

    // CLS y CLS() son comandos de consola. CLS(12) se evalúa como Lua
    // y también actualiza la posición del prompt mediante G.cls.
    if (/^cls(?:\s*\(\s*\))?$/i.test(s)) {
      this.clear();
      return;
    }

    const mt = /^(\S+)\s*(.*)$/.exec(s)!;
    const cmd = mt[1].toLowerCase().replace(/[()]/g, '');
    const arg = mt[2].trim().replace(/^["']|["']$/g, '');

    switch (cmd) {
      case 'help':
        [
          'COMMANDS', ' LOAD <NAME>   SAVE <NAME>', ' RUN   RESUME   NEW   CLS',
          ' LS            LIST CARTS', ' IMPORT        OPEN .P8 FILE',
          ' EXPORT [NAME] DOWNLOAD .P8', ' RM <NAME>     DELETE CART',
          ' INFO          CART STATS', ' REBOOT        RESET MACHINE',
          ' ANY LUA CODE IS EXECUTED', '', 'KEYS',
          ' ESC       CONSOLE <-> EDITOR', ' CTRL-R    RUN CART',
          ' CTRL-S    SAVE CART', ' ALT-LEFT/RIGHT  NEXT EDITOR',
          ' ALT-ENTER FULLSCREEN', ' F6        SCREENSHOT', ' P/ENTER   PAUSE MENU',
          ' ARROWS+Z/X OR ARROWS+C/V', ' PLAYER 2: ESDF + A/TAB', '',
        ].forEach((l, i) => this.print(l, i === 0 || l === 'KEYS' ? 7 : 6));
        return;

      case 'ls':
      case 'dir':
      case 'folder': {
        if (cmd === 'folder') { m.openFileDialog(); return; }
        this.print('DEMO.P8      (BUILT-IN)', 12);
        this.print('PSEUDO3D.P8  (BUILT-IN)', 12);
        const names = Object.keys(m.drive()).sort();
        names.forEach((n) => this.print(n.toUpperCase() + '.P8', 7));
        if (!names.length) this.print('(NO SAVED CARTS)', 6);
        return;
      }

      case 'load':
      case 'l':
        if (!arg) { this.print('USAGE: LOAD <NAME>', 8); return; }
        if (m.loadByName(arg)) this.print('LOADED ' + m.cartName.toUpperCase() + '.P8', 6);
        else this.print('COULD NOT LOAD ' + arg.toUpperCase(), 8);
        return;

      case 'save':
      case 's':
        m.saveCart(arg || m.cartName);
        return;

      case 'run':
      case 'r':
        m.startRun('console');
        return;

      case 'resume':
        if (!m.resume()) this.print('NOTHING TO RESUME', 8);
        return;

      case 'new':
        m.newCartCmd();
        this.print('NEW CART', 6);
        return;

      case 'reboot':
        m.newCartCmd();
        this.intro();
        m.consoleG = null;
        return;

      case 'import':
        m.openFileDialog();
        return;

      case 'export':
        m.exportCart(arg);
        return;

      case 'rm':
      case 'del': {
        const d = m.drive(), n = m.cleanName(arg);
        if (d[n] === undefined) { this.print('NOT FOUND: ' + arg.toUpperCase(), 8); return; }
        delete d[n];
        m.saveDrive(d);
        this.print('DELETED ' + n.toUpperCase(), 6);
        return;
      }

      case 'info': {
        const c = m.editors.code.getText();
        this.print('CART: ' + (m.cartName || 'UNTITLED').toUpperCase(), 7);
        this.print('LINES:  ' + c.split('\n').length, 6);
        this.print('CHARS:  ' + c.length + '/65535', 6);
        this.print('TOKENS: ' + countTokens(c) + '/8192', 6);
        return;
      }
    }

    m.execLua(s);
  }
}