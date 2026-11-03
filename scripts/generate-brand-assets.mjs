import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

// Pure Node.js CRC32 + PNG + ICO generator so brand raster assets build deterministically with zero native binary issues
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodeRgbaToPng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter None
    rgba.copy(raw, rowStart + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function wrapPngInIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(1, 4); // 1 image

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // 32 bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12); // offset 6 + 16
  return Buffer.concat([header, entry, pngBuf]);
}

function pointInPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function insideRoundedRect(x, y, rx, ry, rw, rh, radius) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const cx = Math.max(rx + radius, Math.min(x, rx + rw - radius));
  const cy = Math.max(ry + radius, Math.min(y, ry + rh - radius));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function renderBrandIconPng(size) {
  const rgba = Buffer.alloc(size * size * 4, 0);
  const boltPoly = [
    [0.28, 0.31],
    [0.58, 0.31],
    [0.46, 0.48],
    [0.73, 0.48],
    [0.41, 0.75],
    [0.49, 0.53],
    [0.265, 0.53],
  ];

  const pad = size * 0.06;
  const box = size - pad * 2;
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (!insideRoundedRect(cx, cy, pad, pad, box, box, radius)) {
        continue;
      }

      const nx = cx / size;
      const ny = cy / size;

      // Subtle dark slate vertical gradient (#1E293B -> #0F172A)
      let r = Math.round(30 - 15 * ny);
      let g = Math.round(41 - 18 * ny);
      let b = Math.round(59 - 17 * ny);

      // Emerald bolt mark
      if (pointInPolygon(nx, ny, boltPoly)) {
        r = Math.round(16 - 11 * ny);
        g = Math.round(185 - 35 * ny);
        b = Math.round(129 - 24 * ny);
      }

      // Mint accent dot
      const dotDx = nx - 0.695;
      const dotDy = ny - 0.305;
      if (dotDx * dotDx + dotDy * dotDy <= 0.047 * 0.047) {
        r = 52;
        g = 211;
        b = 153;
      }

      rgba[idx] = r;
      rgba[idx + 1] = g;
      rgba[idx + 2] = b;
      rgba[idx + 3] = 255;
    }
  }
  return encodeRgbaToPng(size, size, rgba);
}

// 5x7 crisp bitmap glyphs for clean email header & OG banner typography without external font files
const GLYPHS = {
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawBitmapText(rgba, width, height, text, startX, startY, scale, color) {
  let cursorX = startX;
  for (const ch of text) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === "1") {
            for (let sy = 0; sy < scale; sy++) {
              for (let sx = 0; sx < scale; sx++) {
                const px = cursorX + gx * scale + sx;
                const py = startY + gy * scale + sy;
                if (px >= 0 && px < width && py >= 0 && py < height) {
                  const idx = (py * width + px) * 4;
                  rgba[idx] = color[0];
                  rgba[idx + 1] = color[1];
                  rgba[idx + 2] = color[2];
                  rgba[idx + 3] = 255;
                }
              }
            }
          }
        }
      }
    }
    cursorX += 6 * scale;
  }
}

function blitIcon(targetRgba, targetW, targetH, iconSize, destX, destY) {
  const iconPng = renderBrandIconPng; // reuse pixel logic directly
  const boltPoly = [
    [0.28, 0.31],
    [0.58, 0.31],
    [0.46, 0.48],
    [0.73, 0.48],
    [0.41, 0.75],
    [0.49, 0.53],
    [0.265, 0.53],
  ];
  const pad = iconSize * 0.05;
  const box = iconSize - pad * 2;
  const radius = iconSize * 0.22;

  for (let y = 0; y < iconSize; y++) {
    for (let x = 0; x < iconSize; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (!insideRoundedRect(cx, cy, pad, pad, box, box, radius)) continue;
      const px = destX + x;
      const py = destY + y;
      if (px < 0 || px >= targetW || py < 0 || py >= targetH) continue;
      const nx = cx / iconSize;
      const ny = cy / iconSize;
      let r = Math.round(30 - 15 * ny);
      let g = Math.round(41 - 18 * ny);
      let b = Math.round(59 - 17 * ny);
      if (pointInPolygon(nx, ny, boltPoly)) {
        r = 16;
        g = 185;
        b = 129;
      }
      const dotDx = nx - 0.695;
      const dotDy = ny - 0.305;
      if (dotDx * dotDx + dotDy * dotDy <= 0.047 * 0.047) {
        r = 52;
        g = 211;
        b = 153;
      }
      const idx = (py * targetW + px) * 4;
      targetRgba[idx] = r;
      targetRgba[idx + 1] = g;
      targetRgba[idx + 2] = b;
      targetRgba[idx + 3] = 255;
    }
  }
  void iconPng;
}

