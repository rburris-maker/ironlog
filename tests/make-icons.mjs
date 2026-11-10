// Regenerates the app icons from one SVG drawing.  Usage: node tests/make-icons.mjs
// (needs the "sharp" package: npm i -D sharp)
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'icons');

// A weight plate seen face-on, crossed by the app's slanted bar, on black.
const art = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <g transform="translate(256 256) scale(${(256 - pad) / 256})">
    <circle r="190" fill="none" stroke="#ffffff" stroke-width="44"/>
    <circle r="40" fill="#ffffff"/>
    <polygon points="20,-250 96,-250 -20,250 -96,250" fill="#ff4b1f"/>
  </g>
</svg>`;

const make = (name, size, pad) => sharp(Buffer.from(art(pad))).resize(size, size).png().toFile(path.join(out, name));

await Promise.all([
  make('icon-192.png', 192, 36),
  make('icon-512.png', 512, 36),
  make('icon-maskable-512.png', 512, 96),
  make('apple-touch-icon.png', 180, 30),
]);
console.log('icons written to', out);
