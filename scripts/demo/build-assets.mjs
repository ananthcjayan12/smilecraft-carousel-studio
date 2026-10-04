// Builds the committed demo assets from the raw design pack (run locally once):
//   node scripts/demo/build-assets.mjs [path/to/dental_dummy_explanation_pack]
// Each image gets the same three variants real generations store:
//   original.png  lossless, exact social canvas (only fetched for downloads)
//   preview.webp  1000px, high quality (what the review screens show)
//   thumb.webp    400px (cards, strips)
import sharp from 'sharp';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { DEMO_CLINICS, ASSET_DIR } from './clinics.mjs';

const CANVAS = { carousel: [1080, 1350], post: [1080, 1350], story: [1080, 1920] };

export function demoImages(clinic) {
  const images = [{ name: 'logo', source: clinic.logo, kind: 'logo' }];
  for (const style of clinic.styles) images.push({ name: style.key, source: style.source, kind: 'style' });
  for (const item of clinic.items) for (const [i, frame] of item.frames.entries()) if (frame.source) images.push({ name: `${item.key}-${i + 1}`, source: frame.source, kind: item.type });
  return images;
}

async function build(image, pack, out) {
  let input = sharp(join(pack, image.source));
  if (CANVAS[image.kind]) input = input.resize(...CANVAS[image.kind], { fit: 'cover' });
  else if (image.kind === 'logo') input = input.resize({ width: 1200, withoutEnlargement: true });
  const original = await input.png({ compressionLevel: 9, effort: 10 }).toBuffer();
  const meta = await sharp(original).metadata();
  // Near-lossless WebP keeps text edges crisp at a fraction of the PNG size.
  const preview = await sharp(original).resize({ width: 1000, withoutEnlargement: true }).webp({ quality: 86, alphaQuality: 100, smartSubsample: true }).toBuffer();
  const thumb = await sharp(original).resize({ width: 400 }).webp({ quality: 78, alphaQuality: 100 }).toBuffer();
  await mkdir(out, { recursive: true });
  await Promise.all([writeFile(join(out, 'original.png'), original), writeFile(join(out, 'preview.webp'), preview), writeFile(join(out, 'thumb.webp'), thumb)]);
  return { width: meta.width, height: meta.height, size: original.length, preview: preview.length, thumb: thumb.length };
}

if (process.argv[1]?.endsWith('/build-assets.mjs')) {
  const pack = process.argv[2] || 'dental_dummy_explanation_pack';
  await rm(ASSET_DIR, { recursive: true, force: true });
  const manifest = {};
  for (const clinic of DEMO_CLINICS) for (const image of demoImages(clinic)) {
    const stats = await build(image, pack, join(ASSET_DIR, clinic.key, image.name));
    manifest[`${clinic.key}/${image.name}`] = stats;
    console.log(`${clinic.key}/${image.name}: original ${(stats.size / 1e6).toFixed(2)} MB, preview ${(stats.preview / 1e3).toFixed(0)} KB, thumb ${(stats.thumb / 1e3).toFixed(0)} KB`);
  }
  await writeFile(join(ASSET_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
}
