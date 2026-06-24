/**
 * gen-test-psds.mjs
 *
 * Build-time utility that generates realistic PSD test fixtures for live-testing
 * the Adobe Photoshop API integration (photoshop_smart_object_replace,
 * photoshop_edit_text, etc.).
 *
 * NOT a project dependency: ag-psd is installed with `npm i ag-psd --no-save`.
 * All output goes to live-test-tmp/ (gitignored).
 *
 * Run:  node scripts/gen-test-psds.mjs
 *
 * Notes on the ag-psd Node path:
 *  - We avoid the optional `canvas` native dependency by supplying raw
 *    `imageData` ({ data: Uint8Array(RGBA), width, height }) for every layer
 *    bitmap instead of HTMLCanvasElement. writePsd only needs `canvas` when
 *    `generateThumbnail: true`, which we leave off.
 *  - A TRUE smart object is produced by attaching `placedLayer` (with a SoLd /
 *    PlLd descriptor) to the layer AND registering the embedded source bytes in
 *    the document-level `linkedFiles[]` array. ag-psd round-trips this as a
 *    smart object (PlacedLayer) on read-back.
 */

import { writePsdBuffer, readPsd } from 'ag-psd';
import { writeFileSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import zlib from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'live-test-tmp');
mkdirSync(OUT_DIR, { recursive: true });

const CANVAS_W = 1200;
const CANVAS_H = 1200;

// ---------------------------------------------------------------------------
// Minimal RGBA bitmap helpers (no native canvas needed)
// ---------------------------------------------------------------------------

/** Solid-color RGBA imageData object accepted by ag-psd. */
function solid(width, height, [r, g, b, a = 255]) {
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4 + 0] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { data, width, height };
}

/** Vertical gradient background. */
function verticalGradient(width, height, top, bottom) {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const r = Math.round(top[0] + (bottom[0] - top[0]) * t);
    const g = Math.round(top[1] + (bottom[1] - top[1]) * t);
    const b = Math.round(top[2] + (bottom[2] - top[2]) * t);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Filled rounded-ish rectangle (simple filled rect) on a transparent canvas. */
function filledRect(width, height, [r, g, b, a = 255]) {
  return solid(width, height, [r, g, b, a]);
}

// ---------------------------------------------------------------------------
// Minimal PNG encoder (so we don't need the `canvas` package for replacement.png)
// ---------------------------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA imageData -> PNG Buffer using only zlib. */
function encodePng({ data, width, height }) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  // raw scanlines, each prefixed with filter byte 0
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    const src = y * width * 4;
    data.subarray
      ? raw.set(data.subarray(src, src + width * 4), y * (width * 4 + 1) + 1)
      : Buffer.from(data.buffer, src, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const idat = zlib.deflateSync(raw);

  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Draw a colored circle on a transparent square -> imageData. */
function circleImage(size, [r, g, b]) {
  const data = new Uint8Array(size * size * 4);
  const cx = size / 2, cy = size / 2, rad = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside = (x - cx) ** 2 + (y - cy) ** 2 <= rad ** 2;
      if (inside) { data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255; }
    }
  }
  return { data, width: size, height: size };
}

// ---------------------------------------------------------------------------
// Build a TRUE smart object layer (PlacedLayer + linkedFiles entry)
// ---------------------------------------------------------------------------

/**
 * Build the embedded source bytes for the placed/linked file. We embed a real
 * PNG so Photoshop has a valid raster source for the smart object.
 */
function buildSmartObjectSource() {
  const srcSize = 600;
  const srcImg = circleImage(srcSize, [230, 60, 60]); // red product placeholder
  return { bytes: encodePng(srcImg), srcW: srcSize, srcH: srcSize };
}

function buildProductSmartObjectLayer() {
  const { bytes, srcW, srcH } = buildSmartObjectSource();
  const linkedId = randomUUID();

  // Placement box for the smart object on the 1200x1200 canvas (centered, 600px).
  const left = (CANVAS_W - srcW) / 2;
  const top = (CANVAS_H - srcH) / 2;

  // Identity affine transform mapping source corners -> placement quad.
  // ag-psd transform array = [x0,y0, x1,y1, x2,y2, x3,y3] (TL,TR,BR,BL).
  const transform = [
    left, top,
    left + srcW, top,
    left + srcW, top + srcH,
    left, top + srcH,
  ];

  const layer = {
    name: 'PRODUCT',
    top,
    left,
    bottom: top + srcH,
    right: left + srcW,
    // Visible bitmap for the smart object instance (what shows on canvas).
    imageData: circleImage(srcW, [230, 60, 60]),
    placedLayer: {
      id: linkedId,
      type: 'raster',
      transform,
      width: srcW,
      height: srcH,
    },
  };

  const linkedFile = {
    id: linkedId,
    name: 'product-source.png',
    type: 'png ',
    creator: 'gen-test-psds',
    data: new Uint8Array(bytes),
  };

  return { layer, linkedFile };
}

// ---------------------------------------------------------------------------
// Build an editable text layer named HEADLINE
// ---------------------------------------------------------------------------

