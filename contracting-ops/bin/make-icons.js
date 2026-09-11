// Generates the app icons as PNGs (home-screen icon on iOS, manifest icons
// elsewhere). Hand-rolled encoder so the project keeps its zero dependencies.
//   node bin/make-icons.js
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const BG = [0x14, 0x60, 0x3f];
const FG = [0xff, 0xff, 0xff];

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
    raw[rowStart] = 0;                       // filter: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x / size, y / size);
      raw.set([r, g, b, a], rowStart + 1 + x * 4);
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;                                // bit depth
  ihdr[9] = 6;                                // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// A roofline over a beam: reads as construction at 40px, and full-bleed so
// iOS and Android can apply their own corner masks.
function mark(u, v) {
  const roof = v - 0.85 * Math.abs(u - 0.5);
  const inRoof = roof > 0.20 && roof < 0.325 && u > 0.14 && u < 0.86;
  const inBeam = v > 0.63 && v < 0.735 && u > 0.16 && u < 0.84;
  return [...(inRoof || inBeam ? FG : BG), 255];
}

for (const size of [180, 512]) {
  const file = join(outDir, `icon-${size}.png`);
  writeFileSync(file, png(size, mark));
  console.log(`wrote ${file}`);
}
