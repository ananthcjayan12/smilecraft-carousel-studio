import { imageFormat } from './image-formats.js';

export async function optimizedImage(file, limit = 1280) {
  if (!file?.type?.startsWith('image/')) throw new Error('Please choose a PNG, JPEG or WebP image.');
  if (file.size > 16_000_000) throw new Error('Image is over 16 MB. Please resize first.');
  const image = await createImageBitmap(file); const scale = Math.min(1, limit / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  return canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', .9);
}

export async function finalArtworkBlob(source, aspectRatio = '4:5') {
  if (!(source instanceof Blob) && !/^data:image\/(png|jpeg|webp);base64,/i.test(source || '')) throw new Error('Generate this slide artwork before downloading it.');
  const { width: W, height: H } = imageFormat(aspectRatio);
  const blob = source instanceof Blob ? source : await (await fetch(source)).blob();
  const image = await createImageBitmap(blob);
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  const scale = Math.min(W / image.width, H / image.height);
  const width = image.width * scale, height = image.height * scale;
  ctx.drawImage(image, (W - width) / 2, (H - height) / 2, width, height); image.close();
  return new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('Could not prepare final PNG.')), 'image/png'));
}