function renderEmailLogoPng() {
  const width = 260;
  const height = 56;
  const rgba = Buffer.alloc(width * height * 4, 0); // transparent background!
  blitIcon(rgba, width, height, 48, 4, 4);
  drawBitmapText(rgba, width, height, "RAPID", 64, 12, 3, [15, 23, 42]);
  drawBitmapText(rgba, width, height, "SHIFT", 154, 12, 3, [5, 150, 105]);
  drawBitmapText(rgba, width, height, "LABS", 65, 37, 2, [100, 116, 139]);
  return encodeRgbaToPng(width, height, rgba);
}

function renderOgImagePng() {
  const width = 1200;
  const height = 630;
  const rgba = Buffer.alloc(width * height * 4, 255);

  // Clean dark-slate to emerald-accent social card
  for (let y = 0; y < height; y++) {
    const ny = y / height;
    const baseR = Math.round(15 - 6 * ny);
    const baseG = Math.round(23 - 8 * ny);
    const baseB = Math.round(42 - 14 * ny);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Top emerald accent bar (8px)
      if (y < 10) {
        rgba[idx] = 16;
        rgba[idx + 1] = 185;
        rgba[idx + 2] = 129;
        rgba[idx + 3] = 255;
      } else {
        rgba[idx] = baseR;
        rgba[idx + 1] = baseG;
        rgba[idx + 2] = baseB;
        rgba[idx + 3] = 255;
      }
    }
  }

  blitIcon(rgba, width, height, 148, 96, 180);
  drawBitmapText(rgba, width, height, "RAPID", 280, 206, 9, [248, 250, 252]);
  drawBitmapText(rgba, width, height, "SHIFT", 558, 206, 9, [52, 211, 153]);
  drawBitmapText(rgba, width, height, "LABS", 284, 290, 5, [148, 163, 184]);

  // Decorative bento pill bars at bottom representing Tally + WhatsApp + Cloud Backups
  const pills = [
    { x: 96, w: 310, color: [5, 150, 105] },
    { x: 430, w: 310, color: [30, 41, 59] },
    { x: 764, w: 340, color: [30, 41, 59] },
  ];
  for (const p of pills) {
    for (let y = 430; y < 512; y++) {
      for (let x = p.x; x < p.x + p.w; x++) {
        if (insideRoundedRect(x + 0.5, y + 0.5, p.x, 430, p.w, 82, 18)) {
          const idx = (y * width + x) * 4;
          rgba[idx] = p.color[0];
          rgba[idx + 1] = p.color[1];
          rgba[idx + 2] = p.color[2];
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  return encodeRgbaToPng(width, height, rgba);
}

fs.mkdirSync(publicDir, { recursive: true });

const icon32 = renderBrandIconPng(32);
fs.writeFileSync(path.join(publicDir, "favicon.ico"), wrapPngInIco(icon32, 32));
fs.writeFileSync(path.join(publicDir, "apple-touch-icon.png"), renderBrandIconPng(180));
fs.writeFileSync(path.join(publicDir, "icon-192.png"), renderBrandIconPng(192));
fs.writeFileSync(path.join(publicDir, "icon-512.png"), renderBrandIconPng(512));
fs.writeFileSync(path.join(publicDir, "email-logo.png"), renderEmailLogoPng());
fs.writeFileSync(path.join(publicDir, "og-image.png"), renderOgImagePng());

console.log("[generate-brand-assets] Generated favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, email-logo.png, and og-image.png");
