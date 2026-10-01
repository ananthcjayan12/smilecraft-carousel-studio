// Shared by the browser, Node server and hosted Worker.
export const IMAGE_FORMATS = Object.freeze([
  { ratio: '4:5', label: 'Instagram carousel / portrait post', width: 1080, height: 1350, openaiSize: '1024x1280' },
  { ratio: '1:1', label: 'Square post / carousel', width: 1080, height: 1080, openaiSize: '1024x1024' },
  { ratio: '9:16', label: 'Instagram Story / Reel cover', width: 1080, height: 1920, openaiSize: '864x1536' },
  { ratio: '3:4', label: 'Tall feed post', width: 1080, height: 1440, openaiSize: '960x1280' },
  { ratio: '16:9', label: 'Widescreen / YouTube', width: 1920, height: 1080, openaiSize: '1536x864' },
  { ratio: '1.91:1', label: 'Landscape social post', width: 1910, height: 1000, openaiSize: '1520x800', geminiRatio: '16:9' },
]);

export function imageFormat(ratio) {
  return IMAGE_FORMATS.find(format => format.ratio === ratio) || IMAGE_FORMATS[0];
}

export function openaiImageSize(model, ratio) {
  const format = imageFormat(ratio);
  if (/^gpt-image-2(?:$|[.-])/.test(model)) return format.openaiSize;
  return format.width === format.height ? '1024x1024' : format.width > format.height ? '1536x1024' : '1024x1536';
}

export function formatInstructions(ratio) {
  const format = imageFormat(ratio);
  return `Required output aspect ratio: ${format.ratio}. Target canvas: ${format.width} × ${format.height} pixels. Adapt the reference layout to this canvas; never inherit the reference image's aspect ratio. Keep all approved text and logos inside safe margins. If the tool only supports a nearby ratio, keep the entire design within a centered ${format.ratio} safe area so no text or logo is cut off.`;
}
