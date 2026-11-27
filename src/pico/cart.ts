// @ts-nocheck
export const ROM_SIZE = 0x4300;
export interface Cart { code: string; data: Uint8Array; }

export function blankData(): Uint8Array {
  const d = new Uint8Array(ROM_SIZE);
  for (let i = 0; i < 64; i++) {
    d[0x3200 + i * 68 + 65] = 1;
    for (let k = 0; k < 4; k++) d[0x3100 + i * 4 + k] = 0x41 + k;
  }
  return d;
}
export const newCart = (): Cart => ({ code: '', data: blankData() });

const hex = (n: number, w: number) => n.toString(16).padStart(w, '0');

export function parseP8(text: string): Cart {
  const lines = text.replace(/\r/g, '').split('\n');
  const cart = newCart();
  const data = cart.data;
  let section = '';
  const code: string[] = [];
  let gfxRow = 0, mapRow = 0, sfxId = 0, musId = 0, flagPos = 0;
  let hasSections = false;
  for (const line of lines) {
    const m = /^__(\w+)__$/.exec(line);
    if (m) { section = m[1]; hasSections = true; if (section === 'sfx') { for (let i = 0; i < 64; i++) { data.fill(0, 0x3200 + i * 68, 0x3200 + i * 68 + 68); data[0x3200 + i * 68 + 65] = 1; } } if (section === 'music') for (let i = 0; i < 64; i++) for (let k = 0; k < 4; k++) data[0x3100 + i * 4 + k] = 0x41 + k; continue; }
    if (!hasSections) continue;
    switch (section) {
      case 'lua': code.push(line); break;
      case 'gfx':
        if (gfxRow < 128) {
          for (let x = 0; x < Math.min(128, line.length); x++) {
            const v = parseInt(line[x], 16) || 0;
            const a = gfxRow * 64 + (x >> 1);
            data[a] = x & 1 ? (data[a] & 0x0f) | (v << 4) : (data[a] & 0xf0) | v;
          }
          gfxRow++;
        }
        break;
      case 'gff':
        for (let i = 0; i + 1 < line.length + 1 && i < line.length; i += 2) { if (flagPos < 256) data[0x3000 + flagPos++] = parseInt(line.substr(i, 2), 16) || 0; }
        break;
      case 'map':
        if (mapRow < 32) {
          for (let x = 0; x < 128 && x * 2 < line.length; x++) data[0x2000 + mapRow * 128 + x] = parseInt(line.substr(x * 2, 2), 16) || 0;
          mapRow++;
        }
        break;
      case 'sfx':
        if (sfxId < 64 && line.length >= 8) {
          const base = 0x3200 + sfxId * 68;
          data[base + 64] = parseInt(line.substr(0, 2), 16) || 0;
          data[base + 65] = parseInt(line.substr(2, 2), 16) || 0;
          data[base + 66] = parseInt(line.substr(4, 2), 16) || 0;
          data[base + 67] = parseInt(line.substr(6, 2), 16) || 0;
          for (let n = 0; n < 32; n++) {
            const s = line.substr(8 + n * 5, 5);
            if (s.length < 5) break;
            const pitch = parseInt(s.substr(0, 2), 16) & 63;
            const w = parseInt(s[2], 16), v = parseInt(s[3], 16) & 7, e = parseInt(s[4], 16) & 7;
            const word = pitch | ((w & 7) << 6) | (v << 9) | (e << 12) | ((w >> 3) << 15);
            data[base + n * 2] = word & 255;
            data[base + n * 2 + 1] = word >> 8;
          }
          sfxId++;
        }
        break;
      case 'music':
        if (musId < 64 && line.length >= 11) {
          const flags = parseInt(line.substr(0, 2), 16) || 0;
          for (let k = 0; k < 4; k++) data[0x3100 + musId * 4 + k] = (parseInt(line.substr(3 + k * 2, 2), 16) & 0x7f) | ((flags >> k) & 1 ? 0x80 : 0);
          musId++;
        }
        break;
    }
  }
  if (!hasSections) cart.code = text;
  else {
    while (code.length && code[code.length - 1] === '') code.pop();
    cart.code = code.join('\n');
  }
  // un-set sfx/music not present stay at defaults
  if (sfxId === 0) for (let i = 0; i < 64; i++) data[0x3200 + i * 68 + 65] = 1;
  if (musId === 0) for (let i = 0; i < 64; i++) for (let k = 0; k < 4; k++) data[0x3100 + i * 4 + k] = 0x41 + k;
  return cart;
}