function buildHeadlineLayer() {
  const placeholder = 'SAMPLE TEXT';
  const boxTop = 80;
  const boxLeft = 100;
  const boxW = 1000;
  const boxH = 160;

  return {
    name: 'HEADLINE',
    top: boxTop,
    left: boxLeft,
    bottom: boxTop + boxH,
    right: boxLeft + boxW,
    // ag-psd requires a bitmap for the layer even for text layers.
    imageData: solid(boxW, boxH, [0, 0, 0, 0]), // transparent (text drawn by PS)
    text: {
      text: placeholder,
      orientation: 'horizontal',
      transform: [1, 0, 0, 1, boxLeft, boxTop + 100],
      shapeType: 'box',
      boxBounds: [0, 0, boxW, boxH],
      style: {
        font: { name: 'ArialMT' },
        fontSize: 96,
        fillColor: { r: 20, g: 20, b: 20 },
        autoKerning: true,
      },
      paragraphStyle: { justification: 'center' },
    },
  };
}

// ---------------------------------------------------------------------------
// Assemble & write template.psd
// ---------------------------------------------------------------------------

function buildTemplatePsd() {
  const { layer: productLayer, linkedFile } = buildProductSmartObjectLayer();
  const headlineLayer = buildHeadlineLayer();

  const background = {
    name: 'Background',
    top: 0,
    left: 0,
    bottom: CANVAS_H,
    right: CANVAS_W,
    imageData: verticalGradient(CANVAS_W, CANVAS_H, [245, 247, 250], [205, 215, 230]),
  };

  const psd = {
    width: CANVAS_W,
    height: CANVAS_H,
    channels: 3,
    bitsPerChannel: 8,
    colorMode: 3, // RGB
    // bottom-to-top order: background first, then product, then headline on top
    children: [background, productLayer, headlineLayer],
    linkedFiles: [linkedFile],
    // Composite for the whole document so PS/preview has a flattened image.
    imageData: verticalGradient(CANVAS_W, CANVAS_H, [245, 247, 250], [205, 215, 230]),
  };

  return psd;
}

// ---------------------------------------------------------------------------
// Validation: read back and print the layer tree
// ---------------------------------------------------------------------------

function describeLayer(layer, depth = 0) {
  const pad = '  '.repeat(depth);
  const kinds = [];
  if (layer.text) kinds.push('TEXT');
  if (layer.placedLayer) kinds.push(`SMART_OBJECT(${layer.placedLayer.type})`);
  if (!layer.text && !layer.placedLayer && (layer.canvas || layer.imageData)) kinds.push('PIXEL');
  if (layer.children) kinds.push('GROUP');
  const kind = kinds.length ? kinds.join('+') : 'EMPTY';
  let line = `${pad}- "${layer.name ?? '(unnamed)'}" [${kind}]`;
  if (layer.text) line += `  text="${layer.text.text}"`;
  console.log(line);
  if (layer.children) layer.children.forEach((c) => describeLayer(c, depth + 1));
}

function fileSize(p) {
  const bytes = statSync(p).size;
  return `${(bytes / 1024).toFixed(1)} KB (${bytes} bytes)`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const results = {};

  // template.psd
  const psd = buildTemplatePsd();
  const buf = writePsdBuffer(psd, { generateThumbnail: false });
  const templatePath = join(OUT_DIR, 'template.psd');
  writeFileSync(templatePath, buf);
  results.template = templatePath;

  // replacement.png (600x600 colored shape)
  const replacement = circleImage(600, [40, 120, 220]); // blue circle
  const replacementPath = join(OUT_DIR, 'replacement.png');
  writeFileSync(replacementPath, encodePng(replacement));
  results.replacement = replacementPath;

  console.log('=== Generated assets ===');
  console.log(`template.psd     -> ${templatePath}  (${fileSize(templatePath)})`);
  console.log(`replacement.png  -> ${replacementPath}  (${fileSize(replacementPath)})`);

  // --- Validate by reading template.psd back ---
  console.log('\n=== Read-back validation: template.psd layer tree ===');
  const re = readPsd(buf, { skipCompositeImageData: true, skipLayerImageData: true, skipThumbnail: true });
  console.log(`canvas: ${re.width}x${re.height}, bits/ch: ${re.bitsPerChannel}, colorMode: ${re.colorMode}`);
  console.log(`linkedFiles: ${re.linkedFiles ? re.linkedFiles.length : 0}`);
  (re.children || []).forEach((l) => describeLayer(l));

  // Assertions
  const flat = [];
  const walk = (ls) => ls.forEach((l) => { flat.push(l); if (l.children) walk(l.children); });
  walk(re.children || []);
  const product = flat.find((l) => l.name === 'PRODUCT');
  const headline = flat.find((l) => l.name === 'HEADLINE');

  console.log('\n=== Assertions ===');
  console.log(`PRODUCT layer present:            ${!!product}`);
  console.log(`PRODUCT is smart object:          ${!!(product && product.placedLayer)}`);
  if (product && product.placedLayer) {
    console.log(`PRODUCT placedLayer.type:         ${product.placedLayer.type}`);
  }
  console.log(`HEADLINE layer present:           ${!!headline}`);
  console.log(`HEADLINE is text layer:           ${!!(headline && headline.text)}`);
  if (headline && headline.text) {
    console.log(`HEADLINE text value:              "${headline.text.text}"`);
  }
}

main();
