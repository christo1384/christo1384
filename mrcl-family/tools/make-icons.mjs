#!/usr/bin/env node
// Generates the app icons as PNGs (home-screen icon on iOS, manifest icons
// elsewhere). Hand-rolled encoder so the project keeps its zero dependencies.
//   node tools/make-icons.mjs

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [0x0d, 0x11, 0x17];
const GRID = [0x2b, 0x34, 0x44];
const DAYS = [
  [0xf7, 0x8d, 0xa7],
  [0xff, 0xd1, 0x66],
  [0x5b, 0xd9, 0x8a],
  [0x7c, 0xc4, 0xff],
];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixel) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < size; x += 1) {
      raw.set(pixel((x + 0.5) / size, (y + 0.5) / size), rowStart + 1 + x * 4);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * A week board: a coloured header strip of day columns over a grid of cells.
 * `inset` leaves room for the safe zone a maskable icon needs.
 */
function mark(inset) {
  const lo = inset;
  const hi = 1 - inset;
  const span = hi - lo;

  return (u, v) => {
    if (u < lo || u > hi || v < lo || v > hi) return [...BG, 255];

    const x = (u - lo) / span; // 0..1 inside the board
    const y = (v - lo) / span;

    const column = Math.min(3, Math.floor(x * 4));
    const gutter = Math.abs((x * 4) % 1 - 0.5) > 0.42;

    // Header strip of day colours.
    if (y < 0.26) return gutter ? [...BG, 255] : [...DAYS[column], 255];

    // Body: four rows of cells.
    const row = Math.floor((y - 0.3) * 4 / 0.7);
    const rowGutter = Math.abs(((y - 0.3) * 4 / 0.7) % 1 - 0.5) > 0.36;
    if (y < 0.3 || row > 3 || gutter || rowGutter) return [...BG, 255];

    // A couple of cells picked out in their day colour, so it reads as a
    // planner rather than a plain grid at 40px.
    const filled = (column === 0 && row === 0) || (column === 2 && row === 1) || (column === 1 && row === 3);
    return filled ? [...DAYS[column], 255] : [...GRID, 255];
  };
}

const targets = [
  ['icon-180.png', 180, 0.1],
  ['icon-192.png', 192, 0.1],
  ['icon-512.png', 512, 0.1],
  ['icon-maskable-512.png', 512, 0.22],
];

for (const [name, size, inset] of targets) {
  const file = join(outDir, name);
  writeFileSync(file, png(size, mark(inset)));
  console.log(`wrote ${file}`);
}
