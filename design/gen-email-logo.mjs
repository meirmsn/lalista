// One-off: regenerate apps/web/public/lalista-email-logo.png at 4x DPI
// (480x160, padded to 3:1 aspect, transparent bg, 32-color palette).
//
// Pipeline: @fontsource/fraunces static weight-400 woff2 → outline via
// opentype.js → SVG → rasterize via ImageMagick (magick CLI) →
// quantized PNG.
//
// Why @fontsource (not next-bundled Fraunces from .next/static/media):
// Next.js's font subsetter strips variable axes from the cached woff2,
// pinning each subset to a single static weight that may NOT be 400.
// First pass of this script used the next-cached subset and rendered
// the wordmark visibly thicker than the live app's `font-normal`
// (CSS weight=400) wordmark — observed in real email after
// post-deploy verification. @fontsource ships per-weight static files
// (`fraunces-latin-400-normal.woff2`) so weight=400 is unambiguous.
//
// Dependencies are NOT in package.json — this script is a one-off
// regen tool, not a build step. Install them ad-hoc when you actually
// need to re-render:
//
//     pnpm add -wD opentype.js wawoff2 @fontsource/fraunces
//     node design/gen-email-logo.mjs
//     pnpm remove -w opentype.js wawoff2 @fontsource/fraunces   # optional cleanup
//
// To re-render at a different weight (300/500/600), change the FONT_PATH
// to the matching `@fontsource/fraunces/files/fraunces-latin-NNN-normal.woff2`.
// To change brand color, point size, or canvas dimensions: edit the
// constants below.
import opentype from 'opentype.js';
import wawoff2 from 'wawoff2';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

// Resolve everything relative to the workspace root so the script can be
// run from any cwd: `node design/gen-email-logo.mjs`, `cd design && node ...`,
// `pnpm exec node design/gen-email-logo.mjs`, etc. all work identically.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT_PATH = path.join(
  ROOT,
  'node_modules/@fontsource/fraunces/files/fraunces-latin-400-normal.woff2',
);
const OUT_PNG = path.join(ROOT, 'apps/web/public/lalista-email-logo.png');
const TMP_SVG = '/tmp/lalista-email-logo-source.svg';

const TEXT = 'lalista';
const FONT_SIZE = 100; // arbitrary — final PNG is rasterized at WIDTH×HEIGHT
const COLOR = '#D4603A';
const WIDTH = 480; // 4x for the 120-CSS-px email template (covers 3x DPI crisp + 4x adequately)
const HEIGHT = 160; // 3:1 box matches original 240×80 layout — wordmark auto-centered with vertical padding
const PADDING = 4;
const PALETTE_SIZE = 32; // smooth antialiasing without bloating bytes

const woff2Buf = fs.readFileSync(FONT_PATH);
const ttfBytes = await wawoff2.decompress(woff2Buf);
const ttfBuf = Buffer.from(ttfBytes);
const font = opentype.parse(ttfBuf.buffer.slice(ttfBuf.byteOffset, ttfBuf.byteOffset + ttfBuf.byteLength));

const probe = font.getPath(TEXT, 0, 0, FONT_SIZE);
const bbox = probe.getBoundingBox();
const svgWidth = Math.ceil(bbox.x2 - bbox.x1 + PADDING * 2);
const svgHeight = Math.ceil(bbox.y2 - bbox.y1 + PADDING * 2);
const tx = -bbox.x1 + PADDING;
const ty = -bbox.y1 + PADDING;
const glyphPath = font.getPath(TEXT, tx, ty, FONT_SIZE);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${svgWidth} ${svgHeight}" width="${svgWidth}" height="${svgHeight}" role="img" aria-label="${TEXT}"><path fill="${COLOR}" d="${glyphPath.toPathData(2)}"/></svg>\n`;
fs.writeFileSync(TMP_SVG, svg);

execFileSync(
  'magick',
  [
    '-density',
    '600',
    '-background',
    'none',
    TMP_SVG,
    '-resize',
    `${WIDTH}x${HEIGHT}`,
    '-background',
    'none',
    '-gravity',
    'center',
    '-extent',
    `${WIDTH}x${HEIGHT}`,
    '-strip',
    '-dither',
    'None',
    '-colors',
    String(PALETTE_SIZE),
    'PNG8:' + OUT_PNG,
  ],
  { stdio: 'inherit' },
);

const stat = fs.statSync(OUT_PNG);
console.log(`Wrote ${OUT_PNG} (${stat.size} bytes, ${WIDTH}×${HEIGHT})`);
fs.unlinkSync(TMP_SVG);