export function serializeP8(code: string, d: Uint8Array): string {
  const out: string[] = ['pico-8 cartridge // http://www.pico-8.com', 'version 42', '__lua__', code.replace(/\s+$/, '')];
  // gfx
  let last = -1;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) if (d[y * 64 + x]) last = y;
  if (last >= 0) {
    out.push('__gfx__');
    for (let y = 0; y <= last; y++) {
      let s = '';
      for (let x = 0; x < 64; x++) { const b = d[y * 64 + x]; s += (b & 15).toString(16) + (b >> 4).toString(16); }
      out.push(s);
    }
  }
  // flags
  let anyFlag = false;
  for (let i = 0; i < 256; i++) if (d[0x3000 + i]) anyFlag = true;
  if (anyFlag) {
    out.push('__gff__');
    for (let l = 0; l < 2; l++) { let s = ''; for (let i = 0; i < 128; i++) s += hex(d[0x3000 + l * 128 + i], 2); out.push(s); }
  }
  // map (rows 0-31)
  last = -1;
  for (let y = 0; y < 32; y++) for (let x = 0; x < 128; x++) if (d[0x2000 + y * 128 + x]) last = y;
  if (last >= 0) {
    out.push('__map__');
    for (let y = 0; y <= last; y++) { let s = ''; for (let x = 0; x < 128; x++) s += hex(d[0x2000 + y * 128 + x], 2); out.push(s); }
  }
  // sfx
  let lastSfx = -1;
  for (let i = 0; i < 64; i++) {
    const b = 0x3200 + i * 68;
    for (let k = 0; k < 64; k++) if (d[b + k]) lastSfx = i;
    if (d[b + 64] || d[b + 66] || d[b + 67] || d[b + 65] > 1) lastSfx = i;
  }
  if (lastSfx >= 0) {
    out.push('__sfx__');
    for (let i = 0; i <= lastSfx; i++) {
      const b = 0x3200 + i * 68;
      let s = hex(d[b + 64], 2) + hex(d[b + 65], 2) + hex(d[b + 66], 2) + hex(d[b + 67], 2);
      for (let n = 0; n < 32; n++) {
        const w = d[b + n * 2] | (d[b + n * 2 + 1] << 8);
        s += hex(w & 63, 2) + (((w >> 6) & 7) | (((w >> 15) & 1) << 3)).toString(16) + ((w >> 9) & 7) + ((w >> 12) & 7);
      }
      out.push(s);
    }
  }
  // music
  let lastMus = -1;
  for (let i = 0; i < 64; i++) for (let k = 0; k < 4; k++) if (d[0x3100 + i * 4 + k] !== 0x41 + k) lastMus = i;
  if (lastMus >= 0) {
    out.push('__music__');
    for (let i = 0; i <= lastMus; i++) {
      const b = 0x3100 + i * 4;
      const flags = (d[b] >> 7) | ((d[b + 1] >> 7) << 1) | ((d[b + 2] >> 7) << 2) | ((d[b + 3] >> 7) << 3);
      out.push(hex(flags, 2) + ' ' + [0, 1, 2, 3].map((k) => hex(d[b + k] & 0x7f, 2)).join(''));
    }
  }
  return out.join('\n') + '\n';
}

