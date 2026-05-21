import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join, relative } from 'path';
import { existsSync, writeFileSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// The square brand mark (radar rings + accent dot). The wordmarks
// (dark_logo.png / white_logo.png) are 3:1 and not used for icons.
const source = join(__dirname, '../public/favicon.png');
const out = join(__dirname, '../public');

const WHITE = '#ffffff';
const ACCENT = '#ff6a45';

const ok = (p) => console.log(`  ✓ ${relative(out, p)}`);

// Square icon, transparent background — favicons & PWA icons.
async function transparent(size, name) {
  const file = join(out, name);
  await sharp(source)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(file);
  ok(file);
}

// Square icon on a solid white tile — Apple touch & maskable icons,
// because iOS/Android render transparency as black. `scale` is the
// fraction of the canvas the mark occupies (maskable needs a safe area).
async function onWhite(size, name, scale) {
  const file = join(out, name);
  const inner = Math.round(size * scale);
  const offset = Math.round((size - inner) / 2);
  const mark = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: mark, top: offset, left: offset }])
    .png()
    .toFile(file);
  ok(file);
}

// Minimal ICO encoder that embeds PNG payloads (valid since Vista),
// so we get a real /favicon.ico without an extra dependency.
async function ico(sizes, name) {
  const file = join(out, name);
  const pngs = await Promise.all(
    sizes.map((s) =>
      sharp(source)
        .resize(s, s, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4); // image count

  let offset = 6 + sizes.length * 16;
  const entries = sizes.map((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); // width
    e.writeUInt8(s >= 256 ? 0 : s, 1); // height
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3); // reserved
    e.writeUInt16LE(1, 4); // color planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8); // size of png data
    e.writeUInt32LE(offset, 12); // offset of png data
    offset += pngs[i].length;
    return e;
  });

  writeFileSync(file, Buffer.concat([header, ...entries, ...pngs]));
  ok(file);
}

// Lean SVG favicon: wrap a small PNG of the mark (the mark is raster,
// so this stays crisp on hi-dpi while weighing a few KB, not megabytes).
async function svg(name) {
  const file = join(out, name);
  const png = await sharp(source)
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="128" height="128" viewBox="0 0 128 128"><image width="128" height="128" xlink:href="data:image/png;base64,${png.toString(
    'base64'
  )}"/></svg>\n`;
  writeFileSync(file, markup);
  ok(file);
}

function manifest(name) {
  const file = join(out, name);
  const json = {
    name: 'nodrix',
    short_name: 'nodrix',
    description: 'Your own IoT cloud, on Cloudflare.',
    start_url: '/',
    display: 'standalone',
    background_color: WHITE,
    theme_color: ACCENT,
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/maskable-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/maskable-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  ok(file);
}

async function main() {
  if (!existsSync(source)) {
    console.error(`✗ Source mark not found: ${source}`);
    process.exit(1);
  }
  console.log('Generating icons from public/favicon.png …\n');

  await transparent(16, 'favicon-16x16.png');
  await transparent(32, 'favicon-32x32.png');
  await transparent(192, 'icon-192.png');
  await transparent(512, 'icon-512.png');

  await onWhite(180, 'apple-touch-icon.png', 0.86);
  await onWhite(192, 'maskable-icon-192.png', 0.7);
  await onWhite(512, 'maskable-icon-512.png', 0.7);

  await ico([16, 32, 48], 'favicon.ico');
  await svg('favicon.svg');
  manifest('site.webmanifest');

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
