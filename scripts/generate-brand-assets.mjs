import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");

// Pure Node.js PNG decoder + premultiplied area-box resizer + PNG/ICO encoder.
// Derives favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png,
// email-logo.png, and og-image.png directly from the official RapidShift Labs
// brand logos stored in public/logo-nobg.png, public/logo.png, and public/long-logo-nobg.png.

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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodePngToRgba(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) {
      throw new Error(`Invalid PNG signature in ${filePath}`);
    }
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatChunks = [];

  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString("ascii");
    const data = buf.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }
  }

  if (bitDepth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) {
    throw new Error(
      `Unsupported PNG format in ${filePath}: depth=${bitDepth}, colorType=${colorType}, interlace=${interlace}`
    );
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const recon = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (stride + 1)];
    const srcRow = y * (stride + 1) + 1;
    const dstRow = y * stride;

    for (let x = 0; x < stride; x++) {
      const raw = inflated[srcRow + x];
      const a = x >= bpp ? recon[dstRow + x - bpp] : 0;
      const b = y > 0 ? recon[dstRow - stride + x] : 0;
      const c = y > 0 && x >= bpp ? recon[dstRow - stride + x - bpp] : 0;

      let val = raw;
      if (filterType === 1) val = (raw + a) & 0xff;
      else if (filterType === 2) val = (raw + b) & 0xff;
      else if (filterType === 3) val = (raw + ((a + b) >> 1)) & 0xff;
      else if (filterType === 4) val = (raw + paethPredictor(a, b, c)) & 0xff;

      recon[dstRow + x] = val;
    }
  }

  if (colorType === 6) {
    return { width, height, rgba: recon };
  }

  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < recon.length; i += 3, j += 4) {
    rgba[j] = recon[i];
    rgba[j + 1] = recon[i + 1];
    rgba[j + 2] = recon[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
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
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0;
  entry[3] = 0;
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, pngBuf]);
}

// High-quality area-box resizer with premultiplied alpha so crisp black geometric strokes stay razor-sharp
function resizeRgba(src, dstWidth, dstHeight) {
  const dst = Buffer.alloc(dstWidth * dstHeight * 4);
  const scaleX = src.width / dstWidth;
  const scaleY = src.height / dstHeight;

  for (let dy = 0; dy < dstHeight; dy++) {
    const sy0 = dy * scaleY;
    const sy1 = (dy + 1) * scaleY;
    const yStart = Math.floor(sy0);
    const yEnd = Math.min(src.height - 1, Math.ceil(sy1) - 1);

    for (let dx = 0; dx < dstWidth; dx++) {
      const sx0 = dx * scaleX;
      const sx1 = (dx + 1) * scaleX;
      const xStart = Math.floor(sx0);
      const xEnd = Math.min(src.width - 1, Math.ceil(sx1) - 1);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let totalWeight = 0;

      for (let sy = yStart; sy <= yEnd; sy++) {
        const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
        if (wy <= 0) continue;
        for (let sx = xStart; sx <= xEnd; sx++) {
          const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
          if (wx <= 0) continue;
          const weight = wx * wy;
          const idx = (sy * src.width + sx) * 4;
          const a = src.rgba[idx + 3] / 255;
          sumR += src.rgba[idx] * a * weight;
          sumG += src.rgba[idx + 1] * a * weight;
          sumB += src.rgba[idx + 2] * a * weight;
          sumA += a * weight;
          totalWeight += weight;
        }
      }

      const outIdx = (dy * dstWidth + dx) * 4;
      if (totalWeight > 0 && sumA > 1e-6) {
        dst[outIdx] = Math.round(Math.min(255, sumR / sumA));
        dst[outIdx + 1] = Math.round(Math.min(255, sumG / sumA));
        dst[outIdx + 2] = Math.round(Math.min(255, sumB / sumA));
        dst[outIdx + 3] = Math.round(Math.min(255, (sumA / totalWeight) * 255));
      }
    }
  }

  return { width: dstWidth, height: dstHeight, rgba: dst };
}

function compositeOver(dst, src, offsetX, offsetY) {
  for (let sy = 0; sy < src.height; sy++) {
    const dy = offsetY + sy;
    if (dy < 0 || dy >= dst.height) continue;
    for (let sx = 0; sx < src.width; sx++) {
      const dx = offsetX + sx;
      if (dx < 0 || dx >= dst.width) continue;

      const sIdx = (sy * src.width + sx) * 4;
      const sa = src.rgba[sIdx + 3] / 255;
      if (sa <= 0) continue;

      const dIdx = (dy * dst.width + dx) * 4;
      const da = dst.rgba[dIdx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;

      dst.rgba[dIdx] = Math.round(
        (src.rgba[sIdx] * sa + dst.rgba[dIdx] * da * (1 - sa)) / outA
      );
      dst.rgba[dIdx + 1] = Math.round(
        (src.rgba[sIdx + 1] * sa + dst.rgba[dIdx + 1] * da * (1 - sa)) / outA
      );
      dst.rgba[dIdx + 2] = Math.round(
        (src.rgba[sIdx + 2] * sa + dst.rgba[dIdx + 2] * da * (1 - sa)) / outA
      );
      dst.rgba[dIdx + 3] = Math.round(outA * 255);
    }
  }
}

function roundedRectAlpha(x, y, rx, ry, rw, rh, radius) {
  // 4x4 subpixel anti-aliasing on rounded badge border
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) {
    const py = y + (sy + 0.5) / 4;
    if (py < ry || py > ry + rh) continue;
    const cy = Math.max(ry + radius, Math.min(py, ry + rh - radius));
    const dy = py - cy;
    for (let sx = 0; sx < 4; sx++) {
      const px = x + (sx + 0.5) / 4;
      if (px < rx || px > rx + rw) continue;
      const cx = Math.max(rx + radius, Math.min(px, rx + rw - radius));
      const dx = px - cx;
      if (dx * dx + dy * dy <= radius * radius) {
        hits += 1;
      }
    }
  }
  return hits / 16;
}