/* ---------- built-in demo cart ---------- */
export function demoCart(): Cart {
  const c = newCart();
  const d = c.data;
  const spr = (n: number, rows: string[]) => {
    const sx = (n % 16) * 8, sy = Math.floor(n / 16) * 8;
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      const a = (sy + y) * 64 + ((sx + x) >> 1), v = parseInt(ch, 16);
      d[a] = (sx + x) & 1 ? (d[a] & 0x0f) | (v << 4) : (d[a] & 0xf0) | v;
    }));
  };
  spr(1, ['00444400', '04444440', '0f1ff1f0', '0ffffff0', '00888800', '08888880', '00800800', '08800880']);
  spr(2, ['bbbbbbbb', 'b3b3b3b3', '44444444', '45444544', '44444444', '44544454', '44444444', '45444445']);
  spr(3, ['00aaaa00', '0a9999a0', 'a99aa99a', 'a99aa99a', 'a99aa99a', 'a99aa99a', '0a9999a0', '00aaaa00']);
  spr(4, ['44444544', '44444544', '55555555', '45444444', '45444444', '55555555', '44444544', '44444544']);
  spr(5, ['00000000', '00007700', '00777770', '07777777', '77777777', '00000000', '00000000', '00000000']);
  d[0x3000 + 2] = 1; d[0x3000 + 4] = 1; d[0x3000 + 3] = 2;
  const mset = (x: number, y: number, t: number) => { d[0x2000 + y * 128 + x] = t; };
  for (let x = 0; x < 64; x++) { mset(x, 14, 2); mset(x, 15, 4); }
  const plat = (x0: number, x1: number, y: number) => { for (let x = x0; x <= x1; x++) mset(x, y, 4); };
  plat(10, 13, 11); plat(18, 21, 9); plat(26, 30, 11); plat(36, 38, 8); plat(42, 47, 10); plat(52, 55, 7);
  for (let y = 11; y < 14; y++) { mset(33, y, 4); mset(58, y, 4); }
  [[11, 10], [12, 10], [19, 8], [20, 8], [28, 10], [37, 7], [44, 9], [45, 9], [53, 6], [54, 6], [24, 13], [40, 13], [50, 13], [61, 13]].forEach(([x, y]) => mset(x, y, 3));
  const setNote = (sfx: number, n: number, pitch: number, wave: number, vol: number, fx: number) => {
    const w = pitch | (wave << 6) | (vol << 9) | (fx << 12);
    d[0x3200 + sfx * 68 + n * 2] = w & 255; d[0x3200 + sfx * 68 + n * 2 + 1] = w >> 8;
  };
  // sfx 0: jump
  d[0x3200 + 65] = 2;
  [18, 22, 26, 30, 34, 38, 40, 42].forEach((p, i) => setNote(0, i, p, 1, 5, 0));
  // sfx 1: coin
  d[0x3200 + 68 + 65] = 4;
  setNote(1, 0, 40, 3, 5, 0); setNote(1, 1, 47, 3, 5, 5);
  // sfx 2: bass, sfx 3: melody
  d[0x3200 + 2 * 68 + 65] = 12; d[0x3200 + 3 * 68 + 65] = 12;
  const bass = [12, 12, 19, 12, 15, 15, 22, 15, 17, 17, 24, 17, 15, 15, 22, 15];
  for (let i = 0; i < 32; i++) setNote(2, i, bass[i % 16], 0, 4, 0);
  const mel = [36, 0, 39, 0, 43, 0, 39, 0, 41, 0, 38, 0, 41, 43, 41, 0, 36, 0, 39, 0, 43, 0, 46, 0, 44, 43, 41, 39, 38, 0, 0, 0];
  mel.forEach((p, i) => setNote(3, i, p || 36, 3, p ? 3 : 0, 0));
  d[0x3100] = 2 | 0x80; d[0x3101] = 3 | 0x80; d[0x3102] = 0x42; d[0x3103] = 0x43;
  c.code = `-- coin runner demo
-- arrows: move  z: jump
function _init()
 px,py=16,100
 dx,dy=0,0
 grounded=false
 flip=false
 score=0
 coins={}
 parts={}
 for x=0,63 do
  for y=0,15 do
   if mget(x,y)==3 then
    add(coins,{x=x*8,y=y*8})
    mset(x,y,0)
   end
  end
 end
 music(0)
end

function solid(x,y)
 return fget(mget(x\\8,y\\8),0)
end

function hit(x,y,w,h)
 return solid(x,y) or solid(x+w,y)
  or solid(x,y+h) or solid(x+w,y+h)
end

function spark(x,y)
 for i=1,8 do
  add(parts,{x=x+4,y=y+4,
   vx=rnd(2)-1,vy=rnd(2)-1.5,life=14})
 end
end

function _update()
 if btn(0) then dx-=0.5 flip=true end
 if btn(1) then dx+=0.5 flip=false end
 dx*=0.8
 dy+=0.3
 dx=mid(-2,dx,2)
 if btnp(4) and grounded then
  dy=-3.4
  sfx(0)
 end
 if not hit(px+dx+1,py+1,5,6) then
  px+=dx
 else
  dx=0
 end
 grounded=false
 if not hit(px+1,py+dy+1,5,6) then
  py+=dy
 else
  if dy>0 then grounded=true end
  dy=0
 end
 px=max(px,0)
 if py>140 then _init() end
 for c in all(coins) do
  if abs(c.x-px)<6 and abs(c.y-py)<6 then
   del(coins,c)
   score+=1
   sfx(1)
   spark(c.x,c.y)
  end
 end
 for p in all(parts) do
  p.x+=p.vx p.y+=p.vy p.vy+=0.1
  p.life-=1
  if (p.life<=0) del(parts,p)
 end
end

function _draw()
 cls(12)
 local cam=mid(0,px-64,64*8-128)
 camera(cam*0.5,0)
 for i=0,9 do spr(5,i*40+(i%3)*9,10+(i%4)*8,1,1) end
 camera(cam,0)
 map(0,0,0,0,64,16)
 for c in all(coins) do
  spr(3,c.x,c.y+sin(t()/2+c.x/32)*2)
 end
 for p in all(parts) do
  pset(p.x,p.y,10)
 end
 spr(1,px,py,1,1,flip)
 camera()
 rectfill(0,0,127,8,1)
 print("coins: "..score.."/"..(score+#coins),2,2,7)
end
`;
  return c;
}

