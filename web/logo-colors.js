const hex = value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
const toHex = color => `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function pickLogoColors(rgba) {
  const bins = new Map();
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha < 96) continue;
    const rgb = [rgba[i], rgba[i + 1], rgba[i + 2]];
    const max = Math.max(...rgb), min = Math.min(...rgb), light = (max + min) / 510;
    const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
    if (light > .94 || light < .035 || saturation < .06) continue;
    const quantized = rgb.map(value => Math.min(255, Math.round(value / 24) * 24));
    const key = quantized.join(',');
    const current = bins.get(key) || { rgb: [0, 0, 0], count: 0, saturation: 0 };
    current.rgb = current.rgb.map((value, index) => value + rgb[index]);
    current.count++;
    current.saturation += saturation;
    bins.set(key, current);
  }
  const colors = [...bins.values()].map(item => ({
    rgb: item.rgb.map(value => value / item.count),
    count: item.count,
    saturation: item.saturation / item.count,
  })).sort((a, b) => b.count * (.45 + b.saturation) - a.count * (.45 + a.saturation));
  if (!colors.length) return { primary: '#273746', accent: '#14ada9' };
  const primary = colors[0];
  const accent = colors.slice(1).sort((a, b) =>
    (distance(b.rgb, primary.rgb) * (.5 + b.saturation) * Math.log2(b.count + 2)) -
    (distance(a.rgb, primary.rgb) * (.5 + a.saturation) * Math.log2(a.count + 2))
  )[0];
  if (!accent || distance(primary.rgb, accent.rgb) < 55) {
    const [r, g, b] = primary.rgb;
    return { primary: toHex(primary.rgb), accent: toHex([255 - r, 255 - g, 255 - b]) };
  }
  return { primary: toHex(primary.rgb), accent: toHex(accent.rgb) };
}

export async function analyzeLogoColors(dataUrl) {
  const response = await fetch(dataUrl);
  const image = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 96; canvas.height = 96;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.clearRect(0, 0, 96, 96);
    const scale = Math.min(96 / image.width, 96 / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (96 - width) / 2, (96 - height) / 2, width, height);
    return pickLogoColors(context.getImageData(0, 0, 96, 96).data);
  } finally { image.close(); }
}
