// Built-in five-slide AI-generated design boards. Their PNGs are installed once from
// the companion high-resolution template pack (see README); source artwork is not redrawn.
const specifications = [
  ['teal-editorial-pro', 'Teal Editorial', 'Bold Malayalam + dark teal', .205, .744],
  ['clinical-white', 'Clinical White', 'Bright white + photographic', .205, .752],
  ['warm-ivory', 'Warm Ivory', 'Elegant cream + brown', .064, .811],
  ['deep-teal-premium', 'Deep Teal Premium', 'Rich teal + glowing diagrams', .181, .848],
  ['mint-friendly', 'Mint Friendly', 'Soft aqua + approachable', .158, .864],
  ['airy-aqua', 'Airy Aqua', 'Light teal + health education', .160, .824],
  ['kids-mint', 'Kids Mint', 'Child-friendly + clean illustrations', .177, .866],
  ['nature-sage', 'Nature Sage', 'Leaf green + editorial', .172, .826],
  ['warm-clinical', 'Warm Clinical', 'Warm white + practical diagrams', .205, .915],
  ['premium-charcoal', 'Premium Charcoal', 'Dark premium + cyan', .163, .736],
];
export const DESIGN_SYSTEMS = specifications.map(([id, name, kind, top, bottom]) => ({
  id, name, kind, layout: 'five-slide master',
  img: '/assets/design-systems/' + id + '.png',
  master: true, crop: { top, bottom, left: .006, right: .006, gap: .005 },
}));
export const MASTER_TEMPLATE_IDS = new Set(DESIGN_SYSTEMS.map(t => t.id));
export const TEMPLATE_LOGO_ID = 'clinic-logo';

// Companion ZIP uses the standard STORE (uncompressed) method so that it can be
// imported locally without dependencies, an online service or OS-specific unzip.
export async function readTemplatePackZip(file) {
  if (file.size > 85_000_000) throw new Error('The template ZIP is larger than 85 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer()), view = new DataView(bytes.buffer);
  const found = new Map();
  let pos = 0;
  while (pos + 30 <= bytes.length && view.getUint32(pos, true) === 0x04034b50) {
    const flags = view.getUint16(pos + 6, true), method = view.getUint16(pos + 8, true);
    const size = view.getUint32(pos + 18, true);
    const nameLength = view.getUint16(pos + 26, true), extraLength = view.getUint16(pos + 28, true);
    const start = pos + 30 + nameLength + extraLength, end = start + size;
    if ((flags & 8) || method !== 0 || end > bytes.length) throw new Error('Use the original SmileCraft template ZIP (uncompressed STORE format).');
    const name = new TextDecoder().decode(bytes.subarray(pos + 30, pos + 30 + nameLength));
    if ((MASTER_TEMPLATE_IDS.has(name.replace(/\.png$/, '')) && name.endsWith('.png')) || name === 'clinic-logo.jpg') {
      if (found.has(name) || size > 8_000_000) throw new Error('Invalid or duplicate image in template ZIP.');
      found.set(name, new Blob([bytes.slice(start, end)], { type: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png' }));
    }
    pos = end;
  }
  if (DESIGN_SYSTEMS.some(item => !found.has(item.id + '.png')) || !found.has('clinic-logo.jpg')) {
    throw new Error('The ZIP must include all ten named master boards and clinic-logo.jpg.');
  }
  return found;
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}

// Preserve one enlarged panel as the per-slide reference; the full board is also
// sent to the model for global typography, palette, logo and CTA consistency.
export async function slideReference(masterImageBlob, crop, slideIndex) {
  const image = await createImageBitmap(masterImageBlob);
  try {
    const width = image.width, height = image.height;
    const panelWidth = (1 - crop.left - crop.right - crop.gap * 4) / 5;
    const x = Math.round((crop.left + slideIndex * (panelWidth + crop.gap)) * width);
    const y = Math.round(crop.top * height);
    const w = Math.round(panelWidth * width), h = Math.round((crop.bottom - crop.top) * height);
    if (slideIndex < 0 || slideIndex > 4 || w < 25 || h < 25) throw new Error('Invalid slide-reference crop.');
    const canvas = document.createElement('canvas');
    const zoom = Math.min(3, 1000 / w);
    canvas.width = Math.round(w * zoom); canvas.height = Math.round(h * zoom);
    canvas.getContext('2d').drawImage(image, x, y, w, h, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally { image.close(); }
}