/* ---------- built-in tline pseudo-3d cart ---------- */
export function pseudo3dCart(): Cart {
  const c = newCart();
  const d = c.data;
  const spr = (n: number, rows: string[]) => {
    const sx = (n % 16) * 8, sy = Math.floor(n / 16) * 8;
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      const a = (sy + y) * 64 + ((sx + x) >> 1), v = parseInt(ch, 16);
      d[a] = (sx + x) & 1 ? (d[a] & 0x0f) | (v << 4) : (d[a] & 0xf0) | v;
    }));
  };

  // Tile 1: Start / Finish Checkered Line
  spr(1, [
    '88888888',
    '70707070',
    '07070707',
    '70707070',
    '07070707',
    '70707070',
    '07070707',
    '88888888',
  ]);
  // Tile 2: Asphalt Road
  spr(2, [
    '55555555',
    '55565555',
    '55555515',
    '51555555',
    '55555555',
    '55556555',
    '55155555',
    '55555555',
  ]);
  // Tile 3: Racing Curb (Red & White)
  spr(3, [
    '88887777',
    '88887777',
    '88887777',
    '88887777',
    '77778888',
    '77778888',
    '77778888',
    '77778888',
  ]);
  // Tile 4: Lush Grass
  spr(4, [
    '33333333',
    '3b333333',
    '333333b3',
    '33333333',
    '333b3333',
    '33333333',
    '33333b33',
    '33b33333',
  ]);
  // Tile 5: Sand / Gravel Trap
  spr(5, [
    'ffffffff',
    'ff4fffff',
    'fffff4ff',
    'ffffffff',
    'fff4ffff',
    'f4ffffff',
    'ffffff4f',
    'ffffffff',
  ]);
  // Tile 6: Turbo Boost Pad
  spr(6, [
    '11cccc11',
    '1ccaacc1',
    'cca77acc',
    'ca7aa7ac',
    '11cccc11',
    '1ccaacc1',
    'cca77acc',
    'ca7aa7ac',
  ]);
  // Tile 7: Water / Lake
  spr(7, [
    '11111111',
    '11cc1111',
    '11111111',
    '11111cc1',
    '11111111',
    '1cc11111',
    '11111111',
    '1111cc11',
  ]);
  // Tile 8: Billboard Tree Marker (also drawn as 3D tree preview in map editor)
  spr(8, [
    '333bb333',
    '33bbbb33',
    '3b3bb3b3',
    '33bbbb33',
    '33344333',
    '33344333',
    '33344333',
    '33333333',
  ]);

  // Sprites 16,17,32,33: 16x16 Hover-Kart (Straight)
  spr(16, ['00000077', '000007aa', '00000788', '00007888', '00078877', '0078877c', '007888cc', '088888cc']);
  spr(17, ['77000000', 'aa700000', '88700000', '88870000', '77887000', 'c7788700', 'cc888700', 'cc888880']);
  spr(32, ['08888888', '08877888', '11888887', '11188889', '11155559', '1115005a', '01100000', '00000000']);
  spr(33, ['88888880', '88877880', '78888811', '98888111', '95555111', 'a5005111', '00000110', '00000000']);

  // Sprites 18,19,34,35: 16x16 Hover-Kart (Turning Left)
  spr(18, ['00000770', '00007aa0', '00007880', '00078888', '00788778', '078877c8', '07888cc8', '88888cc8']);
  spr(19, ['00000000', '70000000', '87000000', '88700000', '88870000', '78870000', 'c8870000', 'c8880000']);
  spr(34, ['88888887', '88778889', '1888889a', '11888555', '11555500', '11500000', '01000000', '00000000']);
  spr(35, ['88880000', '88778000', '88881100', '88811100', '55511100', '50011000', '00000000', '00000000']);

  // Sprites 20 & 36: 8x16 3D Billboard Tree
  spr(20, [
    '000bb000',
    '00bbbb00',
    '0bb3bbb0',
    '0b3bb3b0',
    'bb3bb3bb',
    'b3bbbb3b',
    '03b33b30',
    '00344300',
  ]);
  spr(36, [
    '00044000',
    '00044000',
    '00044000',
    '00044000',
    '00044000',
    '00444400',
    '00333300',
    '00000000',
  ]);

  // Build 48x32 Closed Circuit Track Map
  const W = 48, H = 32;
  const mset = (x: number, y: number, t: number) => {
    if (x >= 0 && x < W && y >= 0 && y < H) d[0x2000 + y * 128 + x] = t;
  };
  const pts: [number, number][] = [
    [12, 26], [36, 26],
    [42, 22], [42, 11],
    [37, 6],  [28, 6],
    [24, 12], [18, 12],
    [13, 6],  [6, 8],
    [6, 21],
  ];
  const distSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const dx = px - (ax + vx * t), dy = py - (ay + vy * t);
    return Math.sqrt(dx * dx + dy * dy);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let minD = 999;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        minD = Math.min(minD, distSeg(x, y, a[0], a[1], b[0], b[1]));
      }
      const inLake = ((x - 24) * (x - 24)) / 42 + ((y - 19) * (y - 19)) / 9 < 1;
      if (minD <= 1.85) mset(x, y, 2);
      else if (minD <= 2.65) mset(x, y, 3);
      else if (minD <= 3.45 && (x > 38 || x < 9)) mset(x, y, 5);
      else if (inLake && minD > 3.2) mset(x, y, 7);
      else mset(x, y, 4);
    }
  }
  // Start/Finish line at x=22 across bottom straight
  for (let y = 24; y <= 28; y++) {
    if (d[0x2000 + y * 128 + 22] === 2) mset(22, y, 1);
  }
  // Boost pads on straights
  mset(31, 26, 6); mset(31, 25, 6);
  mset(6, 15, 6); mset(5, 15, 6);
  mset(33, 6, 6);
  // Scenic roadside trees (Tile 8 -> turned into 3D billboards in _init)
  const treeCoords: [number, number][] = [
    [15, 22], [20, 22], [28, 22], [34, 22],
    [16, 30], [26, 30], [36, 30],
    [46, 17], [46, 9], [40, 2], [30, 2],
    [21, 8], [21, 16], [11, 2], [2, 6],
    [2, 14], [2, 23], [11, 17], [36, 15],
  ];
  treeCoords.forEach(([tx, ty]) => mset(tx, ty, 8));

  // Audio SFX & Synthwave Loop
  const setNote = (sfx: number, n: number, pitch: number, wave: number, vol: number, fx: number) => {
    const w = pitch | (wave << 6) | (vol << 9) | (fx << 12);
    d[0x3200 + sfx * 68 + n * 2] = w & 255; d[0x3200 + sfx * 68 + n * 2 + 1] = w >> 8;
  };
  // sfx 0: boost pad
  d[0x3200 + 65] = 2;
  [24, 29, 34, 39, 44, 48, 52, 56].forEach((p, i) => setNote(0, i, p, 2, 5, 0));
  // sfx 1: lap chime
  d[0x3200 + 68 + 65] = 4;
  [36, 40, 43, 48, 52].forEach((p, i) => setNote(1, i, p, 3, 5, 0));
  // sfx 2: bass, sfx 3: arp
  d[0x3200 + 2 * 68 + 65] = 10; d[0x3200 + 3 * 68 + 65] = 10;
  const bass = [12, 12, 24, 12, 12, 12, 24, 12, 15, 15, 27, 15, 17, 17, 29, 17];
  for (let i = 0; i < 32; i++) setNote(2, i, bass[i % 16], 1, 3, 0);
  const arp = [36, 40, 43, 48, 36, 40, 43, 48, 39, 43, 46, 51, 41, 45, 48, 53];
  for (let i = 0; i < 32; i++) setNote(3, i, arp[i % 16], 3, i % 2 === 0 ? 3 : 2, 0);
  d[0x3100] = 2 | 0x80; d[0x3101] = 3 | 0x80; d[0x3102] = 0x42; d[0x3103] = 0x43;

  c.code = `-- mode 7 pseudo-3d racer (tline)
-- arws/z/x: conducir  c: musica

function _init()
 -- wrap tline map at 48x32 tiles
 poke(0x5f38,48)
 poke(0x5f39,32)

 px,py=19.5,26
 ang=0
 spd=0
 steer=0
 lap=1
 chk=0
 t_lap=0
 best=999
 boost_t=0
 mus_on=true
 music(0)

 -- convert tile 8 into 3d trees
 trees={}
 for y=0,31 do
  for x=0,47 do
   if mget(x,y)==8 then
    add(trees,{x=x+0.5,y=y+0.5})
    mset(x,y,4)
   end
  end
 end
end

function _update()
 steer=0
 local turn=0.0085*(0.4+abs(spd)*4)
 if btn(0) then ang-=turn steer=-1 end
 if btn(1) then ang+=turn steer=1 end
 ang%=1

 local accel=0
 if (btn(2) or btn(4)) accel=0.014
 if (btn(3)) accel=-0.01

 local tx=flr(px)%48
 local ty=flr(py)%32
 local tile=mget(tx,ty)

 -- track surface physics
 local drag=0.95
 local max_s=0.22
 if tile==4 or tile==7 then
  drag=0.87
  max_s=0.1
 elseif tile==5 then
  drag=0.82
  max_s=0.07
 elseif tile==6 and boost_t<=0 then
  boost_t=25
  spd=0.33
  sfx(0)
 end

 if boost_t>0 then
  boost_t-=1
  max_s=0.33
 end

 spd=mid(-0.08,(spd+accel)*drag,max_s)
 px=(px+cos(ang)*spd)%48
 py=(py+sin(ang)*spd)%32

 -- checkpoint & lap logic
 if (px>36 and py<16) chk=bor(chk,1)
 if (px<14 and py<16) chk=bor(chk,2)
 if tile==1 and chk==3 then
  if (t_lap<best) best=t_lap
  t_lap=0
  lap+=1
  chk=0
  sfx(1)
 end
 t_lap+=1/30

 if btnp(5) then
  mus_on=not mus_on
  music(mus_on and 0 or -1)
 end
end

function _draw()
 -- 1. sky gradient & parallax horizon
 cls(1)
 rectfill(0,18,127,36,12)
 rectfill(0,37,127,46,13)
 rectfill(0,47,127,52,6)

 -- sun
 local sx=(64-ang*256)%256-32
 circfill(sx,32,9,10)
 circfill(sx,32,6,7)

 -- parallax mountains
 local mx0=-ang*256
 for i=-1,3 do
  local bx=(mx0+i*64)%256-64
  for k=0,15 do
   local h=12-abs(k-8)*1.4
   line(bx+k*2,52,bx+k*2,52-h,2)
   line(bx+k*2+1,52,bx+k*2+1,52-h,2)
   local h2=9-abs(k-6)*1.1
   line(bx+26+k*2,52,bx+26+k*2,52-h2,5)
  end
 end

 -- 2. mode 7 ground projection via tline
 local hor=52
 local fov=64
 local sz=168
 local fx,fy=cos(ang),sin(ang)
 local rx,ry=-fy,fx

 pal()
 for y=hor+1,127 do
  local dy=y-hor
  local z=sz/dy
  local st=z/fov

  -- depth fog palette swap near horizon
  if dy<7 then
   pal(11,3)
   pal(3,1)
   pal(5,1)
   pal(6,5)
   pal(8,2)
   pal(7,6)
  elseif dy==7 then
   pal()
  end

  local mx=px+fx*z-rx*st*64
  local my=py+fy*z-ry*st*64
  tline(0,y,127,y,mx,my,rx*st,ry*st)
 end
 pal()

 -- 3. 3d billboard trees
 local vis={}
 for tr in all(trees) do
  local dx,dy=tr.x-px,tr.y-py
  if dx>24 then dx-=48 elseif dx<-24 then dx+=48 end
  if dy>16 then dy-=32 elseif dy<-16 then dy+=32 end
  local depth=dx*fx+dy*fy
  local side=dx*rx+dy*ry
  if depth>0.5 and depth<22 then
   local sy=hor+sz/depth
   local tx=64+(side/depth)*fov
   local sc=mid(2,flr(108/depth),24)
   if tx>-20 and tx<148 then
    add(vis,{d=depth,x=tx,y=sy,s=sc})
   end
  end
 end
 -- sort far to near
 for i=1,#vis do
  for j=i+1,#vis do
   if vis[j].d>vis[i].d then
    vis[i],vis[j]=vis[j],vis[i]
   end
  end
 end
 for v in all(vis) do
  local w=v.s
  local h=v.s*2
  sspr(32,8,8,16,v.x-w/2,v.y-h+1,w,h)
 end

 -- 4. player hover-kart
 local bob=abs(spd)>0.05 and flr(sin(t()*12)*1.2) or 0
 ovalfill(57,116,70,120,1)
 local kspr=steer==0 and 16 or 18
 spr(kspr,56,102+bob,2,2,steer>0)
 if boost_t>0 then
  circfill(61+rnd(6),116+rnd(3),2,rnd(2)>1 and 10 or 12)
 end

 -- 5. hud & minimap radar
 rectfill(0,0,127,9,0)
 print("lap "..lap,2,2,7)
 print("t:"..flr(t_lap*10)/10,34,2,11)
 if best<999 then
  print("b:"..flr(best*10)/10,66,2,10)
 end

 -- minimap top-right
 local mmx,mmy=100,12
 rectfill(mmx-1,mmy-1,mmx+24,mmy+16,0)
 rect(mmx-1,mmy-1,mmx+24,mmy+16,6)
 for y=0,31,2 do
  for x=0,47,2 do
   local tl=mget(x,y)
   if tl==2 or tl==1 then
    pset(mmx+x/2,mmy+y/2,tl==1 and 8 or 6)
   elseif tl==7 then
    pset(mmx+x/2,mmy+y/2,12)
   end
  end
 end
 pset(mmx+px/2,mmy+py/2,(flr(t()*8)%2==0) and 10 or 7)

 -- speedometer bottom-left
 local kmh=flr(abs(spd)*950)
 rectfill(2,118,38,125,0)
 rect(2,118,38,125,6)
 rectfill(4,120,4+mid(0,flr(kmh/10),32),123,boost_t>0 and 12 or 11)
 print(kmh.."km",4,111,7)
end
`;
  return c;
}
