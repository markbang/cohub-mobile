import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Writes the striped test picture the debug Chat shows (`assets/debug/stripes.png`). Its bands run top to bottom,
 * so scrolling the Chat moves each one past the chrome in turn: fine lines, thick bars, colour bars, a checkerboard,
 * thin rules, and a vertical line. Red and blue rows mark its top and bottom edges. Run again after changing a band;
 * the output is deterministic.
 */
export const WIDTH = 240;
export const HEIGHT = 720;

const BAND = HEIGHT / 8;
const BLACK = [0, 0, 0];
const WHITE = [255, 255, 255];
const RED = [230, 30, 30];
const BLUE = [30, 60, 230];
const COLOURS = [WHITE, [230, 30, 30], [30, 180, 60], [30, 60, 230], [240, 210, 30], [30, 200, 220], [200, 40, 200]];

/** The colour of the pixel at (x, y): one band per eighth of the height, with edge rows and a vertical line over all of them. */
export function pixel(x, y) {
  if (y < 6 || y >= HEIGHT - 6) return y < 6 ? RED : BLUE;
  if (Math.abs(x - WIDTH / 2) < 2) return BLACK;
  const band = Math.floor(y / BAND);
  const row = y - band * BAND;
  switch (band) {
    case 0: return Math.floor(row / 2) % 2 === 0 ? BLACK : WHITE;
    case 1: return Math.floor(row / 15) % 2 === 0 ? BLACK : WHITE;
    case 2: return COLOURS[Math.floor(x / (WIDTH / COLOURS.length))];
    case 3: return (Math.floor(x / 15) + Math.floor(row / 15)) % 2 === 0 ? BLACK : WHITE;
    case 4: return Math.floor(x / 20) % 2 === 0 ? BLACK : WHITE;
    case 5: return row % 8 === 0 ? BLACK : WHITE;
    case 6: return (Math.floor(x / 15) + Math.floor(row / 15)) % 2 === 0 ? RED : BLUE;
    default: return row < 10 || row >= BAND - 10 ? BLACK : WHITE;
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(typed), 0);
  return Buffer.concat([length, typed, checksum]);
}

/** A truecolour 8-bit PNG of the bands, one unfiltered scanline at a time. */
export function encodePng() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = [];
  for (let y = 0; y < HEIGHT; y += 1) {
    const row = Buffer.alloc(1 + WIDTH * 3);
    for (let x = 0; x < WIDTH; x += 1) row.set(pixel(x, y), 1 + x * 3);
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "../assets/debug/stripes.png");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, encodePng());
  process.stdout.write(`Wrote ${out} (${WIDTH}×${HEIGHT}).\n`);
}