function buildRoundedWhiteBadgeIcon(markNobg, size, rounded = true) {
  const canvas = {
    width: size,
    height: size,
    rgba: Buffer.alloc(size * size * 4),
  };

  if (!rounded) {
    for (let i = 0; i < canvas.rgba.length; i += 4) {
      canvas.rgba[i] = 255;
      canvas.rgba[i + 1] = 255;
      canvas.rgba[i + 2] = 255;
      canvas.rgba[i + 3] = 255;
    }
  } else {
    const radius = size * 0.22;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const a = roundedRectAlpha(x, y, 0, 0, size, size, radius);
        if (a <= 0) continue;
        const idx = (y * size + x) * 4;
        canvas.rgba[idx] = 255;
        canvas.rgba[idx + 1] = 255;
        canvas.rgba[idx + 2] = 255;
        canvas.rgba[idx + 3] = Math.round(a * 255);
      }
    }
  }

  // markNobg already has clean margin around the R monogram; scale to 88% of badge
  const innerSize = Math.max(16, Math.round(size * 0.88));
  const scaledMark = resizeRgba(markNobg, innerSize, innerSize);
  const pad = Math.floor((size - innerSize) / 2);
  compositeOver(canvas, scaledMark, pad, pad);
  return encodeRgbaToPng(size, size, canvas.rgba);
}

function buildEmailLogoPng(longLogoNobg) {
  const targetH = 84;
  const targetW = Math.round(targetH * (longLogoNobg.width / longLogoNobg.height));
  const canvas = {
    width: targetW,
    height: targetH,
    rgba: Buffer.alloc(targetW * targetH * 4),
  };
  for (let i = 0; i < canvas.rgba.length; i += 4) {
    canvas.rgba[i] = 255;
    canvas.rgba[i + 1] = 255;
    canvas.rgba[i + 2] = 255;
    canvas.rgba[i + 3] = 255;
  }
  const scaled = resizeRgba(longLogoNobg, targetW, targetH);
  compositeOver(canvas, scaled, 0, 0);
  return encodeRgbaToPng(targetW, targetH, canvas.rgba);
}

function buildOgImagePng(longLogoNobg) {
  const W = 1200;
  const H = 630;
  const canvas = {
    width: W,
    height: H,
    rgba: Buffer.alloc(W * H * 4),
  };

  // Clean #F8F9FB background with centered #FFFFFF card and top brand accent bar
  const cardX = 80;
  const cardY = 65;
  const cardW = W - 160;
  const cardH = H - 130;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = (y * W + x) * 4;
      let r = 248,
        g = 249,
        b = 251;

      if (x >= cardX && x < cardX + cardW && y >= cardY && y < cardY + cardH) {
        if (y < cardY + 8) {
          // Top corporate stationery bar: 75% slate-900, 25% emerald-600
          if (x < cardX + Math.round(cardW * 0.75)) {
            r = 15;
            g = 23;
            b = 42;
          } else {
            r = 5;
            g = 150;
            b = 105;
          }
        } else if (
          x === cardX ||
          x === cardX + cardW - 1 ||
          y === cardY + cardH - 1
        ) {
          r = 228;
          g = 228;
          b = 231;
        } else {
          r = 255;
          g = 255;
          b = 255;
        }
      }

      canvas.rgba[idx] = r;
      canvas.rgba[idx + 1] = g;
      canvas.rgba[idx + 2] = b;
      canvas.rgba[idx + 3] = 255;
    }
  }

  const logoW = 720;
  const logoH = Math.round(logoW * (longLogoNobg.height / longLogoNobg.width));
  const scaledLogo = resizeRgba(longLogoNobg, logoW, logoH);
  compositeOver(
    canvas,
    scaledLogo,
    Math.round((W - logoW) / 2),
    Math.round((H - logoH) / 2)
  );

  return encodeRgbaToPng(W, H, canvas.rgba);
}

const markNobgPath = path.join(publicDir, "logo-nobg.png");
const longLogoNobgPath = path.join(publicDir, "long-logo-nobg.png");

if (!fs.existsSync(markNobgPath) || !fs.existsSync(longLogoNobgPath)) {
  throw new Error(
    "Expected official brand logos at public/logo-nobg.png and public/long-logo-nobg.png"
  );
}

const markNobg = decodePngToRgba(markNobgPath);
const longLogoNobg = decodePngToRgba(longLogoNobgPath);

const icon32Png = buildRoundedWhiteBadgeIcon(markNobg, 32, true);
fs.writeFileSync(path.join(publicDir, "favicon.ico"), wrapPngInIco(icon32Png, 32));
fs.writeFileSync(
  path.join(publicDir, "apple-touch-icon.png"),
  buildRoundedWhiteBadgeIcon(markNobg, 180, false)
);
fs.writeFileSync(
  path.join(publicDir, "icon-192.png"),
  buildRoundedWhiteBadgeIcon(markNobg, 192, true)
);
fs.writeFileSync(
  path.join(publicDir, "icon-512.png"),
  buildRoundedWhiteBadgeIcon(markNobg, 512, true)
);
fs.writeFileSync(path.join(publicDir, "email-logo.png"), buildEmailLogoPng(longLogoNobg));
fs.writeFileSync(path.join(publicDir, "og-image.png"), buildOgImagePng(longLogoNobg));

console.log(
  "[generate-brand-assets] Derived favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png, email-logo.png, and og-image.png from official RapidShift Labs PNG logos."
);
