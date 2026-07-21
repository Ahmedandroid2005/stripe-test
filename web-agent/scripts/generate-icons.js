'use strict';

/**
 * Generates the PWA/home-screen icon set for Nexus Code from a single SVG
 * source. Run manually with `node scripts/generate-icons.js` whenever the
 * logo mark changes — the output PNGs are committed to icons/, not built
 * at deploy time, so Vercel just serves them as static files.
 *
 * The mark is drawn with plain rects/paths (no text/font glyphs) so it
 * rasterizes identically regardless of what fonts are installed wherever
 * this script happens to run.
 */

const sharp = require('sharp');
const path = require('node:path');
const fs = require('node:fs');

const OUT_DIR = path.join(__dirname, '..', 'icons');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Base "N" monogram geometry in a 1024x1024 canvas, centered on (512,512).
const CENTER = 512;
const LEFT_BAR = { x: 238, y: 232, w: 108, h: 560 };
const RIGHT_BAR = { x: 678, y: 232, w: 108, h: 560 };
const DIAGONAL = [
  [238, 232],
  [346, 232],
  [786, 792],
  [678, 792],
];

// Scales every glyph coordinate toward the canvas center by `scale`, so the
// same continuous background gradient can hold a smaller mark (used for the
// maskable icon's safe zone) without any post-processing seam.
function scalePoint([x, y], scale) {
  return [CENTER + (x - CENTER) * scale, CENTER + (y - CENTER) * scale];
}

function buildSvg(scale) {
  const [lx, ly] = scalePoint([LEFT_BAR.x, LEFT_BAR.y], scale);
  const [rx, ry] = scalePoint([RIGHT_BAR.x, RIGHT_BAR.y], scale);
  const barW = LEFT_BAR.w * scale;
  const barH = LEFT_BAR.h * scale;
  const rx2 = 24 * scale;
  const diag = DIAGONAL.map((p) => scalePoint(p, scale));
  const diagPath = `M${diag[0][0]},${diag[0][1]} L${diag[1][0]},${diag[1][1]} L${diag[2][0]},${diag[2][1]} L${diag[3][0]},${diag[3][1]} Z`;

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#5b52f0"/>
      <stop offset="100%" stop-color="#3f36c9"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  <rect x="${lx}" y="${ly}" width="${barW}" height="${barH}" rx="${rx2}" fill="#ffffff"/>
  <rect x="${rx}" y="${ry}" width="${barW}" height="${barH}" rx="${rx2}" fill="#ffffff"/>
  <path d="${diagPath}" fill="#ffffff"/>
</svg>`.trim();
}

const NORMAL_SVG = buildSvg(1);
const MASKABLE_SVG = buildSvg(0.62); // shrunk into the ~80% safe zone Android/iOS expect

const targets = [
  { file: 'icon-32.png', size: 32, svg: NORMAL_SVG },
  { file: 'icon-180.png', size: 180, svg: NORMAL_SVG }, // apple-touch-icon
  { file: 'icon-192.png', size: 192, svg: NORMAL_SVG }, // manifest
  { file: 'icon-512.png', size: 512, svg: NORMAL_SVG }, // manifest
  { file: 'icon-512-maskable.png', size: 512, svg: MASKABLE_SVG },
];

async function run() {
  for (const t of targets) {
    const outPath = path.join(OUT_DIR, t.file);
    await sharp(Buffer.from(t.svg), { density: 384 }).resize(t.size, t.size).png().toFile(outPath);
    console.log('wrote', outPath);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
