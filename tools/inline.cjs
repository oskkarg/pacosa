// Unifica dist/index.html + assets (js/css) en UN unico HTML autocontenido.
const fs = require('fs'), path = require('path');
const dist = path.join(__dirname, '..', 'dist');
const out = path.join(__dirname, '..', 'release', 'pico8-fantasy-console.html');
let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
const rd = (p) => fs.readFileSync(path.join(dist, p.replace(/^[./]+/, '')), 'utf8');
html = html.replace(/<script[^>]*\ssrc="([^"]+\.js)"[^>]*><\/script>/g, (m, src) =>
  fs.existsSync(path.join(dist, src.replace(/^[./]+/, '')))
    ? '<script type="module">' + rd(src).replace(/<\/script/gi, '<\\/script') + '</script>' : m);
html = html.replace(/<link[^>]*\shref="([^"]+\.css)"[^>]*>/g, (m, href) =>
  fs.existsSync(path.join(dist, href.replace(/^[./]+/, '')))
    ? '<style>' + rd(href) + '</style>' : m);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('OK ->', out, (html.length / 1024).toFixed(0) + ' KB');
